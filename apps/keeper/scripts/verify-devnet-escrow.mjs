#!/usr/bin/env node
/**
 * verify-devnet-escrow.mjs — proves the deployed devnet pulseplay_escrow program's instruction-
 * building path works end-to-end for everything that does NOT require a live oracle proof:
 * create_market -> deposit (real devnet "USDC (Devnet Test)" SPL token) -> cancel -> refund.
 *
 * This is the "as far as possible without a live oracle proof" verification the Phase 1 brief asks
 * for. A full devnet resolve_outcome (needing a real validate_stat CPI against the devnet oracle) is
 * attempted separately — see docs/BUILD-STATUS.md Phase 1 / BLOCKED.md for that result.
 *
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
const { Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } = web3;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const IDL_PATH = join(REPO, "onchain", "target", "idl", "pulseplay_escrow.json");
const RPC = "https://api.devnet.solana.com";
const MINT = new PublicKey("BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171"); // PulsePlay USDC (Devnet Test)
const DEPLOY_AUTHORITY = join(os.homedir(), ".config", "solana", "pulseplay-deploy-authority.json");

const loadWallet = (p) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(p, "utf8"))));
const i64le = (n) => new BN(n).toArrayLike(Buffer, "le", 8);
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const i32le = (n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
let passed = 0;
const ok = (msg) => { passed++; console.log("  ✓", msg); };

async function main() {
  const conn = new Connection(RPC, "confirmed");
  const payer = loadWallet(DEPLOY_AUTHORITY);
  const provider = new anchor.AnchorProvider(conn, new anchor.Wallet(payer), { commitment: "confirmed" });
  anchor.setProvider(provider);
  const idl = JSON.parse(readFileSync(IDL_PATH, "utf8"));
  const program = new anchor.Program(idl, provider);

  console.log(`\nDevnet escrow verification — program ${program.programId.toBase58()}, mint ${MINT.toBase58()}\n`);
  console.log(`  deploy wallet ${payer.publicKey.toBase58()} balance: ${(await conn.getBalance(payer.publicKey)) / LAMPORTS_PER_SOL} SOL`);

  // Fresh throwaway market authority + two bettors, funded with a little devnet SOL from the deploy wallet
  // (avoids the public devnet airdrop's rate limit entirely).
  const authority = Keypair.generate();
  const alice = Keypair.generate();
  const bob = Keypair.generate();
  const gasEach = 0.02 * LAMPORTS_PER_SOL;
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const fundTx = new anchor.web3.Transaction({ feePayer: payer.publicKey, blockhash, lastValidBlockHeight }).add(
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: authority.publicKey, lamports: gasEach }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: alice.publicKey, lamports: gasEach }),
    SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: bob.publicKey, lamports: gasEach }),
  );
  await anchor.web3.sendAndConfirmTransaction(conn, fundTx, [payer], { commitment: "confirmed" });
  ok("funded 3 fresh devnet wallets with gas SOL directly from the deploy wallet (no airdrop rate limit)");

  // Mint test USDC to alice + bob (deploy wallet is the mint authority).
  for (const kp of [alice, bob]) {
    const ata = await getOrCreateAssociatedTokenAccount(conn, payer, MINT, kp.publicKey, false, "confirmed", undefined, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
    await mintTo(conn, payer, MINT, ata.address, payer, 5_000_000, [], undefined, TOKEN_PROGRAM_ID); // 5 test-USDC
  }
  ok("minted 5 test-USDC to alice + bob's devnet ATAs (no rate limit — we control the mint authority)");

  // create_market: a real predicate on the real demo fixture (England goals > 0) — same stat this
  // whole product uses; NOT resolving it here (that needs a live oracle proof), just proving the
  // instruction-building + account path works for real on devnet.
  const fixtureId = 18241006, statKey = 1, period = 5;
  const [market] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), authority.publicKey.toBuffer(), i64le(fixtureId), u32le(statKey), i32le(period)], program.programId);
  const vault = getAssociatedTokenAddressSync(MINT, market, true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const cutoff = new BN(Math.floor(Date.now() / 1000) + 3600);
  const deadline = new BN(Math.floor(Date.now() / 1000) + 7200); // cancelled via the authority path below, not timeout
  const createTx = await program.methods.createMarket(new BN(fixtureId), statKey, period, 0, 0, cutoff, deadline, 0, 0)
    .accounts({
      authority: authority.publicKey, market, mint: MINT, vault,
      tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([authority]).rpc();
  ok(`create_market on devnet: ${createTx.slice(0, 20)}… (https://explorer.solana.com/tx/${createTx}?cluster=devnet)`);

  const posPda = (owner, side) => PublicKey.findProgramAddressSync(
    [Buffer.from("position"), market.toBuffer(), owner.toBuffer(), Buffer.from([side ? 1 : 0])], program.programId)[0];
  const ataOf = (owner) => getAssociatedTokenAddressSync(MINT, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const depositTx = await program.methods.deposit(true, new BN(2_000_000))
    .accounts({
      depositor: alice.publicKey, market, mint: MINT, vault, depositorTokenAccount: ataOf(alice.publicKey),
      position: posPda(alice.publicKey, true), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([alice]).rpc();
  ok(`deposit (alice, 2 test-USDC, YES) on devnet: ${depositTx.slice(0, 20)}…`);

  const depositTx2 = await program.methods.deposit(false, new BN(1_000_000))
    .accounts({
      depositor: bob.publicKey, market, mint: MINT, vault, depositorTokenAccount: ataOf(bob.publicKey),
      position: posPda(bob.publicKey, false), tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([bob]).rpc();
  ok(`deposit (bob, 1 test-USDC, NO) on devnet: ${depositTx2.slice(0, 20)}…`);

  const vaultBalance = await conn.getTokenAccountBalance(vault);
  console.log(`  vault balance: ${vaultBalance.value.uiAmountString} test-USDC`);
  if (vaultBalance.value.amount !== "3000000") throw new Error(`expected vault=3000000, got ${vaultBalance.value.amount}`);
  ok("real SPL vault (an ATA owned by the market PDA) holds the real 3-token pot on devnet");

  // Cancel (authority path — doesn't need to wait for the timeout) + refund both sides.
  const cancelTx = await program.methods.cancel().accounts({ signer: authority.publicKey, market }).signers([authority]).rpc();
  ok(`cancel on devnet: ${cancelTx.slice(0, 20)}…`);

  const refundAlice = await program.methods.refund()
    .accounts({
      owner: alice.publicKey, market, mint: MINT, vault, ownerTokenAccount: ataOf(alice.publicKey),
      position: posPda(alice.publicKey, true), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([alice]).rpc();
  const refundBob = await program.methods.refund()
    .accounts({
      owner: bob.publicKey, market, mint: MINT, vault, ownerTokenAccount: ataOf(bob.publicKey),
      position: posPda(bob.publicKey, false), tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    }).signers([bob]).rpc();
  ok(`refund (alice + bob) on devnet: ${refundAlice.slice(0, 12)}…, ${refundBob.slice(0, 12)}…`);

  const vaultAfter = await conn.getTokenAccountBalance(vault);
  if (vaultAfter.value.amount !== "0") throw new Error(`expected vault=0 after refunds, got ${vaultAfter.value.amount}`);
  ok("vault emptied after refunds — full create->deposit->cancel->refund lifecycle proven on devnet");

  console.log(`\nDEVNET ESCROW VERIFICATION PASSED (${passed} checks) — market ${market.toBase58()}\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
