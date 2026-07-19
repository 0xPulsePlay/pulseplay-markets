import { homedir } from "node:os";

/** Expand a leading `~` to the user's home dir (keypair paths are conventionally written this way). */
function expandHome(p: string): string {
  return p.startsWith("~") ? p.replace(/^~/, homedir()) : p;
}

type Cluster = "localnet" | "devnet";

/**
 * Per-cluster defaults. localnet values are UNCHANGED from before this file became env-driven (the
 * local validator clones the real mainnet oracle + the one anchored PDA the recorded demo fixture
 * needs). devnet values point at TxLINE's real devnet deployment — see docs/TXLINE-INTEGRATION.md
 * "Devnet" section for how these were confirmed (read-only account probes + a live proof pulled from
 * txline-dev.txodds.com for fixture 18241006, the same fixture this whole demo is built around).
 */
const CLUSTER_PRESETS: Record<Cluster, {
  rpcUrl: string; oracleProgram: string; dailyScoresRootsPda: string; wagerMint: string; mintAuthorityKeypairPath: string;
}> = {
  localnet: {
    rpcUrl: "http://127.0.0.1:8999",
    oracleProgram: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
    dailyScoresRootsPda: "6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE",
    // "" = chain.ts creates + caches its OWN fresh local test-USDC mint on first use (localnet resets
    // often, so there's no stable address to hardcode; the keeper's own wallet is the mint authority).
    wagerMint: "",
    mintAuthorityKeypairPath: "",
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    oracleProgram: "6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J",
    // No single fixed PDA on devnet (validate_stat reads a PER-EPOCH-DAY PDA) — a live devnet resolve
    // computes it from the proof's own timestamp via `dailyScoresRootsPdaFor()` in chain.ts. This
    // default is only a fallback for code paths that read CONFIG.dailyScoresRootsPda directly.
    dailyScoresRootsPda: "",
    // "PulsePlay USDC (Devnet Test)" — classic SPL Token, 6 decimals, minted 2026-07-19. NEVER real
    // USDC; every UI surface must label it "devnet test token". See docs/BUILD-STATUS.md Phase 1.
    wagerMint: "BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171",
    // The mint's authority is the deploy wallet (it minted the token), NOT the keeper's normal
    // operating wallet — the faucet (and localnet's self-serve mint) need to sign as this key.
    mintAuthorityKeypairPath: "~/.config/solana/pulseplay-deploy-authority.json",
  },
};

const cluster = (process.env.CLUSTER as Cluster | undefined) ?? "localnet";
const preset = CLUSTER_PRESETS[cluster] ?? CLUSTER_PRESETS.localnet;

/** Central config. Ports per the night-shift operating contract: keeper/API on 4190.
 *  Every chain-facing value is env-driven with a cluster-aware default — `CLUSTER=devnet` switches
 *  the whole preset without touching code; explicit env vars always win over the preset. */
export const CONFIG = {
  port: Number(process.env.PORT ?? 4190),
  engineUrl: process.env.ENGINE_URL ?? "http://localhost:3001",
  cluster,
  rpcUrl: process.env.SOLANA_RPC_URL ?? preset.rpcUrl,
  programId: process.env.PROGRAM_ID ?? "2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin",
  oracleProgram: process.env.ORACLE_PROGRAM ?? preset.oracleProgram,
  dailyScoresRootsPda: process.env.DAILY_SCORES_ROOTS_PDA ?? preset.dailyScoresRootsPda,
  // Preserves the exact prior hardcoded default (~/.config/solana/id.json) when unset.
  walletKeypairPath: expandHome(process.env.KEEPER_WALLET_PATH ?? "~/.config/solana/id.json"),
  // Devnet-only: where get-devnet-token.mjs cached the subscribe->activate apiToken/JWT.
  devnetTokenCachePath: process.env.DEVNET_TOKEN_CACHE ?? new URL("../.cache/devnet-token.json", import.meta.url).pathname,
  devnetTxlineApiBase: process.env.DEVNET_TXLINE_API_BASE ?? "https://txline-dev.txodds.com",
  // Phase 1: SPL wagering token. "" (localnet default) means chain.ts self-creates + caches one.
  wagerMint: process.env.WAGER_MINT ?? preset.wagerMint,
  wagerMintDecimals: Number(process.env.WAGER_MINT_DECIMALS ?? 6),
  wagerMintLabel: process.env.WAGER_MINT_LABEL ?? (cluster === "devnet" ? "USDC · devnet test token" : "USDC · local test token"),
  // Falls back to the keeper's own operating wallet when unset (localnet: same key mints + operates).
  mintAuthorityKeypairPath: expandHome(process.env.MINT_AUTHORITY_WALLET_PATH || preset.mintAuthorityKeypairPath || process.env.KEEPER_WALLET_PATH || "~/.config/solana/id.json"),
  // The showpiece fixture: England 1–2 Argentina (semifinal replay), full tick corpus. Also live on
  // devnet under the same fixture id (confirmed — see docs/TXLINE-INTEGRATION.md).
  demoFixtureId: Number(process.env.DEMO_FIXTURE_ID ?? 18241006),
} as const;

/** ISO-ish 2-letter codes for the demo teams (for inline flag rendering; no external assets). */
export const TEAM_CODES: Record<string, string> = {
  England: "gb-eng", Argentina: "ar", France: "fr", Brazil: "br", Spain: "es",
  Germany: "de", Portugal: "pt", Netherlands: "nl", Italy: "it", Croatia: "hr",
  Morocco: "ma", "New Zealand": "nz", India: "in", Belgium: "be", Uruguay: "uy",
  Japan: "jp", "United States": "us", Mexico: "mx", Colombia: "co", Senegal: "sn",
  Austria: "at", Switzerland: "ch", Poland: "pl", Canada: "ca", Qatar: "qa",
  Scotland: "gb-sct", Australia: "au", "Saudi Arabia": "sa", Sweden: "se", Denmark: "dk",
};
