/**
 * On-chain settlement + proof receipts. Runs the REAL create_market → deposit → resolve → claim
 * lifecycle against the local validator (:8999) that clones the real TxLINE oracle + anchored PDA, and
 * builds a plain-language proof receipt (leaf → subtree → daily root → on-chain PDA) from the recorded
 * proof + the engine's on-chain verdict. Fail-closed: a tampered proof reverts the CPI, so it can't settle.
 */
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { statLeaf, describeStatKey, verifyScoresStatProofOnChain } from "@txline/verify";
import type { AccountReader, OnChainScoreVerification } from "@txline/verify";
import {
  createMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { CONFIG } from "./config.js";
import type { Market } from "./catalog.js";

const { web3 } = anchor;
const { Connection, Keypair, PublicKey, ComputeBudgetProgram, LAMPORTS_PER_SOL, SystemProgram } = web3;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const FIXDIR = join(REPO, "onchain", "fixtures");
const IDL_PATH = join(REPO, "onchain", "target", "idl", "pulseplay_escrow.json");
const ORACLE = new PublicKey(CONFIG.oracleProgram);
const DEMO_SEQ = 960;

// Lazy (not module-level): on devnet there is no single fixed daily_scores_roots PDA (it's
// per-epoch-day), so CONFIG.dailyScoresRootsPda is "" there by default. Constructing a PublicKey("")
// at import time would crash the whole server at boot before /api/health even has a chance to report
// `chain: false` cleanly — only throw when a caller actually needs the (localnet-only, for now) fixed
// PDA. Devnet settlement computes its PDA per-proof instead (see docs/TXLINE-INTEGRATION.md).
function dailyScoresRootsPda(): anchor.web3.PublicKey {
  if (!CONFIG.dailyScoresRootsPda) {
    throw new Error(`no fixed daily_scores_roots PDA configured for cluster "${CONFIG.cluster}" — set DAILY_SCORES_ROOTS_PDA or use a per-proof PDA`);
  }
  return new PublicKey(CONFIG.dailyScoresRootsPda);
}

/** The `daily_scores_roots` PDA for whichever epoch day a given proof's `minTimestamp` falls on — the
 *  seed a LIVE devnet proof needs (there is no single fixed PDA there, unlike localnet's one cloned day). */
const dailyScoresRootsPdaFromTimestamp = (oracleProgram: anchor.web3.PublicKey, minTimestampMs: number) => {
  const epochDay = Math.floor(minTimestampMs / 86400000);
  const seed = Buffer.alloc(2);
  seed.writeUInt16LE(epochDay % 65536);
  return PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), seed], oracleProgram)[0];
};

/**
 * Fetch a REAL, live V1 stat-validation proof directly from TxLINE's devnet API (NOT the local engine,
 * which only proxies mainnet — see docs/TXLINE-INTEGRATION.md "Devnet"). Returns null (falls back to
 * the recorded fixture) on anything but a clean match — cluster != devnet, no cached devnet token,
 * network hiccup, or a stat shape that doesn't match what the market expects.
 */
async function liveDevnetProof(statKey: number, period: number): Promise<any | null> {
  if (CONFIG.cluster !== "devnet") return null;
  try {
    const { apiToken, jwt } = loadJson(CONFIG.devnetTokenCachePath);
    const url = `${CONFIG.devnetTxlineApiBase}/api/scores/stat-validation?fixtureId=${CONFIG.demoFixtureId}&seq=${DEMO_SEQ}&statKey=${statKey}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken } });
    if (!res.ok) return null;
    const p: any = await res.json();
    if (p?.statToProve?.key !== statKey || p?.statToProve?.period !== period) return null;
    return p;
  } catch {
    return null; // devnet token not obtained yet, or the API is unreachable — recorded fixture covers us
  }
}

const loadJson = (p: string) => JSON.parse(readFileSync(p, "utf8"));
const node = (n: any) => ({ hash: n.hash, isRightSibling: n.isRightSibling });
const hex = (bytes: number[]) => "0x" + Buffer.from(bytes).toString("hex");

let _program: any | null = null;
let _conn: anchor.web3.Connection | null = null;
let _operator: anchor.web3.Keypair | null = null;
/** The keeper's own read/write Solana connection, lazily created and shared across settlement + the
 *  receipt's direct daily_scores_roots PDA read (a `Connection` structurally satisfies AccountReader). */
function rpcConn(): anchor.web3.Connection {
  if (!_conn) _conn = new Connection(CONFIG.rpcUrl, "confirmed");
  return _conn;
}
function program() {
  if (_program) return _program;
  const idl = loadJson(IDL_PATH);
  _conn = rpcConn();
  _operator = Keypair.fromSecretKey(Uint8Array.from(loadJson(CONFIG.walletKeypairPath)));
  const provider = new anchor.AnchorProvider(_conn, new anchor.Wallet(_operator), { commitment: "confirmed" });
  _program = new anchor.Program(idl, provider);
  return _program;
}

// ── SPL wagering token ───────────────────────────────────────────────────────────────────────────
// devnet: CONFIG.wagerMint is the real "PulsePlay USDC (Devnet Test)" mint, authority = the deploy
// wallet. localnet: no stable mint survives a validator --reset, so the keeper creates + caches its
// OWN fresh test mint on first use (mint authority = the keeper's own wallet — same trust boundary as
// everything else it does on localnet).
let _mintAuthority: anchor.web3.Keypair | null = null;
function mintAuthorityKeypair(): anchor.web3.Keypair {
  if (_mintAuthority) return _mintAuthority;
  _mintAuthority = Keypair.fromSecretKey(Uint8Array.from(loadJson(CONFIG.mintAuthorityKeypairPath)));
  return _mintAuthority;
}

const LOCAL_MINT_CACHE = new URL("../.cache/localnet-mint.json", import.meta.url).pathname;
let _wagerMint: anchor.web3.PublicKey | null = null;
async function wagerMint(): Promise<anchor.web3.PublicKey> {
  if (_wagerMint) return _wagerMint;
  if (CONFIG.wagerMint) {
    _wagerMint = new PublicKey(CONFIG.wagerMint);
    return _wagerMint;
  }
  // localnet self-serve mint, cached to disk so repeated `tsx watch` reloads (not validator resets)
  // reuse the same address within a session.
  if (existsSync(LOCAL_MINT_CACHE)) {
    try {
      const cached = new PublicKey(loadJson(LOCAL_MINT_CACHE).mint);
      if (await _conn!.getAccountInfo(cached)) { _wagerMint = cached; return cached; }
    } catch { /* stale cache (validator reset) — fall through and mint a fresh one */ }
  }
  const authority = mintAuthorityKeypair();
  const mint = await createMint(_conn!, authority, authority.publicKey, null, CONFIG.wagerMintDecimals, undefined, undefined, TOKEN_PROGRAM_ID);
  mkdirSync(dirname(LOCAL_MINT_CACHE), { recursive: true });
  writeFileSync(LOCAL_MINT_CACHE, JSON.stringify({ mint: mint.toBase58(), createdAt: new Date().toISOString() }, null, 2));
  _wagerMint = mint;
  return mint;
}

/** Mint `amountBaseUnits` of the wager token to `owner`'s ATA (creating it if needed). No rate limit
 *  — we control the mint authority. Used by settleMarket's demo bettors and the "Fund my wallet" faucet. */
async function fundTokens(owner: anchor.web3.PublicKey, amountBaseUnits: number | bigint) {
  const mint = await wagerMint();
  const authority = mintAuthorityKeypair();
  const ata = await getOrCreateAssociatedTokenAccount(_conn!, authority, mint, owner, true, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  await mintTo(_conn!, authority, mint, ata.address, authority, amountBaseUnits, [], undefined, TOKEN_PROGRAM_ID);
  return ata.address;
}

export interface FaucetResult { wallet: string; mint: string; mintedBaseUnits: string; solTxSig: string | null; ata: string }

/** "Fund my wallet": mint test USDC to the wallet's ATA + send a little gas SOL from a well-funded
 *  wallet (avoids the public devnet airdrop's rate limit — we control the mint AND have devnet SOL). */
export async function faucetFund(walletB58: string, tokenAmountWhole = 500, solAmount = 0.25): Promise<FaucetResult> {
  program(); // ensures _conn is initialized
  const wallet = new PublicKey(walletB58);
  const decimals = CONFIG.wagerMintDecimals;
  const amountBaseUnits = BigInt(tokenAmountWhole) * BigInt(10 ** decimals);
  const ata = await fundTokens(wallet, amountBaseUnits);

  let solTxSig: string | null = null;
  const authority = mintAuthorityKeypair();
  if (solAmount > 0 && authority.publicKey.toBase58() !== wallet.toBase58()) {
    try {
      const { blockhash, lastValidBlockHeight } = await _conn!.getLatestBlockhash("confirmed");
      const tx = new anchor.web3.Transaction({ feePayer: authority.publicKey, blockhash, lastValidBlockHeight }).add(
        SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: wallet, lamports: Math.round(solAmount * LAMPORTS_PER_SOL) }),
      );
      solTxSig = await anchor.web3.sendAndConfirmTransaction(_conn!, tx, [authority], { commitment: "confirmed" });
    } catch (e) {
      // Non-fatal: the token mint (the important part — stakes need it) already succeeded. A wallet
      // that already has gas SOL (e.g. Phantom's own devnet airdrop) doesn't need this to succeed.
      console.warn("[keeper] faucet SOL transfer failed (token mint still succeeded):", (e as Error).message);
    }
  }
  return { wallet: walletB58, mint: (await wagerMint()).toBase58(), mintedBaseUnits: amountBaseUnits.toString(), solTxSig, ata: ata.toBase58() };
}

export async function chainHealth(): Promise<{ chain: boolean; programId: string; cluster: string; slot?: number }> {
  try {
    const conn = new Connection(CONFIG.rpcUrl, "confirmed");
    const slot = await conn.getSlot();
    const info = await conn.getAccountInfo(new PublicKey(CONFIG.programId));
    return { chain: !!info?.executable, programId: CONFIG.programId, cluster: CONFIG.cluster, slot };
  } catch {
    return { chain: false, programId: CONFIG.programId, cluster: CONFIG.cluster };
  }
}

// ── proof → args ──────────────────────────────────────────────────────────────────────────────────
const summaryArg = (s: any) => ({
  fixtureId: new BN(s.fixtureId),
  updateStats: { updateCount: s.updateStats.updateCount, minTimestamp: new BN(s.updateStats.minTimestamp), maxTimestamp: new BN(s.updateStats.maxTimestamp) },
  eventsSubTreeRoot: s.eventStatsSubTreeRoot,
});

function outcomeArgs(proof: any, statKey: number, period: number) {
  const p = proof;
  const base = { ts: new BN(p.summary.updateStats.minTimestamp), summary: summaryArg(p.summary), fixtureProof: p.subTreeProof.map(node), mainTreeProof: p.mainTreeProof.map(node) };
  if (Array.isArray(p.statsToProve)) {
    const i = p.statsToProve.findIndex((s: any) => s.key === statKey && s.period === period);
    const idx = i >= 0 ? i : 0;
    return { ...base, statA: { scoreStat: p.statsToProve[idx], eventStatRoot: p.eventStatRoot, statProof: p.statProofs[idx].map(node) } };
  }
  return { ...base, statA: { scoreStat: p.statToProve, eventStatRoot: p.eventStatRoot, statProof: p.statProof.map(node) } };
}

function ticketArgs(v: any) {
  return {
    ts: new BN(v.summary.updateStats.minTimestamp), summary: summaryArg(v.summary),
    subTreeProof: v.subTreeProof.map(node), mainTreeProof: v.mainTreeProof.map(node), eventStatRoot: v.eventStatRoot,
    statsToProve: v.statsToProve.map((e: any) => ({ stat: e.stat, statProof: e.statProof.map(node) })),
    multiproof: { hashes: v.multiproof.hashes.map(node), indices: v.multiproof.indices },
  };
}

// V2 combo args = plural multi-stat proof (each leg carries its own membership path; no multiproof).
function comboArgs(p: any) {
  return {
    ts: new BN(p.summary.updateStats.minTimestamp),
    summary: summaryArg(p.summary),
    subTreeProof: p.subTreeProof.map(node),
    mainTreeProof: p.mainTreeProof.map(node),
    eventStatRoot: p.eventStatRoot,
    statsToProve: p.statsToProve.map((s: any, i: number) => ({ stat: s, statProof: p.statProofs[i].map(node) })),
  };
}

const i64le = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i32le = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };

async function airdrop(conn: anchor.web3.Connection, to: anchor.web3.PublicKey, sol: number) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

/** Localnet: the free local-validator faucet (`airdrop`, instant, no real rate limit). Devnet: a
 *  direct SOL transfer from the keeper's own (well-funded) operating wallet — the PUBLIC devnet
 *  airdrop RPC is rate-limited hard enough to fail outright under any real usage, but an ordinary
 *  transfer from a wallet we already funded has no such limit. */
async function fundGas(conn: anchor.web3.Connection, to: anchor.web3.PublicKey, sol: number) {
  if (CONFIG.cluster !== "devnet") return airdrop(conn, to, sol);
  const from = _operator!;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new anchor.web3.Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  await anchor.web3.sendAndConfirmTransaction(conn, tx, [from], { commitment: "confirmed" });
}

export interface SettleStep { label: string; description: string; tx: string }

export interface SettleResult {
  marketId: string;
  outcome: boolean;
  winningSide: "YES" | "NO";
  potBaseUnits: string; // string: base units can exceed Number precision for large mints
  mint: string;
  mintDecimals: number;
  mintLabel: string; // e.g. "USDC · devnet test token" — label reality everywhere
  market: string; // market PDA
  vault: string; // the market's SPL token vault (an ATA owned by the market PDA)
  txids: { create: string; depositYes: string; depositNo: string; resolve: string; claim: string };
  /** The same 5 txids as an ordered, human-readable CPI lifecycle — create -> deposit x2 -> resolve
   *  (the oracle CPI) -> claim — for a step-by-step visualization instead of one opaque blocking call. */
  steps: SettleStep[];
  liveProof: boolean; // true if this resolve used a proof fetched live from devnet, not a recorded fixture
  settledAt: number;
  proofFile: string;
  generation: "V1" | "V2" | "V3";
}

const store = new Map<string, SettleResult>();
export const getSettlement = (id: string) => store.get(id);
export const allSettlements = () => [...store.values()];

// ── Wallet-signed transactions ─────────────────────────────────────────────────────────────────────
// The keeper builds these (it already has the Anchor Program + IDL loaded) but does NOT sign them —
// it returns an unsigned, base64-encoded VersionedTransaction with `feePayer = wallet` for the
// CLIENT to sign with Phantom and submit itself. This is the actual "wallet deposits into the vault"
// flow (distinct from settleMarket()'s self-contained fake-bettor demo flow above, which stays
// untouched — they are deliberately separate market instances: a connected wallet's OWN market PDA is
// keyed off the wallet's own pubkey as authority).

export interface WalletMarketInfo {
  market: string; vault: string; position: string; exists: boolean; cutoffTs: number | null; resolved: boolean | null;
}

/** The market PDA a given wallet would own for a catalog entry (authority = the wallet itself). */
function walletMarketPda(prog: any, wallet: anchor.web3.PublicKey, m: Market) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), wallet.toBuffer(), i64le(CONFIG.demoFixtureId), u32le(m.statKey), i32le(m.period)], prog.programId);
  return market;
}

/**
 * The on-chain `market` PDA is seeded only by (authority, fixture_id, stat_key, period) — NOT
 * comparison/threshold/combine_op/kind. Several catalog entries deliberately share a (statKey,
 * period) with a DIFFERENT predicate (e.g. "England to score" and "England exactly 1 goal" are both
 * statKey=1/period=5 — one `> 0`, the other `== 1`), which is fine for settleMarket()'s demo flow
 * (fresh random authority per call, so they never collide) but WOULD collide for a single connected
 * wallet's own market instances (same authority = the wallet). Guard against silently treating "a
 * market exists at this PDA" as "MY market for catalog entry X" when it's actually a different
 * catalog entry's market that happens to share the PDA.
 */
function marketMatchesCatalogEntry(acct: any, m: Market): boolean {
  return acct.threshold === m.threshold && acct.comparison === m.comparison
    && acct.combineOp === m.combineOp && acct.marketKind === m.kind;
}

export async function walletMarketStatus(walletB58: string, m: Market): Promise<WalletMarketInfo> {
  const prog = program();
  const conn = _conn!;
  const mint = await wagerMint();
  const wallet = new PublicKey(walletB58);
  const market = walletMarketPda(prog, wallet, m);
  const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await conn.getAccountInfo(market);
  if (!info) return { market: market.toBase58(), vault: vault.toBase58(), position: "", exists: false, cutoffTs: null, resolved: null };
  const acct = await prog.account.market.fetch(market);
  if (!marketMatchesCatalogEntry(acct, m)) {
    // A market DOES exist at this PDA, but for a DIFFERENT catalog entry that shares the same
    // (statKey, period) — not "my ticket" for THIS entry.
    return { market: market.toBase58(), vault: vault.toBase58(), position: "", exists: false, cutoffTs: null, resolved: null };
  }
  const position = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), wallet.toBuffer(), Buffer.from([1])], prog.programId)[0];
  return { market: market.toBase58(), vault: vault.toBase58(), position: position.toBase58(), exists: true, cutoffTs: acct.cutoffTs.toNumber(), resolved: acct.resolved };
}

export interface BuildDepositResult { transactionBase64: string; market: string; vault: string; position: string; createdMarket: boolean }

/** Builds (does not sign) create_market-if-needed + deposit as ONE transaction — both instructions
 *  need only the connected wallet's signature (it is authority AND depositor AND fee payer). */
export async function buildDepositTransaction(walletB58: string, m: Market, side: boolean, amountWhole: number): Promise<BuildDepositResult> {
  const prog = program();
  const conn = _conn!;
  const mint = await wagerMint();
  const wallet = new PublicKey(walletB58);
  const market = walletMarketPda(prog, wallet, m);
  const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const position = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), wallet.toBuffer(), Buffer.from([side ? 1 : 0])], prog.programId)[0];
  const depositorTokenAccount = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const instructions: anchor.web3.TransactionInstruction[] = [];
  const marketInfo = await conn.getAccountInfo(market);
  const createdMarket = !marketInfo;
  if (!createdMarket) {
    // The PDA is only seeded by (authority, fixtureId, statKey, period) — a DIFFERENT catalog entry
    // sharing that same pair (e.g. "England to score" vs "England exactly 1 goal", both statKey=1/
    // period=5) would otherwise silently deposit into the WRONG market's predicate. Fail loudly
    // instead — see marketMatchesCatalogEntry().
    const existing = await prog.account.market.fetch(market);
    if (!marketMatchesCatalogEntry(existing, m)) {
      throw new Error(`this wallet already has a different open market for the same underlying stat (statKey ${m.statKey}/period ${m.period}) — one wallet can hold only one market per (stat, period) pair at a time; try a different market or a fresh wallet`);
    }
  }
  if (createdMarket) {
    // Generous window (a week) — this market is created live, on demand, by whoever bets on it first;
    // it needs to stay open long enough for a keeper settle pass to reach it after the replay's "full
    // time" (which fast-forwards a HISTORICAL fixture, not a live clock).
    const cutoff = new BN(Math.floor(Date.now() / 1000) + 7 * 86400);
    const deadline = new BN(Math.floor(Date.now() / 1000) + 14 * 86400);
    instructions.push(await prog.methods
      .createMarket(new BN(CONFIG.demoFixtureId), m.statKey, m.period, m.threshold, m.comparison, cutoff, deadline, m.combineOp, m.kind)
      .accounts({
        authority: wallet, market, mint, vault,
        tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      }).instruction());
  }
  const amountBaseUnits = new BN(Math.round(amountWhole * 10 ** CONFIG.wagerMintDecimals));
  instructions.push(await prog.methods.deposit(side, amountBaseUnits)
    .accounts({
      depositor: wallet, market, mint, vault, depositorTokenAccount, position,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).instruction());

  const { blockhash } = await conn.getLatestBlockhash("confirmed");
  const msg = new anchor.web3.TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions }).compileToV0Message();
  const vtx = new anchor.web3.VersionedTransaction(msg);
  return { transactionBase64: Buffer.from(vtx.serialize()).toString("base64"), market: market.toBase58(), vault: vault.toBase58(), position: position.toBase58(), createdMarket };
}

export interface BuildClaimResult { transactionBase64: string; market: string; vault: string }

/** Builds (does not sign) a claim transaction for a connected wallet's own resolved market. */
export async function buildClaimTransaction(walletB58: string, m: Market): Promise<BuildClaimResult> {
  const prog = program();
  const mint = await wagerMint();
  const wallet = new PublicKey(walletB58);
  const market = walletMarketPda(prog, wallet, m);
  const acct = await prog.account.market.fetch(market);
  const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const ownerTokenAccount = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const position = PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), wallet.toBuffer(), Buffer.from([acct.outcome ? 1 : 0])], prog.programId)[0];
  const ix = await prog.methods.claim()
    .accounts({ owner: wallet, market, mint, vault, ownerTokenAccount, position, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .instruction();
  const { blockhash } = await _conn!.getLatestBlockhash("confirmed");
  const msg = new anchor.web3.TransactionMessage({ payerKey: wallet, recentBlockhash: blockhash, instructions: [ix] }).compileToV0Message();
  const vtx = new anchor.web3.VersionedTransaction(msg);
  return { transactionBase64: Buffer.from(vtx.serialize()).toString("base64"), market: market.toBase58(), vault: vault.toBase58() };
}

export interface WalletBalances { sol: number; wagerToken: string; mint: string; mintLabel: string; mintDecimals: number }

/** SOL + wager-token balance for any wallet (used by the connect-wallet panel). */
export async function walletBalances(walletB58: string): Promise<WalletBalances> {
  program();
  const conn = _conn!;
  const mint = await wagerMint();
  const wallet = new PublicKey(walletB58);
  const sol = (await conn.getBalance(wallet)) / LAMPORTS_PER_SOL;
  const ata = getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  let wagerToken = "0";
  try {
    wagerToken = (await conn.getTokenAccountBalance(ata)).value.amount;
  } catch { /* ATA doesn't exist yet — 0 balance, not an error */ }
  return { sol, wagerToken, mint: mint.toBase58(), mintLabel: CONFIG.wagerMintLabel, mintDecimals: CONFIG.wagerMintDecimals };
}

/** Run the full trustless lifecycle for a market on-chain. Idempotent-ish: re-runs with a fresh authority. */
/**
 * The market's settlement proof: a LIVE devnet proof for V1 markets when available (confirmed working
 * — see docs/TXLINE-INTEGRATION.md "Devnet"), else the recorded fixture. Shared by settleMarket() and
 * resolveWalletMarket() so both settlement paths use identically-sourced proofs.
 */
async function fetchSettlementProof(m: Market): Promise<{ proof: any; live: boolean }> {
  const live = m.generation === "V1" ? await liveDevnetProof(m.statKey, m.period) : null;
  const proof = live ?? (loadJson(join(FIXDIR, m.fixtureProofFile)).proof
    ? loadJson(join(FIXDIR, m.fixtureProofFile)).proof // V1 recorded files wrap under .proof
    : loadJson(join(FIXDIR, m.fixtureProofFile))); // V3 files are bare
  return { proof, live: !!live };
}

/** Resolves the CPI generation-appropriate instruction for `market` against `proof`. Permissionless
 *  on-chain (no signer beyond the fee payer — the proof itself is the authority), so the keeper's own
 *  wallet can resolve ANY market, including one a connected wallet deposited into. */
async function resolveOnChain(prog: any, market: anchor.web3.PublicKey, m: Market, proof: any, live: boolean): Promise<string> {
  const dailyPda = live ? dailyScoresRootsPdaFromTimestamp(ORACLE, proof.summary.updateStats.minTimestamp) : dailyScoresRootsPda();
  const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];
  if (m.generation === "V1") {
    return prog.methods.resolveOutcome(outcomeArgs(proof, m.statKey, m.period))
      .accounts({ market, dailyScoresRoots: dailyPda, txoracleProgram: ORACLE }).preInstructions(cu).rpc();
  } else if (m.generation === "V2") {
    return prog.methods.resolveCombo(comboArgs(proof))
      .accounts({ market, dailyScoresRoots: dailyScoresRootsPda(), txoracleProgram: ORACLE }).preInstructions(cu).rpc();
  }
  return prog.methods.resolveTicket(ticketArgs(proof))
    .accounts({ market, dailyScoresRoots: dailyScoresRootsPda(), txoracleProgram: ORACLE }).preInstructions(cu).rpc();
}

export interface ResolveWalletMarketResult {
  outcome: boolean; winningSide: "YES" | "NO"; resolveTx: string; market: string; vault: string;
  vaultBaseUnits: string; mintDecimals: number; mintLabel: string; live: boolean;
}

/** Resolves a CONNECTED WALLET's own market (created via buildDepositTransaction) using a
 *  real settlement proof. The keeper pays gas and is the tx signer, but this is NOT a trust shortcut:
 *  resolve is permissionless on-chain (no signer field on the Resolve accounts beyond the fee payer)
 *  precisely so ANYONE — not just the depositor — can settle once a real proof exists. Claiming any
 *  winnings still requires the wallet's own signature (buildClaimTransaction). */
export async function resolveWalletMarket(walletB58: string, m: Market): Promise<ResolveWalletMarketResult> {
  const prog = program();
  const mint = await wagerMint();
  const wallet = new PublicKey(walletB58);
  const market = walletMarketPda(prog, wallet, m);
  const info = await _conn!.getAccountInfo(market);
  if (!info) throw new Error("this wallet has no market for that leg yet — submit a ticket first");
  const before = await prog.account.market.fetch(market);
  if (before.resolved) {
    const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const vaultBal = await _conn!.getTokenAccountBalance(vault).catch(() => ({ value: { amount: "0" } }));
    return {
      outcome: before.outcome, winningSide: before.outcome ? "YES" : "NO", resolveTx: "",
      market: market.toBase58(), vault: vault.toBase58(), vaultBaseUnits: vaultBal.value.amount,
      mintDecimals: CONFIG.wagerMintDecimals, mintLabel: CONFIG.wagerMintLabel, live: false,
    };
  }
  const { proof, live } = await fetchSettlementProof(m);
  const resolveTx = await resolveOnChain(prog, market, m, proof, live);
  const after = await prog.account.market.fetch(market);
  const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const vaultBal = await _conn!.getTokenAccountBalance(vault).catch(() => ({ value: { amount: "0" } }));
  return {
    outcome: after.outcome, winningSide: after.outcome ? "YES" : "NO", resolveTx,
    market: market.toBase58(), vault: vault.toBase58(), vaultBaseUnits: vaultBal.value.amount,
    mintDecimals: CONFIG.wagerMintDecimals, mintLabel: CONFIG.wagerMintLabel, live,
  };
}

export async function settleMarket(m: Market): Promise<SettleResult> {
  const prog = program();
  const conn = _conn!;
  const mint = await wagerMint();
  // V1 (Outcomes) on devnet: try a LIVE proof straight from TxLINE's devnet API first — confirmed
  // working (see docs/TXLINE-INTEGRATION.md "Devnet"). Falls back to the recorded fixture for V2/V3
  // (not yet confirmed live) or if the live fetch fails for any reason (offline, no cached token, …).
  const { proof, live } = await fetchSettlementProof(m);
  const authority = Keypair.generate();
  const yesBettor = Keypair.generate();
  const noBettor = Keypair.generate();
  // SOL covers rent + gas only now; stakes move in the SPL wager token.
  await Promise.all([fundGas(conn, authority.publicKey, 0.05), fundGas(conn, yesBettor.publicKey, 0.05), fundGas(conn, noBettor.publicKey, 0.05)]);
  const oneToken = 10 ** CONFIG.wagerMintDecimals;
  await Promise.all([fundTokens(yesBettor.publicKey, 5 * oneToken), fundTokens(noBettor.publicKey, 5 * oneToken)]);

  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.publicKey.toBuffer(), i64le(CONFIG.demoFixtureId), u32le(m.statKey), i32le(m.period)], prog.programId);
  const vault = getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const posPda = (owner: anchor.web3.PublicKey, side: boolean) =>
    PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), owner.toBuffer(), Buffer.from([side ? 1 : 0])], prog.programId)[0];
  const ataOf = (owner: anchor.web3.PublicKey) => getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const cutoff = new BN(Math.floor(Date.now() / 1000) + 3600);
  const deadline = new BN(Math.floor(Date.now() / 1000) + 7200);
  const create = await prog.methods
    .createMarket(new BN(CONFIG.demoFixtureId), m.statKey, m.period, m.threshold, m.comparison, cutoff, deadline, m.combineOp, m.kind)
    .accounts({
      authority: authority.publicKey, market, mint, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();

  const one = new BN(oneToken);
  const depositYes = await prog.methods.deposit(true, one.muln(2))
    .accounts({
      depositor: yesBettor.publicKey, market, mint, vault, depositorTokenAccount: ataOf(yesBettor.publicKey),
      position: posPda(yesBettor.publicKey, true), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([yesBettor]).rpc();
  const depositNo = await prog.methods.deposit(false, one)
    .accounts({
      depositor: noBettor.publicKey, market, mint, vault, depositorTokenAccount: ataOf(noBettor.publicKey),
      position: posPda(noBettor.publicKey, false), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([noBettor]).rpc();

  const resolve = await resolveOnChain(prog, market, m, proof, live);
  const account = await prog.account.market.fetch(market);
  const outcome: boolean = account.outcome;

  // winner claims the pot (if there is a winning side with stake)
  const winner = outcome ? yesBettor : noBettor;
  const claim = await prog.methods.claim()
    .accounts({
      owner: winner.publicKey, market, mint, vault, ownerTokenAccount: ataOf(winner.publicKey),
      position: posPda(winner.publicKey, outcome), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([winner]).rpc();

  const oneTokenFmt = (n: number) => (n / oneToken).toFixed(2);
  const steps: SettleStep[] = [
    { label: "1 · Create market", description: `On-chain market opened for ${m.title} (predicate: ${m.predicateLabel}).`, tx: create },
    { label: "2 · Deposit — YES", description: `${oneTokenFmt(2 * oneToken)} ${CONFIG.wagerMintLabel} staked on YES.`, tx: depositYes },
    { label: "3 · Deposit — NO", description: `${oneTokenFmt(oneToken)} ${CONFIG.wagerMintLabel} staked on NO. Vault now holds ${oneTokenFmt(3 * oneToken)}.`, tx: depositNo },
    { label: `4 · Resolve (${m.generation} oracle CPI)`, description: live
      ? `A LIVE proof fetched from TxLINE's devnet API at settle time was verified by a real ${m.generation === "V1" ? "validate_stat" : m.generation === "V2" ? "validate_stat_v2" : "validate_stat_v3"} CPI. Outcome: ${outcome ? "YES" : "NO"}.`
      : `A recorded TxLINE Merkle proof was verified by a real ${m.generation === "V1" ? "validate_stat" : m.generation === "V2" ? "validate_stat_v2" : "validate_stat_v3"} CPI. Outcome: ${outcome ? "YES" : "NO"}.`, tx: resolve },
    { label: "5 · Claim", description: `The ${outcome ? "YES" : "NO"}-side winner swept the ${oneTokenFmt(3 * oneToken)}-token pot. Vault now holds 0.`, tx: claim },
  ];

  const result: SettleResult = {
    marketId: m.id, outcome, winningSide: outcome ? "YES" : "NO", potBaseUnits: String(3 * oneToken),
    mint: mint.toBase58(), mintDecimals: CONFIG.wagerMintDecimals, mintLabel: CONFIG.wagerMintLabel,
    market: market.toBase58(), vault: vault.toBase58(), txids: { create, depositYes, depositNo, resolve, claim },
    steps, liveProof: live, settledAt: Date.now(), proofFile: m.fixtureProofFile, generation: m.generation,
  };
  store.set(m.id, result);
  return result;
}

// ── proof receipt (leaf → subtree → daily root → PDA, plain language) ──────────────────────────────
export interface ProofReceipt {
  marketId: string;
  fixtureId: number;
  statLabel: string;
  statTriple: { key: number; value: number; period: number };
  predicate: string;
  outcome: boolean | null;
  verified: boolean;
  chain: {
    leaf: { title: string; plain: string; hashHex: string };
    subtree: { title: string; plain: string; hashHex: string };
    dailyRoot: { title: string; plain: string; hashHex: string; epochDay: number };
    onChain: { title: string; plain: string; pda: string; onChainRootHex: string; computedRootHex: string; match: boolean };
  };
  settleTx: string | null;
  escrowProgram: string;
  oracleProgram: string;
}

// Canonical V1 seq=960 scores proofs (each ships the recorded daily_scores_roots PDA bytes) whose
// membership walk folds up to this fixture's anchored 5-min-slot root. That slot root is fixture-wide
// (identical across every stat recorded in the slot), so the receipt's on-chain step can verify it
// from ANY leg's proof — we pick the one that carries the market's own stat key for a faithful walk.
const ONCHAIN_ROOT_PROOF_BY_STATKEY: Record<number, string> = {
  7: "scores-proof-18241006-seq960-keys7-8.json",
  8: "scores-proof-18241006-seq960-keys7-8.json",
};
const DEFAULT_ONCHAIN_ROOT_PROOF = "scores-proof-18241006-seq960-keys1-2.json";

/**
 * Verify the fixture's anchored daily-scores slot root by RECONSTRUCTING it from a recorded proof and
 * reading the REAL `daily_scores_roots` PDA account directly over RPC — no engine dependency. Returns
 * null only on an RPC/read error (verifyScoresStatProofOnChain never throws for a failed proof), which
 * the caller renders as the honest "on-chain verification unavailable" state (never a spurious green).
 * `reader` is injectable so tests replay recorded PDA bytes hermetically; production uses the keeper's
 * own Connection.
 */
async function onChainDailyScoresRoot(statKey: number, reader?: AccountReader): Promise<OnChainScoreVerification | null> {
  const file = ONCHAIN_ROOT_PROOF_BY_STATKEY[statKey] ?? DEFAULT_ONCHAIN_ROOT_PROOF;
  const raw = loadJson(join(FIXDIR, file));
  const proof = raw.proof ?? raw;
  try {
    return await verifyScoresStatProofOnChain(CONFIG.rpcUrl, proof, reader ?? rpcConn(), { programId: CONFIG.oracleProgram });
  } catch {
    return null; // RPC unreachable / PDA read failed — fall through to the honest-unavailable receipt
  }
}

export async function buildReceipt(m: Market, reader?: AccountReader): Promise<ProofReceipt> {
  const proofRaw = loadJson(join(FIXDIR, m.fixtureProofFile));
  const proof = proofRaw.proof ?? proofRaw;
  // leg-0 stat (the market question's anchor stat)
  const stat = Array.isArray(proof.statsToProve)
    ? (proof.statsToProve[0].stat ?? proof.statsToProve.find((s: any) => s.key === m.statKey) ?? proof.statsToProve[0])
    : proof.statToProve;
  const triple = { key: stat.key, value: stat.value, period: stat.period };
  const leafHash = "0x" + Buffer.from(statLeaf(triple)).toString("hex");
  const desc = describeStatKey(triple.key);

  const oc = await onChainDailyScoresRoot(m.statKey, reader);
  const norm = (h: string) => "0x" + h.replace(/^0x/, "");
  // A verdict is only real when we reconstructed the root AND read a root from the on-chain PDA. Never
  // fabricate equality — on a trust product a spurious green check is the worst bug class, so absent a
  // live on-chain root we show "unverified" (and hide the reconstructed value so the UI can't misread
  // it as a red mismatch). computedRootHex is a client-side reconstruction from the proof; onChainRootHex
  // is null when the PDA read failed / the PDA doesn't exist on this cluster.
  const computed: string | null = oc?.computedRootHex ? norm(oc.computedRootHex) : null;
  const onChainRoot: string | null = oc?.onChainRootHex ? norm(oc.onChainRootHex) : null;
  const haveVerdict = !!(computed && onChainRoot);
  const match = haveVerdict && computed === onChainRoot;
  const verified = haveVerdict && (oc?.verified ?? false) === true && match;
  const epochDay = oc?.epochDay ?? 20649;
  const settlement = store.get(m.id);

  const onChainPlain = !haveVerdict
    ? `On-chain verification is currently unavailable (the keeper could not read the daily_scores_roots PDA over RPC). We are NOT asserting a match — re-open once the RPC endpoint is reachable to confirm the reconstructed root against the anchored PDA.`
    : match
      ? `TxLINE anchored that exact daily root on Solana in the daily_scores_roots PDA. Your reconstructed root ${computed!.slice(0, 10)}… EQUALS the on-chain root ${onChainRoot!.slice(0, 10)}… — so the result is exactly what Solana recorded. No committee, no vote: the proof is the resolution.`
      : `The reconstructed root ${computed!.slice(0, 10)}… does NOT equal the on-chain root ${onChainRoot!.slice(0, 10)}… — this proof would be rejected. Settlement never proceeds on a mismatch.`;

  return {
    marketId: m.id,
    fixtureId: CONFIG.demoFixtureId,
    statLabel: desc.label,
    statTriple: triple,
    predicate: m.predicateLabel,
    outcome: settlement ? settlement.outcome : null,
    verified,
    chain: {
      leaf: {
        title: "1 · The stat leaf",
        plain: `The single fact "${desc.label} = ${triple.value}" is hashed into one Merkle leaf. Nothing else about the match is in this leaf.`,
        hashHex: leafHash,
      },
      subtree: {
        title: "2 · The fixture's event-stats subtree",
        plain: `The leaf's sibling hashes fold upward into this fixture's event-stats subtree root — proving the stat belongs to THIS match, untouched.`,
        hashHex: hex(proof.summary?.eventStatsSubTreeRoot ?? proof.eventStatRoot),
      },
      dailyRoot: {
        title: "3 · The day's anchored root",
        plain: haveVerdict
          ? `That subtree folds into the root of every stat TxLINE recorded on epoch day ${epochDay}. This root is reconstructed from your proof, client-side.`
          : `That subtree folds into the day's root of every stat TxLINE recorded (epoch day ${epochDay}). We hold off showing the reconstructed value until the on-chain PDA read succeeds and we can compare the two.`,
        hashHex: haveVerdict ? computed! : "(unavailable — on-chain PDA read offline)",
        epochDay,
      },
      onChain: {
        title: "4 · The on-chain match",
        plain: onChainPlain,
        pda: oc?.pda ?? CONFIG.dailyScoresRootsPda,
        onChainRootHex: haveVerdict ? onChainRoot! : "(unavailable)",
        computedRootHex: haveVerdict ? computed! : "(unavailable)",
        match,
      },
    },
    settleTx: settlement?.txids.resolve ?? null,
    escrowProgram: CONFIG.programId,
    oracleProgram: CONFIG.oracleProgram,
  };
}
