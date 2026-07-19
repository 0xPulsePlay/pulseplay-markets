/**
 * Integration suite for pulseplay_escrow against a local validator that clones the REAL TxLINE oracle
 * program (9Exb…) + the recorded daily_scores_roots PDA (6d9bJ2Et…). Drives the full trustless flow
 * with recorded proofs, one section per acceptance criterion:
 *
 *   P2.2  V1 YES payout + claim              (Outcomes / resolve_outcome, England goals > 0 → YES)
 *   P2.3  V1 NO sentinel-zero               (Outcomes, "red card shown?" key5=0 → NO wins, absence proven)
 *   P2.4  tampered V1 proof reverts          (fail-closed; StatMismatch guard + oracle CPI revert)
 *   P2.5  V3 combo — 4 legs in ONE CPI       (Combos / resolve_ticket, full coverage)
 *   P2.6  V3 derived binary — corner diff     (Batch / resolve_ticket, Binary Subtract in one CPI)
 *   P2.7  tampered V3 leg reverts + cancel/refund timeout path
 *
 * Escrow custody uses a classic-SPL-Token vault (an ATA owned
 * by the market PDA). Every section above is unchanged in BEHAVIOR (side tracking, winner-take-all
 * math, cancel/refund, fail-closed proofs) — only the asset-movement plumbing changed from
 * `system_program::transfer` to `anchor_spl::token::transfer`. New checks:
 *
 *   P1.4a wrong-mint deposit is rejected (WrongMint) — a bogus mint can't redirect state updates
 *         away from the market's real vault
 *   P1.4b wrong-mint claim/refund accounts are rejected (WrongMint)
 *
 * SAFETY: localhost only. Nothing signs mainnet. The mint created below is a fresh LOCAL test token —
 * not the real devnet "USDC (Devnet Test)" mint (that one lives on devnet).
 */
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert";
import os from "node:os";
import {
  createMint, getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, getAccount,
  mintTo, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const { web3 } = anchor;
const { Connection, Keypair, PublicKey, ComputeBudgetProgram, LAMPORTS_PER_SOL, SystemProgram } = web3;

const HERE = dirname(fileURLToPath(import.meta.url));
const RPC = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const ORACLE = new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
const DAILY_SCORES_ROOTS = new PublicKey("6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE");
const idl = JSON.parse(readFileSync(join(HERE, "..", "target", "idl", "pulseplay_escrow.json"), "utf8"));
const FIXDIR = join(HERE, "..", "fixtures");
const load = (name: string) => JSON.parse(readFileSync(join(FIXDIR, name), "utf8"));

const KIND_OUTCOME = 0, KIND_COMBO = 1, KIND_BATCH = 2;
const GT = 0, LT = 1, EQ = 2;
const OP_NONE = 0, OP_ADD = 1, OP_SUB = 2;
const DECIMALS = 6;
const ONE = 10 ** DECIMALS; // 1 test-USDC in base units

const loadWallet = (p: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const i64le = (n: number | BN) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32le = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i32le = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const node = (n: { hash: number[]; isRightSibling: boolean }) => ({ hash: n.hash, isRightSibling: n.isRightSibling });

async function airdrop(conn: anchor.web3.Connection, to: anchor.web3.PublicKey, sol: number) {
  const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  await conn.confirmTransaction(sig, "confirmed");
}

// ── proof → args mappers ──────────────────────────────────────────────────────────────────────────
const summaryArg = (s: any) => ({
  fixtureId: new BN(s.fixtureId),
  updateStats: {
    updateCount: s.updateStats.updateCount,
    minTimestamp: new BN(s.updateStats.minTimestamp),
    maxTimestamp: new BN(s.updateStats.maxTimestamp),
  },
  eventsSubTreeRoot: s.eventStatsSubTreeRoot,
});

// single-stat V1 proof (live-endpoint singular shape: statToProve / statProof)
const outcomeArgsSingular = (p: any) => ({
  ts: new BN(p.summary.updateStats.minTimestamp),
  summary: summaryArg(p.summary),
  fixtureProof: p.subTreeProof.map(node),
  mainTreeProof: p.mainTreeProof.map(node),
  statA: { scoreStat: p.statToProve, eventStatRoot: p.eventStatRoot, statProof: p.statProof.map(node) },
});

// multi-stat V1 proof (recorded plural shape: statsToProve / statProofs) → settle on statIndex
const outcomeArgsPlural = (p: any, statIndex: number) => ({
  ts: new BN(p.summary.updateStats.minTimestamp),
  summary: summaryArg(p.summary),
  fixtureProof: p.subTreeProof.map(node),
  mainTreeProof: p.mainTreeProof.map(node),
  statA: { scoreStat: p.statsToProve[statIndex], eventStatRoot: p.eventStatRoot, statProof: p.statProofs[statIndex].map(node) },
});

const ticketArgs = (v: any) => ({
  ts: new BN(v.summary.updateStats.minTimestamp),
  summary: summaryArg(v.summary),
  subTreeProof: v.subTreeProof.map(node),
  mainTreeProof: v.mainTreeProof.map(node),
  eventStatRoot: v.eventStatRoot,
  statsToProve: v.statsToProve.map((e: any) => ({ stat: e.stat, statProof: e.statProof.map(node) })),
  multiproof: { hashes: v.multiproof.hashes.map(node), indices: v.multiproof.indices },
});

let program: any, conn: anchor.web3.Connection, cutoff: BN, deadline: BN, MINT: anchor.web3.PublicKey;
let PAYER: anchor.web3.Keypair; // funder + mint authority for the local test-USDC mint
let passed = 0;
const ok = (msg: string) => { passed++; console.log("  ✓", msg); };

function marketPda(authority: anchor.web3.PublicKey, fixtureId: number, statKey: number, period: number) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.toBuffer(), i64le(fixtureId), u32le(statKey), i32le(period)],
    program.programId,
  );
  return market;
}
const vaultFor = (market: anchor.web3.PublicKey, mint: anchor.web3.PublicKey) =>
  getAssociatedTokenAddressSync(mint, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const positionPda = (market: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, side: boolean) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer(), Buffer.from([side ? 1 : 0])],
    program.programId,
  )[0];

const tokenBalance = async (addr: anchor.web3.PublicKey): Promise<bigint> => (await getAccount(conn, addr)).amount;

const createMarketAccounts = (authority: anchor.web3.PublicKey, market: anchor.web3.PublicKey, mint = MINT) => ({
  authority, market, mint, vault: vaultFor(market, mint),
  tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
});
const depositAccounts = (depositor: anchor.web3.PublicKey, market: anchor.web3.PublicKey, position: anchor.web3.PublicKey, mint = MINT) => ({
  depositor, market, mint, vault: vaultFor(market, mint),
  depositorTokenAccount: getAssociatedTokenAddressSync(mint, depositor, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
  position, tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
});
const claimAccounts = (owner: anchor.web3.PublicKey, market: anchor.web3.PublicKey, position: anchor.web3.PublicKey, mint = MINT) => ({
  owner, market, mint, vault: vaultFor(market, mint),
  ownerTokenAccount: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID),
  position, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
});

/** A funded test wallet: SOL for gas/rent + `tokens` (whole units) of the test mint in its ATA. */
async function fundedWallet(sol = 5, tokens = 10) {
  const kp = Keypair.generate();
  await airdrop(conn, kp.publicKey, sol);
  await getOrCreateAssociatedTokenAccount(conn, PAYER, MINT, kp.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  if (tokens > 0) {
    await mintTo(conn, PAYER, MINT, getAssociatedTokenAddressSync(MINT, kp.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID), PAYER, tokens * ONE, [], undefined, TOKEN_PROGRAM_ID);
  }
  return kp;
}
// Authorities that only create/cancel markets never move tokens — SOL-only, no ATA needed.
async function newAuthority(sol = 5) {
  const kp = Keypair.generate();
  await airdrop(conn, kp.publicKey, sol);
  return kp;
}

async function main() {
  conn = new Connection(RPC, "confirmed");
  PAYER = loadWallet(join(os.homedir(), ".config", "solana", "id.json"));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(PAYER), { commitment: "confirmed" });
  anchor.setProvider(provider);
  program = new anchor.Program(idl, provider);
  try { await airdrop(conn, PAYER.publicKey, 100); } catch { /* already funded */ }
  cutoff = new BN(Math.floor(Date.now() / 1000) + 3600);
  deadline = new BN(Math.floor(Date.now() / 1000) + 7200);

  console.log("\nPulsePlay escrow — trustless settlement suite (local validator, real cloned oracle)\n");

  MINT = await createMint(conn, PAYER, PAYER.publicKey, null, DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID);
  ok(`P1 setup: local test-USDC mint created (${MINT.toBase58()}, ${DECIMALS} decimals)`);

  // ── P2.2 OUTCOMES V1: "England goals > 0" → YES; alice (YES) sweeps the pot ─────────────────────
  {
    const kp = await newAuthority();
    const alice = await fundedWallet(); const bob = await fundedWallet();
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof; // stat0 = key1 (goals home) = 1
    const stat = p.statsToProve[0];
    const market = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period);
    const vault = vaultFor(market, MINT);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    const two = new BN(2 * ONE), one = new BN(ONE);
    await program.methods.deposit(true, two)
      .accounts(depositAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    await program.methods.deposit(false, one)
      .accounts(depositAccounts(bob.publicKey, market, positionPda(market, bob.publicKey, false))).signers([bob]).rpc();
    assert.equal(await tokenBalance(vault), BigInt(3 * ONE));
    await program.methods.resolveOutcome(outcomeArgsPlural(p, 0))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true); assert.equal(m.outcome, true, "goals(1) > 0 → YES, program-attested");
    assert.equal(m.mint.toBase58(), MINT.toBase58(), "market records its wagering mint");
    ok("P2.2 V1 Outcome resolved YES (CPI validate_stat), pot = 3 test-USDC (SPL vault)");
    const aliceAta = getAssociatedTokenAddressSync(MINT, alice.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const before = await tokenBalance(aliceAta);
    await program.methods.claim()
      .accounts(claimAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    assert.equal((await tokenBalance(aliceAta)) - before, BigInt(3 * ONE), "alice claimed exactly the 3-token pot");
    await assert.rejects(
      program.methods.claim().accounts(claimAccounts(bob.publicKey, market, positionPda(market, bob.publicKey, false))).signers([bob]).rpc(),
      /NotAWinner/, "loser rejected");
    ok("P2.2 claim: winner swept the SPL-token pot, loser rejected (NotAWinner)");
  }

  // ── P2.3 SENTINEL-ZERO: "Red card shown?" key5=0 → predicate FALSE → NO wins (absence proven) ────
  {
    const kp = await newAuthority();
    const yesBettor = await fundedWallet(); const noBettor = await fundedWallet();
    const p = load("scores-proof-18241006-key5-redcard.json").proof; // statToProve = { key:5, value:0, period:5 }
    const stat = p.statToProve;
    assert.equal(stat.value, 0, "red card stat is a provable zero (sentinel)");
    const market = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period);
    const vault = vaultFor(market, MINT);
    // "Will a red card be shown?" comparison GT 0. value 0 > 0 = FALSE → outcome NO.
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    const one = new BN(ONE);
    await program.methods.deposit(true, one).accounts(depositAccounts(yesBettor.publicKey, market, positionPda(market, yesBettor.publicKey, true))).signers([yesBettor]).rpc();
    await program.methods.deposit(false, one.muln(3)).accounts(depositAccounts(noBettor.publicKey, market, positionPda(market, noBettor.publicKey, false))).signers([noBettor]).rpc();
    await program.methods.resolveOutcome(outcomeArgsSingular(p))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true); assert.equal(m.outcome, false, "no red card → predicate FALSE → NO");
    ok("P2.3 sentinel-zero: 'no red card' proven cryptographically (value 0), outcome = NO");
    const noAta = getAssociatedTokenAddressSync(MINT, noBettor.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const before = await tokenBalance(noAta);
    await program.methods.claim().accounts(claimAccounts(noBettor.publicKey, market, positionPda(market, noBettor.publicKey, false))).signers([noBettor]).rpc();
    assert.equal((await tokenBalance(noAta)) - before, BigInt(4 * ONE), "NO bettor claimed the 4-token pot");
    ok("P2.3 NO-side payout: NO bettor swept the pot on a cryptographically-proven absence");
  }

  // ── P2.4 FAIL-CLOSED (V1): StatMismatch guard + tampered proof reverts the oracle CPI ────────────
  {
    const kp = await newAuthority();
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof;
    const stat = p.statsToProve[0];
    // (a) market whose period the proof does NOT match → StatMismatch before the CPI
    const mmMarket = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 1000);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 1000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, mmMarket)).signers([kp]).rpc();
    await assert.rejects(
      program.methods.resolveOutcome(outcomeArgsPlural(p, 0)).accounts({ market: mmMarket, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      /StatMismatch/, "proof stat/period must match the market");
    ok("P2.4 StatMismatch guard rejects a proof bound to the wrong market");
    // (b) tampered proof (flip a statProof byte) reaches the CPI and the oracle reverts it
    const tpMarket = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 2000);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 2000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, tpMarket)).signers([kp]).rpc();
    const tampered = outcomeArgsPlural(p, 0);
    tampered.statA.scoreStat = { ...tampered.statA.scoreStat, period: stat.period + 2000 }; // pass the guard
    tampered.statA.statProof = JSON.parse(JSON.stringify(tampered.statA.statProof));
    tampered.statA.statProof[0].hash[0] ^= 0xff; // corrupt the Merkle path
    await assert.rejects(
      program.methods.resolveOutcome(tampered).accounts({ market: tpMarket, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      "tampered proof must make the oracle CPI revert");
    assert.equal((await program.account.market.fetch(tpMarket)).resolved, false, "tampered resolve left market unresolved");
    ok("P2.4 fail-closed: a tampered Merkle proof reverts the CPI; market stays unresolved");
  }

  // ── P2.5 COMBOS V3: verify 4 legs (keys 1,2,3,4) in ONE CPI, full coverage ───────────────────────
  {
    const kp = await newAuthority();
    const v = load("scores-proof-v3-18241006-keys1-2-3-4.json");
    const leg0 = v.statsToProve[0].stat; // { key:1, value:1, period:5 }
    const market = marketPda(kp.publicKey, v.summary.fixtureId, leg0.key, leg0.period);
    // full-coverage market: leg0 EqualTo its value (combine_op 0). Covers every proven stat.
    await program.methods.createMarket(new BN(v.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    await program.methods.resolveTicket(ticketArgs(v))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true, "V3 combo resolved — all 4 legs verified atomically in one CPI");
    ok(`P2.5 V3 combo: validate_stat_v3 verified 4 legs (keys 1,2,3,4) in ONE call (outcome=${m.outcome})`);
  }

  // ── P2.5b COMBOS V2: indexed multi-leg via validate_stat_v2 (no multiproof), one CPI settles ticket ─
  {
    const kp = await newAuthority();
    const alice = await fundedWallet(); const bob = await fundedWallet();
    const p = load("scores-proof-v2-18241006-keys1-2-3.json").proof; // plural: statsToProve[] + statProofs[]
    const leg0 = p.statsToProve[0]; // { key:1, value:1, period:5 }
    const market = marketPda(kp.publicKey, p.summary.fixtureId, leg0.key, leg0.period);
    const v2Args = {
      ts: new BN(p.summary.updateStats.minTimestamp),
      summary: summaryArg(p.summary),
      subTreeProof: p.subTreeProof.map(node),
      mainTreeProof: p.mainTreeProof.map(node),
      eventStatRoot: p.eventStatRoot,
      statsToProve: p.statsToProve.map((s: any, i: number) => ({ stat: s, statProof: p.statProofs[i].map(node) })),
    };
    // "England 1 ∧ Argentina 2 ∧ Eng yellows 1 ∧ Arg yellows 3" — full-coverage EqualTo each → YES.
    await program.methods.createMarket(new BN(p.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    const one = new BN(ONE);
    await program.methods.deposit(true, one.muln(2)).accounts(depositAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    await program.methods.deposit(false, one).accounts(depositAccounts(bob.publicKey, market, positionPda(market, bob.publicKey, false))).signers([bob]).rpc();
    await program.methods.resolveCombo(v2Args)
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true, "V2 combo resolved via validate_stat_v2");
    assert.equal(m.outcome, true, "all 4 legs matched their claimed values → YES");
    ok(`P2.5b V2 combo: validate_stat_v2 indexed strategy settled a 3-leg ticket in ONE CPI (outcome=${m.outcome})`);
    // fail-closed: tamper one leg's membership path → the oracle reverts the whole V2 CPI
    const kp2 = await newAuthority();
    const mmMarket = marketPda(kp2.publicKey, p.summary.fixtureId, leg0.key, leg0.period);
    await program.methods.createMarket(new BN(p.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts(createMarketAccounts(kp2.publicKey, mmMarket)).signers([kp2]).rpc();
    const bad = JSON.parse(JSON.stringify(v2Args));
    bad.ts = new BN(p.summary.updateStats.minTimestamp);
    bad.summary.fixtureId = new BN(p.summary.fixtureId);
    bad.summary.updateStats.minTimestamp = new BN(p.summary.updateStats.minTimestamp);
    bad.summary.updateStats.maxTimestamp = new BN(p.summary.updateStats.maxTimestamp);
    bad.statsToProve[1].statProof[0].hash[0] ^= 0xff;
    await assert.rejects(
      program.methods.resolveCombo(bad).accounts({ market: mmMarket, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      "tampered V2 leg must revert the CPI");
    assert.equal((await program.account.market.fetch(mmMarket)).resolved, false, "tampered V2 stays unresolved");
    ok("P2.5b V2 fail-closed: a tampered leg reverts the whole validate_stat_v2 CPI");
  }

  // ── P2.6 BATCH V3 derived binary: corner difference (home − away) settled in one CPI ─────────────
  {
    const kp = await newAuthority();
    const d = load("scores-proof-v3-18241006-keys7-8.json"); // key7=1 (home corners), key8=6 (away)
    const leg0 = d.statsToProve[0].stat; // { key:7, value:1, period:5 }
    const diff = d.statsToProve[0].stat.value - d.statsToProve[1].stat.value; // 1 − 6 = -5
    const market = marketPda(kp.publicKey, d.summary.fixtureId, leg0.key, leg0.period);
    // "home corners − away corners == diff", combine_op 2 = Subtract, comparison EQ.
    await program.methods.createMarket(new BN(d.summary.fixtureId), leg0.key, leg0.period, diff, EQ, cutoff, deadline, OP_SUB, KIND_BATCH)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    await program.methods.resolveTicket(ticketArgs(d))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true); assert.equal(m.outcome, true, `derived (leg0 − leg1 == ${diff}) settled YES`);
    ok(`P2.6 V3 derived: binary predicate (corner diff == ${diff}) settled YES in one CPI`);
  }

  // ── P2.7a FAIL-CLOSED (V3): tampering any leg (a multiproof hash) reverts the whole CPI ──────────
  {
    const kp = await newAuthority();
    const v = load("scores-proof-v3-18241006-keys1-2-3-4.json");
    const leg0 = v.statsToProve[0].stat;
    const market = marketPda(kp.publicKey, v.summary.fixtureId, leg0.key, leg0.period);
    await program.methods.createMarket(new BN(v.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    const bad = ticketArgs(v);
    bad.multiproof.hashes = JSON.parse(JSON.stringify(bad.multiproof.hashes));
    bad.multiproof.hashes[0].hash[0] ^= 0xff;
    await assert.rejects(
      program.methods.resolveTicket(bad).accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      "tampered V3 multiproof must revert the CPI");
    assert.equal((await program.account.market.fetch(market)).resolved, false, "tampered V3 stays unresolved");
    ok("P2.7a V3 fail-closed: a tampered leg reverts the whole multiproof CPI");
  }

  // ── P2.7b CANCEL / TIMEOUT + REFUND: authority cancels, both sides reclaim exact stakes ──────────
  {
    const kp = await newAuthority();
    const alice = await fundedWallet(); const bob = await fundedWallet();
    // a market on a real stat, but we cancel instead of resolving (simulates oracle-never-anchored).
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof;
    const stat = p.statsToProve[0];
    const market = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 3000);
    const vault = vaultFor(market, MINT);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 3000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();
    const one = new BN(ONE);
    await program.methods.deposit(true, one.muln(2)).accounts(depositAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    await program.methods.deposit(false, one).accounts(depositAccounts(bob.publicKey, market, positionPda(market, bob.publicKey, false))).signers([bob]).rpc();
    await program.methods.cancel().accounts({ signer: kp.publicKey, market }).signers([kp]).rpc();
    assert.equal((await program.account.market.fetch(market)).cancelled, true, "authority cancelled the market");
    const aliceAta = getAssociatedTokenAddressSync(MINT, alice.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const bobAta = getAssociatedTokenAddressSync(MINT, bob.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    const aBefore = await tokenBalance(aliceAta);
    await program.methods.refund().accounts(claimAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    const bBefore = await tokenBalance(bobAta);
    await program.methods.refund().accounts(claimAccounts(bob.publicKey, market, positionPda(market, bob.publicKey, false))).signers([bob]).rpc();
    assert.equal((await tokenBalance(aliceAta)) - aBefore, BigInt(2 * ONE), "alice refunded 2 test-USDC");
    assert.equal((await tokenBalance(bobAta)) - bBefore, BigInt(1 * ONE), "bob refunded 1 test-USDC");
    assert.equal(await tokenBalance(vault), BigInt(0), "vault emptied after refunds");
    ok("P2.7b cancel/timeout + refund: both sides reclaimed exact stakes, SPL vault emptied");
  }

  // ── P1.4a/b WRONG-MINT REJECTION: a bogus mint can never redirect state away from the real vault ──
  {
    const kp = await newAuthority();
    const alice = await fundedWallet();
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof;
    const stat = p.statsToProve[0];
    // Fresh authority (kp) already makes this market PDA unique — no period offset needed, and the
    // real period keeps `outcomeArgsPlural(p, 0)` valid for the later resolveOutcome call below.
    const market = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts(createMarketAccounts(kp.publicKey, market)).signers([kp]).rpc();

    // A second, unrelated mint the market was NOT created with. ATAs are permissionlessly creatable
    // by anyone for any (owner, mint) pair, so a realistic attacker can — and here does — pre-create
    // an ATA(market, wrongMint) themselves and point `vault` at it; this is what actually exercises
    // the program's `WrongMint` check rather than failing earlier on an uninitialized account.
    const wrongMint = await createMint(conn, PAYER, PAYER.publicKey, null, DECIMALS, undefined, undefined, TOKEN_PROGRAM_ID);
    await getOrCreateAssociatedTokenAccount(conn, PAYER, wrongMint, market, true, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    await getOrCreateAssociatedTokenAccount(conn, alice, wrongMint, alice.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    await mintTo(conn, PAYER, wrongMint, getAssociatedTokenAddressSync(wrongMint, alice.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID), PAYER, 5 * ONE, [], undefined, TOKEN_PROGRAM_ID);

    await assert.rejects(
      program.methods.deposit(true, new BN(ONE))
        .accounts(depositAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true), wrongMint))
        .signers([alice]).rpc(),
      /WrongMint/, "deposit with a mint other than the market's recorded mint must be rejected");
    ok("P1.4a wrong-mint deposit rejected (WrongMint) — real vault untouched");

    // deposit for real with the correct mint, resolve, then try to CLAIM with the wrong mint's accounts
    await program.methods.deposit(true, new BN(ONE)).accounts(depositAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true))).signers([alice]).rpc();
    await program.methods.resolveOutcome(outcomeArgsPlural(p, 0))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    await assert.rejects(
      program.methods.claim()
        .accounts(claimAccounts(alice.publicKey, market, positionPda(market, alice.publicKey, true), wrongMint))
        .signers([alice]).rpc(),
      /WrongMint/, "claim with a mint other than the market's recorded mint must be rejected");
    ok("P1.4b wrong-mint claim rejected (WrongMint) — winner must claim through the real mint/vault");
  }

  console.log(`\nALL PULSEPLAY ESCROW TESTS PASSED (${passed} checks)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
