// SCRATCH — not committed. Node-side helper for Phase-A Playwright repro: generates an ed25519
// Solana keypair, or signs raw message bytes with one. Bridges Python Playwright <-> real signing
// (mirrors the "mocked Phantom -> real Node ed25519 signer" pattern used earlier this build).
import { Keypair } from "@solana/web3.js";
import nacl from "tweetnacl";

const mode = process.argv[2];

if (mode === "gen") {
  const kp = Keypair.generate();
  console.log(JSON.stringify({
    pubkey: kp.publicKey.toBase58(),
    secretKeyB64: Buffer.from(kp.secretKey).toString("base64"),
  }));
} else if (mode === "sign") {
  const secretKeyB64 = process.argv[3];
  const messageB64 = process.argv[4];
  const secretKey = new Uint8Array(Buffer.from(secretKeyB64, "base64"));
  const message = new Uint8Array(Buffer.from(messageB64, "base64"));
  const sig = nacl.sign.detached(message, secretKey);
  console.log(Buffer.from(sig).toString("base64"));
} else {
  console.error("usage: scratch-signer.mjs gen | sign <secretKeyB64> <messageB64>");
  process.exit(1);
}
