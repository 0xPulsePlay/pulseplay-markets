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
import { statLeaf, describeStatKey } from "@txline/verify";
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
function program() {
  if (_program) return _program;
  const idl = loadJson(IDL_PATH);
  _conn = new Connection(CONFIG.rpcUrl, "confirmed");
  _operator = Keypair.fromSecretKey(Uint8Array.from(loadJson(CONFIG.walletKeypairPath)));
  const provider = new anchor.AnchorProvider(_conn, new anchor.Wallet(_operator), { commitment: "confirmed" });
  _program = new anchor.Program(idl, provider);
  return _program;
}

// ── SPL wagering token (Phase 1) ─────────────────────────────────────────────────────────────────
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
 *  airdrop RPC is rate-limited hard enough to fail outright under any real usage (confirmed last
 *  night — see BLOCKED.md), but an ordinary transfer from a wallet we already funded has no such limit. */
async function fundGas(conn: anchor.web3.Connection, to: anchor.web3.PublicKey, sol: number) {
  if (CONFIG.cluster !== "devnet") return airdrop(conn, to, sol);
  const from = _operator!;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const tx = new anchor.web3.Transaction({ feePayer: from.publicKey, blockhash, lastValidBlockHeight })
    .add(SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: Math.round(sol * LAMPORTS_PER_SOL) }));
  await anchor.web3.sendAndConfirmTransaction(conn, tx, [from], { commitment: "confirmed" });
}

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
  settledAt: number;
  proofFile: string;
  generation: "V1" | "V2" | "V3";
}

const store = new Map<string, SettleResult>();
export const getSettlement = (id: string) => store.get(id);
export const allSettlements = () => [...store.values()];

/** Run the full trustless lifecycle for a market on-chain. Idempotent-ish: re-runs with a fresh authority. */
export async function settleMarket(m: Market): Promise<SettleResult> {
  const prog = program();
  const conn = _conn!;
  const mint = await wagerMint();
  // V1 (Outcomes) on devnet: try a LIVE proof straight from TxLINE's devnet API first — confirmed
  // working (see docs/TXLINE-INTEGRATION.md "Devnet"). Falls back to the recorded fixture for V2/V3
  // (not yet confirmed live) or if the live fetch fails for any reason (offline, no cached token, …).
  const live = m.generation === "V1" ? await liveDevnetProof(m.statKey, m.period) : null;
  const proof = live ?? (loadJson(join(FIXDIR, m.fixtureProofFile)).proof
    ? loadJson(join(FIXDIR, m.fixtureProofFile)).proof // V1 recorded files wrap under .proof
    : loadJson(join(FIXDIR, m.fixtureProofFile))); // V3 files are bare
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

  // Localnet clones ONE daily_scores_roots PDA for the recorded fixture (fixed). A live devnet proof
  // can land on any epoch day, so its PDA must be derived from the proof's own timestamp instead.
  const dailyPda = live ? dailyScoresRootsPdaFromTimestamp(ORACLE, proof.summary.updateStats.minTimestamp) : dailyScoresRootsPda();

  const cu = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })];
  let resolve: string;
  if (m.generation === "V1") {
    resolve = await prog.methods.resolveOutcome(outcomeArgs(proof, m.statKey, m.period))
      .accounts({ market, dailyScoresRoots: dailyPda, txoracleProgram: ORACLE }).preInstructions(cu).rpc();
  } else if (m.generation === "V2") {
    resolve = await prog.methods.resolveCombo(comboArgs(proof))
      .accounts({ market, dailyScoresRoots: dailyScoresRootsPda(), txoracleProgram: ORACLE }).preInstructions(cu).rpc();
  } else {
    resolve = await prog.methods.resolveTicket(ticketArgs(proof))
      .accounts({ market, dailyScoresRoots: dailyScoresRootsPda(), txoracleProgram: ORACLE }).preInstructions(cu).rpc();
  }
  const account = await prog.account.market.fetch(market);
  const outcome: boolean = account.outcome;

  // winner claims the pot (if there is a winning side with stake)
  const winner = outcome ? yesBettor : noBettor;
  const claim = await prog.methods.claim()
    .accounts({
      owner: winner.publicKey, market, mint, vault, ownerTokenAccount: ataOf(winner.publicKey),
      position: posPda(winner.publicKey, outcome), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([winner]).rpc();

  const result: SettleResult = {
    marketId: m.id, outcome, winningSide: outcome ? "YES" : "NO", potBaseUnits: String(3 * oneToken),
    mint: mint.toBase58(), mintDecimals: CONFIG.wagerMintDecimals, mintLabel: CONFIG.wagerMintLabel,
    market: market.toBase58(), vault: vault.toBase58(), txids: { create, depositYes, depositNo, resolve, claim },
    settledAt: Date.now(), proofFile: m.fixtureProofFile, generation: m.generation,
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

const validationCache = new Map<string, any>();
async function engineValidation(statKey: number): Promise<any> {
  const key = String(statKey);
  if (validationCache.has(key)) return validationCache.get(key);
  const url = `${CONFIG.engineUrl}/v1/validation/scores?fixtureId=${CONFIG.demoFixtureId}&seq=${DEMO_SEQ}&statKeys=${statKey}&verify=1`;
  const res = await fetch(url);
  const j = await res.json();
  validationCache.set(key, j);
  return j;
}

export async function buildReceipt(m: Market): Promise<ProofReceipt> {
  const proofRaw = loadJson(join(FIXDIR, m.fixtureProofFile));
  const proof = proofRaw.proof ?? proofRaw;
  // leg-0 stat (the market question's anchor stat)
  const stat = Array.isArray(proof.statsToProve)
    ? (proof.statsToProve[0].stat ?? proof.statsToProve.find((s: any) => s.key === m.statKey) ?? proof.statsToProve[0])
    : proof.statToProve;
  const triple = { key: stat.key, value: stat.value, period: stat.period };
  const leafHash = "0x" + Buffer.from(statLeaf(triple)).toString("hex");
  const desc = describeStatKey(triple.key);

  const v = await engineValidation(m.statKey).catch(() => null);
  const oc = v?.onChain ?? null;
  const norm = (h: string) => "0x" + h.replace(/^0x/, "");
  // A verdict is only real when the engine returned BOTH roots. Never fabricate equality — on a trust
  // product a spurious green check is the worst bug class, so absent a verdict we show "unverified".
  const computed: string | null = oc?.computedRootHex ? norm(oc.computedRootHex) : null;
  const onChainRoot: string | null = oc?.onChainRootHex ? norm(oc.onChainRootHex) : null;
  const haveVerdict = !!(computed && onChainRoot);
  const match = haveVerdict && computed === onChainRoot;
  const verified = haveVerdict && (oc?.verified ?? oc?.subTreeVerified ?? false) === true && match;
  const epochDay = oc?.epochDay ?? 20649;
  const settlement = store.get(m.id);

  const onChainPlain = !haveVerdict
    ? `On-chain verification is currently unavailable (the engine's read-only verify call did not return a verdict). We are NOT asserting a match — re-open once the engine is reachable to confirm the reconstructed root against the anchored PDA.`
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
          : `That subtree folds into the day's root of every stat TxLINE recorded (epoch day ${epochDay}). The reconstructed value is unavailable until the engine verify call succeeds.`,
        hashHex: computed ?? "(unavailable — engine verify offline)",
        epochDay,
      },
      onChain: {
        title: "4 · The on-chain match",
        plain: onChainPlain,
        pda: oc?.pda ?? CONFIG.dailyScoresRootsPda,
        onChainRootHex: onChainRoot ?? "(unavailable)",
        computedRootHex: computed ?? "(unavailable)",
        match,
      },
    },
    settleTx: settlement?.txids.resolve ?? null,
    escrowProgram: CONFIG.programId,
    oracleProgram: CONFIG.oracleProgram,
  };
}
