#!/usr/bin/env node
/**
 * verify-devnet-live-resolve.mjs — the stretch goal: a genuinely LIVE devnet settlement. Pulls a real
 * V1 stat-validation proof directly from https://txline-dev.txodds.com (using the apiToken obtained by
 * get-devnet-token.mjs) for the real demo semifinal fixture (18241006, England v Argentina), then runs
 * the full create_market -> deposit -> resolve_outcome (a REAL validate_stat CPI against the deployed
 * devnet TxLINE oracle) -> claim lifecycle against the devnet-deployed pulseplay_escrow program.
 *
 * If this passes, devnet settlement is NOT limited to recorded fixtures — see docs/BUILD-STATUS.md.
 * SAFETY: devnet only. Spends a small amount of devnet SOL (rent + tx fees) from the deploy wallet.
 */
import anchor from "@coral-xyz/anchor";
import BN from "bn.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";
import {
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync, mintTo,
  TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const { web3 } = anchor;
const { Connection, Keypair, PublicKey, SystemProgram, ComputeBudgetProgram, LAMPORTS_PER_SOL } = web3;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const IDL_PATH = join(REPO, "onchain", "target", "idl", "pulseplay_escrow.json");
const TOKEN_CACHE = join(HERE, "..", ".cache", "devnet-token.json");
const RPC = "https://api.devnet.solana.com";
const ORACLE = new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const MINT = new PublicKey("BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171");
const DEPLOY_AUTHORITY = join(os.homedir(), ".config", "solana", "pulseplay-deploy-authority.json");
const FIXTURE_ID = 18241006, STAT_KEY = 1, PERIOD = 5, SEQ = 960; // England full-match goals == 1

const loadWallet = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const i64le = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i32le = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const node = (n) => ({ hash: n.hash, isRightSibling: n.isRightSibling });
let passed = 0;
const ok = (msg) => { passed++; console.log("  ✓", msg); };

async function main() {
  const { apiToken, jwt, apiBase } = JSON.parse(readFileSync(TOKEN_CACHE, "utf8"));
  console.log(`\nLive devnet resolve — fetching a real proof from ${apiBase} for fixture ${FIXTURE_ID}\n`);

  const r = await fetch(`${apiBase}/api/scores/stat-validation?fixtureId=${FIXTURE_ID}&seq=${SEQ}&statKey=${STAT_KEY}`, {
    headers: { Authorization: `Bearer ${jwt}`, "X-Api-Token": apiToken },
  });
  if (!r.ok) throw new Error(`stat-validation ${r.status}: ${await r.text()}`);
  const p = await r.json();
  if (p.statToProve.key !== STAT_KEY || p.statToProve.period !== PERIOD) throw new Error(`unexpected stat shape: ${JSON.stringify(p.statToProve)}`);
  ok(`live proof fetched: England goals(key=1) = ${p.statToProve.value} at period ${p.statToProve.period} (seq ${SEQ})`);

  const epochDay = Math.floor(p.summary.updateStats.minTimestamp / 86400000);
  const dsrSeed = Buffer.alloc(2); dsrSeed.writeUInt16LE(epochDay % 65536);
  const [dailyScoresRoots] = PublicKey.findProgramAddressSync([Buffer.from("daily_scores_roots"), dsrSeed], ORACLE);
  ok(`daily_scores_roots PDA for epoch day ${epochDay}: ${dailyScoresRoots.toBase58()}`);

  const conn = new Connection(RPC, "confirmed");
  const payer = loadWallet(DEPLOY_AUTHORITY);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
  const program = new anchor.Program(idl, provider);

  const authority = Keypair.generate();
  const alice = Keypair.generate(); // YES
  const bob = Keypair.generate();   // NO
  const gas = 0.02 * LAMPORTS_PER_SOL;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const fundTx = new anchor.web3.Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: authority.publicKey, lamports: gas }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: alice.publicKey, lamports: gas }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: bob.publicKey, lamports: gas }),
  );
  await anchor.web3.sendAndConfirmTransaction(conn, fundTx, [payer], { commitment: "confirmed" });
  for (const kp of [alice, bob]) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, MINT, kp.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    await mintTo(conn, payer, MINT, ata.address, payer, 5_000_000, [], undefined, TOKEN_PROGRAM_ID);
  }
  ok("funded a fresh authority + 2 bettors with gas SOL + test-USDC on devnet");

  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.publicKey.toBuffer(), i64le(FIXTURE_ID), u32le(STAT_KEY), i32le(PERIOD)], program.programId);
  const vault = getAssociatedTokenAddressSync(MINT, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const cutoff = new BN(Math.floor(Date.now() / 1000) + 3600);
  const deadline = new BN(Math.floor(Date.now() / 1000) + 7200);
  // "England full-match goals > 0" — comparison GT(0), threshold 0. Real proof says value=1 -> YES.
  const createTx = await program.methods.createMarket(new BN(FIXTURE_ID), STAT_KEY, PERIOD, 0, 0, cutoff, deadline, 0, 0)
    .accounts({
      authority: authority.publicKey, market, mint: MINT, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();
  ok(`create_market (live) on devnet: ${createTx.slice(0, 20)}…`);

  const posPda = (owner, side) => PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer(), Buffer.from([side ? 1 : 0])], program.programId)[0];
  const ataOf = (owner) => getAssociatedTokenAddressSync(MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  await program.methods.deposit(true, new BN(2_000_000))
    .accounts({ depositor: alice.publicKey, market, mint: MINT, vault, depositorTokenAccount: ataOf(alice.publicKey), position: posPda(alice.publicKey, true), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([alice]).rpc();
  await program.methods.deposit(false, new BN(1_000_000))
    .accounts({ depositor: bob.publicKey, market, mint: MINT, vault, depositorTokenAccount: ataOf(bob.publicKey), position: posPda(bob.publicKey, false), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([bob]).rpc();
  ok("deposits (alice YES 2, bob NO 1) confirmed on devnet — 3 test-USDC in the real vault");

  const summaryArg = {
    fixtureId: new BN(p.summary.fixtureId),
    updateStats: { updateCount: p.summary.updateStats.updateCount, minTimestamp: new BN(p.summary.updateStats.minTimestamp), maxTimestamp: new BN(p.summary.updateStats.maxTimestamp) },
    eventsSubTreeRoot: p.summary.eventStatsSubTreeRoot,
  };
  const args = {
    ts: new BN(p.summary.updateStats.minTimestamp),
    summary: summaryArg,
    fixtureProof: p.subTreeProof.map(node),
    mainTreeProof: p.mainTreeProof.map(node),
    statA: { scoreStat: p.statToProve, eventStatRoot: p.eventStatRoot, statProof: p.statProof.map(node) },
  };
  const resolveTx = await program.methods.resolveOutcome(args)
    .accounts({ market, dailyScoresRoots, txoracleProgram: ORACLE })
    .preInstructions([ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 })])
    .rpc();
  ok(`resolve_outcome — REAL validate_stat CPI against the LIVE devnet oracle: ${resolveTx.slice(0, 20)}… (https://explorer.solana.com/tx/${resolveTx}?cluster=devnet)`);

  const acct = await program.account.market.fetch(market);
  console.log(`  on-chain outcome: ${acct.outcome} (expected YES since goals=${p.statToProve.value} > 0)`);
  if (acct.outcome !== true) throw new Error(`unexpected outcome: ${acct.outcome}`);
  ok("on-chain outcome == YES, matching the live proof — LIVE devnet settlement, not a recorded fixture");

  const winner = alice; // YES side
  const before = await conn.getTokenAccountBalance(ataOf(winner.publicKey)).catch(() => ({ value: { amount: "0" } }));
  const claimTx = await program.methods.claim()
    .accounts({ owner: winner.publicKey, market, mint: MINT, vault, ownerTokenAccount: ataOf(winner.publicKey), position: posPda(winner.publicKey, true), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
    .signers([winner]).rpc();
  const after = await conn.getTokenAccountBalance(ataOf(winner.publicKey));
  ok(`claim: alice swept the 3-token pot on devnet (${before.value.amount} -> ${after.value.amount} base units): ${claimTx.slice(0, 20)}…`);

  console.log(`\nLIVE DEVNET SETTLEMENT PASSED (${passed} checks) — market ${market.toBase58()}, resolve tx ${resolveTx}\n`);
}

main().catch((e) => { console.error(e?.message ?? e); if (e?.logs) console.error(e.logs.join("\n")); process.exit(1); });
