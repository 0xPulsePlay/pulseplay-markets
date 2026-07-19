import { describe, it, expect, afterEach, vi } from "vitest";

// Night 3, Phase A/B — regression test for the "still says localnet" / "fetch failed" bug pair Mikail
// hit hands-on. Root cause (reproduced live with Playwright against a real keeper instance): the
// keeper's cluster defaulted to "localnet", which requires a locally-running Solana validator at
// 127.0.0.1:8999. On a plain restart (no manually-passed CLUSTER/SOLANA_RPC_URL/*_WALLET_PATH env
// vars), nothing is listening there — every RPC-touching endpoint (e.g. POST /api/tickets/build-deposit,
// GET /api/wallet/:wallet/balances) throws Node's raw `TypeError: fetch failed` straight through to the
// browser ("fetch failed" verbatim), and the topbar's `health?.network ?? "localnet"` fallback shows
// "LOCALNET" even when that's not the intended cluster. Devnet must be the actual compiled-in default so
// the app is correct out of the box, not just when 4 env vars are remembered.
const CLUSTER_ENV_KEYS = ["CLUSTER", "SOLANA_RPC_URL", "ORACLE_PROGRAM", "DAILY_SCORES_ROOTS_PDA", "WAGER_MINT", "WAGER_MINT_LABEL", "KEEPER_WALLET_PATH", "MINT_AUTHORITY_WALLET_PATH"] as const;
const savedEnv: Record<string, string | undefined> = {};
for (const k of CLUSTER_ENV_KEYS) savedEnv[k] = process.env[k];

afterEach(() => {
  for (const k of CLUSTER_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
  }
  vi.resetModules();
});

async function freshConfig() {
  vi.resetModules();
  return (await import("../src/config.js")).CONFIG;
}

describe("CONFIG cluster default (Night 3 P0 — devnet must be the real default)", () => {
  it("defaults to devnet when CLUSTER is entirely unset — a plain restart must not fall back to localnet", async () => {
    for (const k of CLUSTER_ENV_KEYS) delete process.env[k];
    const CONFIG = await freshConfig();
    expect(CONFIG.cluster).toBe("devnet");
    expect(CONFIG.rpcUrl).toBe("https://api.devnet.solana.com");
    expect(CONFIG.oracleProgram).toBe("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
    expect(CONFIG.wagerMint).toBe("BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171");
  });

  it("the devnet default also points the keeper's OWN operating wallet at a funded devnet wallet, not the 0-SOL id.json default", async () => {
    for (const k of CLUSTER_ENV_KEYS) delete process.env[k];
    const CONFIG = await freshConfig();
    // This is the fee payer/authority for settleMarket()/resolveWalletMarket()/fundGas() — if this
    // still resolved to ~/.config/solana/id.json (0 devnet SOL, see BLOCKED.md history), every
    // on-chain write the keeper itself signs would silently start failing again on devnet.
    expect(CONFIG.walletKeypairPath).toContain("pulseplay-deploy-authority.json");
    expect(CONFIG.mintAuthorityKeypairPath).toContain("pulseplay-deploy-authority.json");
  });

  it("CLUSTER=localnet is preserved as an explicit override — fast local iteration must keep working exactly as before", async () => {
    for (const k of CLUSTER_ENV_KEYS) delete process.env[k];
    process.env.CLUSTER = "localnet";
    const CONFIG = await freshConfig();
    expect(CONFIG.cluster).toBe("localnet");
    expect(CONFIG.rpcUrl).toBe("http://127.0.0.1:8999");
    expect(CONFIG.oracleProgram).toBe("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
    expect(CONFIG.wagerMint).toBe(""); // localnet self-creates its own test mint
    expect(CONFIG.walletKeypairPath.endsWith("/.config/solana/id.json")).toBe(true);
  });

  it("explicit env vars always win over the devnet preset (escape hatch for a custom RPC/wallet)", async () => {
    for (const k of CLUSTER_ENV_KEYS) delete process.env[k];
    process.env.SOLANA_RPC_URL = "http://custom-rpc.example:1234";
    const CONFIG = await freshConfig();
    expect(CONFIG.cluster).toBe("devnet"); // still devnet preset...
    expect(CONFIG.rpcUrl).toBe("http://custom-rpc.example:1234"); // ...but the explicit override wins
  });
});
