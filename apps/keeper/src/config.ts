/** Central config. Ports per the night-shift operating contract: keeper/API on 4190. */
export const CONFIG = {
  port: Number(process.env.PORT ?? 4190),
  engineUrl: process.env.ENGINE_URL ?? "http://localhost:3001",
  // Local validator that clones the REAL TxLINE oracle + anchored PDA (started for the escrow suite).
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8999",
  cluster: process.env.CLUSTER ?? "localnet",
  programId: process.env.PROGRAM_ID ?? "2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin",
  oracleProgram: "9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA",
  dailyScoresRootsPda: "6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE",
  // The showpiece fixture: England 1–2 Argentina (semifinal replay), full tick corpus.
  demoFixtureId: 18241006,
} as const;

/** ISO-ish 2-letter codes for the demo teams (for inline flag rendering; no external assets). */
export const TEAM_CODES: Record<string, string> = {
  England: "gb-eng", Argentina: "ar", France: "fr", Brazil: "br", Spain: "es",
  Germany: "de", Portugal: "pt", Netherlands: "nl", Italy: "it", Croatia: "hr",
  Morocco: "ma", "New Zealand": "nz", India: "in", Belgium: "be", Uruguay: "uy",
  Japan: "jp", "United States": "us", Mexico: "mx", Colombia: "co", Senegal: "sn",
};
