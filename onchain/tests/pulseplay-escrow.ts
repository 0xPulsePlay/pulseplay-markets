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
 * SAFETY: localhost only. Nothing signs mainnet.
 */
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { strict as assert } from "node:assert";
import os from "node:os";

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

let program: any, conn: anchor.web3.Connection, cutoff: BN, deadline: BN;
let passed = 0;
const ok = (msg: string) => { passed++; console.log("  ✓", msg); };

function marketPda(authority: anchor.web3.PublicKey, fixtureId: number, statKey: number, period: number) {
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.toBuffer(), i64le(fixtureId), u32le(statKey), i32le(period)],
    program.programId,
  );
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), market.toBuffer()], program.programId);
  return { market, vault };
}
const positionPda = (market: anchor.web3.PublicKey, owner: anchor.web3.PublicKey, side: boolean) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer(), Buffer.from([side ? 1 : 0])],
    program.programId,
  )[0];

async function newAuthority(sol = 5) {
  const kp = Keypair.generate();
  await airdrop(conn, kp.publicKey, sol);
  return kp;
}

async function main() {
  conn = new Connection(RPC, "confirmed");
  const payer = loadWallet(join(os.homedir(), ".config", "solana", "id.json"));
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  program = new anchor.Program(idl, provider);
  try { await airdrop(conn, payer.publicKey, 100); } catch { /* already funded */ }
  cutoff = new BN(Math.floor(Date.now() / 1000) + 3600);
  deadline = new BN(Math.floor(Date.now() / 1000) + 7200);

  console.log("\nPulsePlay escrow — trustless settlement suite (local validator, real cloned oracle)\n");

  // ── P2.2 OUTCOMES V1: "England goals > 0" → YES; alice (YES) sweeps the pot ─────────────────────
  {
    const kp = await newAuthority();
    const alice = await newAuthority(); const bob = await newAuthority();
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof; // stat0 = key1 (goals home) = 1
    const stat = p.statsToProve[0];
    const { market, vault } = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    const oneSol = new BN(LAMPORTS_PER_SOL);
    await program.methods.deposit(true, oneSol.muln(2))
      .accounts({ depositor: alice.publicKey, market, vault, position: positionPda(market, alice.publicKey, true), systemProgram: SystemProgram.programId }).signers([alice]).rpc();
    await program.methods.deposit(false, oneSol)
      .accounts({ depositor: bob.publicKey, market, vault, position: positionPda(market, bob.publicKey, false), systemProgram: SystemProgram.programId }).signers([bob]).rpc();
    assert.equal(await conn.getBalance(vault), 3 * LAMPORTS_PER_SOL);
    await program.methods.resolveOutcome(outcomeArgsPlural(p, 0))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true); assert.equal(m.outcome, true, "goals(1) > 0 → YES, program-attested");
    ok("P2.2 V1 Outcome resolved YES (CPI validate_stat), pot = 3 SOL");
    const before = await conn.getBalance(alice.publicKey);
    await program.methods.claim()
      .accounts({ owner: alice.publicKey, market, vault, position: positionPda(market, alice.publicKey, true), systemProgram: SystemProgram.programId }).signers([alice]).rpc();
    assert.ok((await conn.getBalance(alice.publicKey)) - before > 2.9 * LAMPORTS_PER_SOL, "alice claimed ~3 SOL");
    await assert.rejects(
      program.methods.claim().accounts({ owner: bob.publicKey, market, vault, position: positionPda(market, bob.publicKey, false), systemProgram: SystemProgram.programId }).signers([bob]).rpc(),
      /NotAWinner/, "loser rejected");
    ok("P2.2 claim: winner swept the pot, loser rejected (NotAWinner)");
  }

  // ── P2.3 SENTINEL-ZERO: "Red card shown?" key5=0 → predicate FALSE → NO wins (absence proven) ────
  {
    const kp = await newAuthority();
    const yesBettor = await newAuthority(); const noBettor = await newAuthority();
    const p = load("scores-proof-18241006-key5-redcard.json").proof; // statToProve = { key:5, value:0, period:5 }
    const stat = p.statToProve;
    assert.equal(stat.value, 0, "red card stat is a provable zero (sentinel)");
    const { market, vault } = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period);
    // "Will a red card be shown?" comparison GT 0. value 0 > 0 = FALSE → outcome NO.
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    const oneSol = new BN(LAMPORTS_PER_SOL);
    await program.methods.deposit(true, oneSol).accounts({ depositor: yesBettor.publicKey, market, vault, position: positionPda(market, yesBettor.publicKey, true), systemProgram: SystemProgram.programId }).signers([yesBettor]).rpc();
    await program.methods.deposit(false, oneSol.muln(3)).accounts({ depositor: noBettor.publicKey, market, vault, position: positionPda(market, noBettor.publicKey, false), systemProgram: SystemProgram.programId }).signers([noBettor]).rpc();
    await program.methods.resolveOutcome(outcomeArgsSingular(p))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true); assert.equal(m.outcome, false, "no red card → predicate FALSE → NO");
    ok("P2.3 sentinel-zero: 'no red card' proven cryptographically (value 0), outcome = NO");
    const before = await conn.getBalance(noBettor.publicKey);
    await program.methods.claim().accounts({ owner: noBettor.publicKey, market, vault, position: positionPda(market, noBettor.publicKey, false), systemProgram: SystemProgram.programId }).signers([noBettor]).rpc();
    assert.ok((await conn.getBalance(noBettor.publicKey)) - before > 3.9 * LAMPORTS_PER_SOL, "NO bettor claimed the 4-SOL pot");
    ok("P2.3 NO-side payout: NO bettor swept the pot on a cryptographically-proven absence");
  }

  // ── P2.4 FAIL-CLOSED (V1): StatMismatch guard + tampered proof reverts the oracle CPI ────────────
  {
    const kp = await newAuthority();
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof;
    const stat = p.statsToProve[0];
    // (a) market whose period the proof does NOT match → StatMismatch before the CPI
    const mm = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 1000);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 1000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts({ authority: kp.publicKey, market: mm.market, vault: mm.vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    await assert.rejects(
      program.methods.resolveOutcome(outcomeArgsPlural(p, 0)).accounts({ market: mm.market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      /StatMismatch/, "proof stat/period must match the market");
    ok("P2.4 StatMismatch guard rejects a proof bound to the wrong market");
    // (b) tampered proof (flip a statProof byte) reaches the CPI and the oracle reverts it
    const tp = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 2000);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 2000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts({ authority: kp.publicKey, market: tp.market, vault: tp.vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    const tampered = outcomeArgsPlural(p, 0);
    tampered.statA.scoreStat = { ...tampered.statA.scoreStat, period: stat.period + 2000 }; // pass the guard
    tampered.statA.statProof = JSON.parse(JSON.stringify(tampered.statA.statProof));
    tampered.statA.statProof[0].hash[0] ^= 0xff; // corrupt the Merkle path
    await assert.rejects(
      program.methods.resolveOutcome(tampered).accounts({ market: tp.market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
        .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc(),
      "tampered proof must make the oracle CPI revert");
    assert.equal((await program.account.market.fetch(tp.market)).resolved, false, "tampered resolve left market unresolved");
    ok("P2.4 fail-closed: a tampered Merkle proof reverts the CPI; market stays unresolved");
  }

  // ── P2.5 COMBOS V3: verify 4 legs (keys 1,2,3,4) in ONE CPI, full coverage ───────────────────────
  {
    const kp = await newAuthority();
    const v = load("scores-proof-v3-18241006-keys1-2-3-4.json");
    const leg0 = v.statsToProve[0].stat; // { key:1, value:1, period:5 }
    const { market, vault } = marketPda(kp.publicKey, v.summary.fixtureId, leg0.key, leg0.period);
    // full-coverage market: leg0 EqualTo its value (combine_op 0). Covers every proven stat.
    await program.methods.createMarket(new BN(v.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    await program.methods.resolveTicket(ticketArgs(v))
      .accounts({ market, dailyScoresRoots: DAILY_SCORES_ROOTS, txoracleProgram: ORACLE })
      .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 10_000_000 })]).rpc();
    const m = await program.account.market.fetch(market);
    assert.equal(m.resolved, true, "V3 combo resolved — all 4 legs verified atomically in one CPI");
    ok(`P2.5 V3 combo: validate_stat_v3 verified 4 legs (keys 1,2,3,4) in ONE call (outcome=${m.outcome})`);
  }

  // ── P2.6 BATCH V3 derived binary: corner difference (home − away) settled in one CPI ─────────────
  {
    const kp = await newAuthority();
    const d = load("scores-proof-v3-18241006-keys7-8.json"); // key7=1 (home corners), key8=6 (away)
    const leg0 = d.statsToProve[0].stat; // { key:7, value:1, period:5 }
    const diff = d.statsToProve[0].stat.value - d.statsToProve[1].stat.value; // 1 − 6 = -5
    const { market, vault } = marketPda(kp.publicKey, d.summary.fixtureId, leg0.key, leg0.period);
    // "home corners − away corners == diff", combine_op 2 = Subtract, comparison EQ.
    await program.methods.createMarket(new BN(d.summary.fixtureId), leg0.key, leg0.period, diff, EQ, cutoff, deadline, OP_SUB, KIND_BATCH)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
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
    const { market, vault } = marketPda(kp.publicKey, v.summary.fixtureId, leg0.key, leg0.period);
    await program.methods.createMarket(new BN(v.summary.fixtureId), leg0.key, leg0.period, leg0.value, EQ, cutoff, deadline, OP_NONE, KIND_COMBO)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
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
    const alice = await newAuthority(); const bob = await newAuthority();
    // a market on a real stat, but we cancel instead of resolving (simulates oracle-never-anchored).
    const p = load("scores-proof-18241006-seq960-keys1-2.json").proof;
    const stat = p.statsToProve[0];
    const { market, vault } = marketPda(kp.publicKey, p.summary.fixtureId, stat.key, stat.period + 3000);
    await program.methods.createMarket(new BN(p.summary.fixtureId), stat.key, stat.period + 3000, 0, GT, cutoff, deadline, OP_NONE, KIND_OUTCOME)
      .accounts({ authority: kp.publicKey, market, vault, systemProgram: SystemProgram.programId }).signers([kp]).rpc();
    const oneSol = new BN(LAMPORTS_PER_SOL);
    await program.methods.deposit(true, oneSol.muln(2)).accounts({ depositor: alice.publicKey, market, vault, position: positionPda(market, alice.publicKey, true), systemProgram: SystemProgram.programId }).signers([alice]).rpc();
    await program.methods.deposit(false, oneSol).accounts({ depositor: bob.publicKey, market, vault, position: positionPda(market, bob.publicKey, false), systemProgram: SystemProgram.programId }).signers([bob]).rpc();
    await program.methods.cancel().accounts({ signer: kp.publicKey, market }).signers([kp]).rpc();
    assert.equal((await program.account.market.fetch(market)).cancelled, true, "authority cancelled the market");
    const aBefore = await conn.getBalance(alice.publicKey);
    await program.methods.refund().accounts({ owner: alice.publicKey, market, vault, position: positionPda(market, alice.publicKey, true), systemProgram: SystemProgram.programId }).signers([alice]).rpc();
    const bBefore = await conn.getBalance(bob.publicKey);
    await program.methods.refund().accounts({ owner: bob.publicKey, market, vault, position: positionPda(market, bob.publicKey, false), systemProgram: SystemProgram.programId }).signers([bob]).rpc();
    assert.ok((await conn.getBalance(alice.publicKey)) - aBefore > 1.99 * LAMPORTS_PER_SOL, "alice refunded 2 SOL");
    assert.ok((await conn.getBalance(bob.publicKey)) - bBefore > 0.99 * LAMPORTS_PER_SOL, "bob refunded 1 SOL");
    assert.equal(await conn.getBalance(vault), 0, "vault emptied after refunds");
    ok("P2.7b cancel/timeout + refund: both sides reclaimed exact stakes, vault emptied");
  }

  console.log(`\nALL PULSEPLAY ESCROW TESTS PASSED (${passed} checks)\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
