import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { AccountReader } from "@txline/verify";
import { buildReceipt } from "../src/chain.js";
import type { Market } from "../src/catalog.js";

// The receipt's step-4 on-chain check must be SELF-SUFFICIENT: it reconstructs the fixture's anchored
// daily_scores_roots slot root from the recorded proof and reads the REAL on-chain PDA account directly
// (via an injected AccountReader), never depending on the external engine's /v1/validation call. These
// tests inject a hermetic reader over the recorded PDA bytes so they never touch the network.
const HERE = dirname(fileURLToPath(import.meta.url));
const FIXDIR = join(HERE, "..", "..", "..", "onchain", "fixtures");
const KNOWN_SLOT_ROOT_PREFIX = "0x8213ec7f"; // fixture 18241006, epoch day 20649, 5-min slot 252

function recordedPdaReader(fixtureFile: string): AccountReader {
  const raw = JSON.parse(readFileSync(join(FIXDIR, fixtureFile), "utf8"));
  const data = Buffer.from(raw.pdaDataBase64, "base64");
  return { getAccountInfo: async () => ({ data }) };
}

// Minimal V1 market — buildReceipt only reads id/statKey/predicateLabel/fixtureProofFile/generation.
const engScore = {
  id: "eng-score", category: "outcomes", kind: 0, title: "England to score",
  predicateLabel: "England full-match goals > 0", generation: "V1", statKey: 1, period: 5,
  fixtureProofFile: "scores-proof-18241006-seq960-keys1-2.json",
} as unknown as Market;

const cornerBatch = {
  id: "batch-corner-diff", category: "batch", kind: 2, title: "Corner difference",
  predicateLabel: "(home corners − away corners) == −5", generation: "V3", statKey: 7, period: 5,
  fixtureProofFile: "scores-proof-v3-18241006-keys7-8.json",
} as unknown as Market;

describe("buildReceipt — self-sufficient on-chain root (no engine dependency)", () => {
  it("renders the verified-green match by reading the daily_scores_roots PDA directly", async () => {
    const receipt = await buildReceipt(engScore, recordedPdaReader("scores-proof-18241006-seq960-keys1-2.json"));
    const oc = receipt.chain.onChain;
    expect(oc.match).toBe(true);
    expect(receipt.verified).toBe(true);
    expect(oc.computedRootHex).toBe(oc.onChainRootHex);
    expect(oc.computedRootHex.startsWith(KNOWN_SLOT_ROOT_PREFIX)).toBe(true);
    // step-3 shows the reconstructed day-slot root, self-sufficiently computed
    expect(receipt.chain.dailyRoot.hashHex).toBe(oc.computedRootHex);
    expect(oc.plain).toContain("EQUALS the on-chain root");
    // leaf is still the market's own stat leaf
    expect(receipt.chain.leaf.hashHex.startsWith("0x")).toBe(true);
  });

  it("verifies a non-V1 market's day-root via the fixture-wide canonical proof (statKey 7 → keys7-8)", async () => {
    const receipt = await buildReceipt(cornerBatch, recordedPdaReader("scores-proof-18241006-seq960-keys7-8.json"));
    const oc = receipt.chain.onChain;
    expect(oc.match).toBe(true);
    expect(oc.computedRootHex).toBe(oc.onChainRootHex);
    expect(oc.computedRootHex.startsWith(KNOWN_SLOT_ROOT_PREFIX)).toBe(true);
  });

  it("falls through to the honest 'unavailable — not asserting a match' state when the PDA read fails", async () => {
    const nullReader: AccountReader = { getAccountInfo: async () => null };
    const receipt = await buildReceipt(engScore, nullReader);
    const oc = receipt.chain.onChain;
    expect(oc.match).toBe(false);
    expect(receipt.verified).toBe(false);
    expect(oc.onChainRootHex).toBe("(unavailable)");
    // UI detects the honest-unavailable banner via computedRootHex starting with "(" — never a red mismatch
    expect(oc.computedRootHex.startsWith("(")).toBe(true);
    expect(oc.plain).toContain("NOT asserting");
  });

  it("falls through to honest-unavailable on an RPC error (verify throws), never a spurious green", async () => {
    const throwingReader: AccountReader = { getAccountInfo: async () => { throw new Error("RPC down"); } };
    const receipt = await buildReceipt(engScore, throwingReader);
    const oc = receipt.chain.onChain;
    expect(oc.match).toBe(false);
    expect(receipt.verified).toBe(false);
    expect(oc.computedRootHex.startsWith("(")).toBe(true);
  });
});
