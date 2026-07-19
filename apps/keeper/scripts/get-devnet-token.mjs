#!/usr/bin/env node
/**
 * get-devnet-token.mjs — PulsePlay's own devnet TxLINE apiToken chase.
 *
 * Replicates the subscribe -> activate flow that the (read-only, sibling-repo) reference script
 * `txline-explorer/scripts/renew-txline-token.mjs` uses for MAINNET, but targets DEVNET:
 *   - RPC:      https://api.devnet.solana.com
 *   - apiBase:  https://txline-dev.txodds.com   (per coordinator clarification: the local engine at
 *               localhost:3001 only proxies MAINNET TxLINE — devnet proof/token calls must hit
 *               txline-dev.txodds.com directly)
 *   - program:  the DEVNET TxLINE program (6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J — same
 *               program the escrow's `--features devnet` build pins for validate_stat reads). NOTE:
 *               the reference script's DEFAULTS hardcode the MAINNET program id even when
 *               `--network devnet` is passed — that looks like an untested path in that script, so
 *               here we default the program id per-network instead of copying that assumption.
 *
 * SAFETY: --dry-run (default) only ever calls `simulateTransaction` — no signature is broadcast, no
 * SOL is spent. A REAL run additionally requires --yes. Never touches mainnet-beta with a spending tx.
 *
 * This script and its output stay entirely inside pulseplay-markets: writes go to
 * apps/keeper/.cache/devnet-token.json (gitignored). Nothing is written into ../txline-explorer.
 *
 * Lives at apps/keeper/scripts/ (not onchain/scripts/ as the brief's example path suggested) so bare
 * imports (@solana/web3.js, @solana/spl-token, tweetnacl) resolve against apps/keeper's node_modules —
 * Node ESM resolves bare specifiers from the importing FILE's location, not the process cwd, and
 * onchain/ isn't a pnpm workspace member. Documented here rather than silently deviating.
 *
 * Usage:
 *   pnpm --filter @pulseplay/keeper devnet:token -- --keypair ~/.config/solana/pulseplay-deploy-authority.json --dry-run
 *   pnpm --filter @pulseplay/keeper devnet:token -- --keypair ~/.config/solana/pulseplay-deploy-authority.json --yes
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  Connection, Keypair, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import nacl from "tweetnacl";

const HERE = dirname(fileURLToPath(import.meta.url)); // apps/keeper/scripts
const DEFAULT_CACHE = join(HERE, "..", ".cache", "devnet-token.json"); // apps/keeper/.cache/devnet-token.json

const DEVNET_TXLINE_PROGRAM = "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J";
const MAINNET_TXLINE_PROGRAM = "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA";
// Best-known guess, carried over from the mainnet reference script — devnet almost certainly has its
// OWN mint (mints aren't shared across clusters). Override with --mint once/if the real one is known;
// the dry-run below will surface an AccountNotFound-style error if this guess is wrong, which is the
// point of dry-running first.
const MAINNET_TXLINE_MINT = "Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL";

const SUBSCRIBE_DISCRIMINATOR = Uint8Array.from([254, 28, 191, 138, 156, 179, 183, 53]);
const SEED_PRICING_MATRIX = "pricing_matrix";
const SEED_TOKEN_TREASURY = "token_treasury_v2";

function parseArgs(argv) {
  const o = { dryRun: true, yes: false, weeks: 4, serviceLevel: 12 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--dry-run") o.dryRun = true;
    else if (a === "--yes") { o.yes = true; o.dryRun = false; }
    else if (a === "--keypair") o.keypair = next();
    else if (a === "--weeks") o.weeks = Number(next());
    else if (a === "--service-level") o.serviceLevel = Number(next());
    else if (a === "--program-id") o.programId = next();
    else if (a === "--mint") o.mint = next();
    else if (a === "--api-base") o.apiBase = next();
    else if (a === "--rpc") o.rpc = next();
    else if (a === "--out") o.out = next();
    else if (a === "--help" || a === "-h") { console.log(HELP); process.exit(0); }
    else die(`unknown arg: ${a} (use --help)`);
  }
  return o;
}
const HELP = `get-devnet-token.mjs — PulsePlay's devnet TxLINE apiToken chase (dry-run by default)
  --keypair <path>       (required) subscriber wallet keypair JSON (use the funded deploy authority)
  --dry-run              simulate only (default) — no SOL spent, no activation, no cache write
  --yes                  required for a REAL run (spends devnet SOL, writes apps/keeper/.cache/devnet-token.json)
  --weeks N              default 4 (mainnet script rejects weeks<4 on-chain; devnet may differ)
  --service-level <id>   default 12 (the free WC+Friendlies bundle on mainnet — unconfirmed on devnet)
  --program-id <pubkey>  default ${DEVNET_TXLINE_PROGRAM} (the devnet TxLINE program)
  --mint <pubkey>        default ${MAINNET_TXLINE_MINT} (mainnet mint reused as a guess — see file header)
  --api-base <url>       default https://txline-dev.txodds.com
  --rpc <url>             default https://api.devnet.solana.com
  --out <path>           default apps/keeper/.cache/devnet-token.json`;

function die(msg) { console.error(`ERROR: ${msg}`); process.exit(1); }
const redact = (s) => (typeof s === "string" && s.length > 12 ? `${s.slice(0, 6)}…${s.slice(-4)} (len ${s.length})` : "«unset»");

function subscribeData(serviceLevelId, weeks) {
  const b = Buffer.alloc(8 + 2 + 1);
  Buffer.from(SUBSCRIBE_DISCRIMINATOR).copy(b, 0);
  b.writeUInt16LE(serviceLevelId, 8);
  b.writeUInt8(weeks, 10);
  return b;
}

async function guestStart(apiBase) {
  const r = await fetch(`${apiBase}/auth/guest/start`, { method: "POST", headers: { "Content-Type": "application/json" } });
  const body = await r.text();
  if (!r.ok) throw new Error(`guestStart ${r.status}: ${body.slice(0, 200)}`);
  let data; try { data = JSON.parse(body); } catch { data = body; }
  const jwt = typeof data === "string" ? data : data?.token;
  if (!jwt) throw new Error("guestStart: no token in response");
  return jwt;
}

async function activate(apiBase, { txSig, walletSignature, leagues, jwt }) {
  const r = await fetch(`${apiBase}/api/token/activate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ txSig, walletSignature, leagues }),
  });
  const body = await r.text();
  if (!r.ok) throw new Error(`activate ${r.status}: ${body.slice(0, 300)}`);
  let data; try { data = JSON.parse(body); } catch { data = body; }
  const token = typeof data === "string" ? data : data?.token;
  if (!token) throw new Error("activate: no token in response");
  return token;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.keypair) die("--keypair is required");

  const apiBase = args.apiBase ?? "https://txline-dev.txodds.com";
  const rpc = args.rpc ?? "https://api.devnet.solana.com";
  const programId = new PublicKey(args.programId ?? DEVNET_TXLINE_PROGRAM);
  const mint = new PublicKey(args.mint ?? MAINNET_TXLINE_MINT);
  const out = args.out ?? DEFAULT_CACHE;
  const weeks = args.weeks;
  const serviceLevelId = args.serviceLevel;

  const secret = Uint8Array.from(JSON.parse(readFileSync(args.keypair, "utf8")));
  const payer = Keypair.fromSecretKey(secret);

  console.log(`PulsePlay devnet TxLINE token chase — apiBase=${apiBase} rpc=${rpc}`);
  console.log(`  wallet ${payer.publicKey.toBase58()}  program=${programId.toBase58()}  mint=${mint.toBase58()}`);
  console.log(`  serviceLevelId=${serviceLevelId}  weeks=${weeks}  mode=${args.dryRun ? "DRY-RUN" : "LIVE"}`);

  if (programId.toBase58() === MAINNET_TXLINE_PROGRAM) {
    console.log("  WARNING: --program-id resolves to the MAINNET TxLINE program — this script never signs mainnet spends; refusing.");
    die("refusing to target the mainnet program from a devnet-chase script");
  }

  const conn = new Connection(rpc, "confirmed");
  const balance = await conn.getBalance(payer.publicKey);
  console.log(`  wallet devnet balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance === 0) die("wallet has 0 devnet SOL — fund it before proceeding (never mainnet)");

  // 1) guest JWT (no-auth) — always safe, read-only.
  let jwt;
  try {
    jwt = await guestStart(apiBase);
    console.log(`  ✓ guest JWT obtained ${redact(jwt)}`);
  } catch (e) {
    die(`guestStart against ${apiBase} failed: ${e.message} — devnet TxLINE API may be unreachable; logging to BLOCKED.md and stopping here (this alone does not block anything else — see BLOCKED.md).`);
  }

  // 2) build the subscribe tx: [createATA(idempotent), subscribe(serviceLevelId, weeks)].
  const pricingMatrix = PublicKey.findProgramAddressSync([Buffer.from(SEED_PRICING_MATRIX)], programId)[0];
  const treasuryPda = PublicKey.findProgramAddressSync([Buffer.from(SEED_TOKEN_TREASURY)], programId)[0];
  const userAta = getAssociatedTokenAddressSync(mint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const treasuryVault = getAssociatedTokenAddressSync(mint, treasuryPda, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  console.log(`  pricing_matrix PDA:    ${pricingMatrix.toBase58()}`);
  console.log(`  token_treasury_v2 PDA: ${treasuryPda.toBase58()}`);
  console.log(`  user ATA:              ${userAta.toBase58()}`);
  console.log(`  treasury vault ATA:    ${treasuryVault.toBase58()}`);

  const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, userAta, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const subscribeIx = {
    programId,
    keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: pricingMatrix, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: treasuryVault, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: subscribeData(serviceLevelId, weeks),
  };
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [createAtaIx, subscribeIx] }).compileToV0Message();
  const vtx = new VersionedTransaction(msg);
  vtx.sign([payer]);

  const sim = await conn.simulateTransaction(vtx, { sigVerify: false, replaceRecentBlockhash: true });
  console.log(`  simulate subscribe → err=${JSON.stringify(sim.value.err)} units=${sim.value.unitsConsumed}`);
  (sim.value.logs ?? []).forEach((l) => console.log(`     ${l}`));

  if (sim.value.err) {
    console.log("\n  DRY-RUN RESULT: FAILED (see BLOCKED.md for the recorded gap). No SOL spent.");
    process.exit(2);
  }
  console.log("\n  DRY-RUN RESULT: subscribe instruction simulates CLEANLY.");

  if (args.dryRun) {
    console.log("  DRY-RUN complete — no SOL spent, no activation, no cache write. Re-run with --yes for a real (SOL-spending) run.");
    return;
  }
  if (!args.yes) die("real run spends devnet SOL — re-run with --yes (or omit for --dry-run)");

  // 3) send the subscribe tx for real (devnet SOL only).
  const txSig = await conn.sendRawTransaction(vtx.serialize(), { skipPreflight: false, preflightCommitment: "confirmed" });
  await conn.confirmTransaction({ signature: txSig, blockhash, lastValidBlockHeight }, "confirmed");
  console.log(`  ✓ subscribe confirmed txSig=${txSig}`);

  // 4) sign the activation message and activate -> new apiToken.
  const leagues = [];
  const message = `${txSig}:${leagues.join(",")}:${jwt}`;
  const walletSignature = Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), payer.secretKey)).toString("base64");
  const newToken = await activate(apiBase, { txSig, walletSignature, leagues, jwt });
  console.log(`  ✓ activated — new apiToken ${redact(newToken)}`);

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify({
    network: "devnet", apiBase, apiToken: newToken, jwt, serviceLevelId, weeks,
    programId: programId.toBase58(), mint: mint.toBase58(), subscribeTxSig: txSig,
    obtainedAt: new Date().toISOString(),
  }, null, 2) + "\n");
  console.log(`  ✓ wrote ${out} (gitignored)`);
}

main().catch((e) => die(e.message ?? String(e)));
