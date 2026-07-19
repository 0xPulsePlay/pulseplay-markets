import { describe, it, expect, afterEach, vi } from "vitest";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Market } from "../src/catalog.js";

// Night 3 Phase B: V2 (Combos) and V3 (Batch) previously only ever settled on devnet from a RECORDED
// fixture bound to the mainnet-cloned oracle data (per BLOCKED.md §5), and that recorded-fallback path
// additionally crashed outright on devnet ("no fixed daily_scores_roots PDA configured for cluster
// devnet" -- see chain.test's sibling coverage of resolveOnChain's PDA selection). Probing the raw
// upstream devnet API directly (`https://txline-dev.txodds.com`) found it DOES serve live V2/V3 proofs,
// just via a different query shape than V1's: plural `statKeys=1,2,3` (not `statKey=`), and V3 lives at
// a `-v3` suffixed endpoint. This locks that URL-building + response-shape-validation logic in place —
// hermetically, via a fixture apiToken/jwt file and a mocked global fetch (never touches the real
// network), so a future refactor can't silently regress the exact query shape that was confirmed live.
const HERE = dirname(fileURLToPath(import.meta.url));
const FAKE_TOKEN_CACHE = join(HERE, "fixtures", "fake-devnet-token.json");

const ENV_KEYS = ["CLUSTER", "DEVNET_TOKEN_CACHE", "DEVNET_TXLINE_API_BASE", "DEMO_FIXTURE_ID"] as const;
const saved: Record<string, string | undefined> = {};
for (const k of ENV_KEYS) saved[k] = process.env[k];

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function freshLiveDevnetProof() {
  process.env.CLUSTER = "devnet";
  process.env.DEVNET_TOKEN_CACHE = FAKE_TOKEN_CACHE;
  vi.resetModules();
  return (await import("../src/chain.js")).liveDevnetProof;
}

const v1Market = { id: "eng-score", generation: "V1", statKey: 1, period: 5 } as unknown as Market;
const v2Market = { id: "combo-final-scoreline", generation: "V2", statKey: 1, period: 5, liveStatKeys: [1, 2, 3] } as unknown as Market;
const v3Market = { id: "batch-corner-diff", generation: "V3", statKey: 7, period: 5, liveStatKeys: [7, 8] } as unknown as Market;

describe("liveDevnetProof — V1/V2/V3 live devnet proof fetch (Night 3 Phase B)", () => {
  it("V1 still requests the singular statKey= shape and accepts a matching singular response", async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify({ statToProve: { key: 1, value: 1, period: 5 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    const proof = await liveDevnetProof(v1Market);
    expect(proof).not.toBeNull();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/scores/stat-validation?");
    expect(url).toContain("statKey=1");
    expect(url).not.toContain("statKeys=");
  });

  it("V2 requests the PLURAL statKeys=1,2,3 shape (not statKey=) against the plain stat-validation endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      statsToProve: [{ key: 1, value: 1, period: 5 }, { key: 2, value: 2, period: 5 }, { key: 3, value: 1, period: 5 }],
      statProofs: [[], [], []],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    const proof = await liveDevnetProof(v2Market);
    expect(proof).not.toBeNull();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/scores/stat-validation?");
    expect(url).not.toContain("stat-validation-v3");
    expect(url).toContain("statKeys=1,2,3");
  });

  it("V3 requests the stat-validation-v3 endpoint and requires a multiproof in the response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      statsToProve: [{ stat: { key: 7, value: 1, period: 5 }, statProof: [] }, { stat: { key: 8, value: 6, period: 5 }, statProof: [] }],
      multiproof: { hashes: [], indices: [] },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    const proof = await liveDevnetProof(v3Market);
    expect(proof).not.toBeNull();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/api/scores/stat-validation-v3?");
    expect(url).toContain("statKeys=7,8");
  });

  it("V3 response missing `multiproof` is rejected (falls back to the recorded fixture, never a malformed live proof)", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      statsToProve: [{ stat: { key: 7, value: 1, period: 5 } }, { stat: { key: 8, value: 6, period: 5 } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    expect(await liveDevnetProof(v3Market)).toBeNull();
  });

  it("a response missing one of the requested keys is rejected, not silently accepted as partial", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      statsToProve: [{ key: 1, value: 1, period: 5 }, { key: 2, value: 2, period: 5 }], // missing key 3
      statProofs: [[], []],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    expect(await liveDevnetProof(v2Market)).toBeNull();
  });

  it("a V2/V3 market with no declared liveStatKeys never even calls fetch (stays on the recorded fixture)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = await freshLiveDevnetProof();
    const marketWithoutKeys = { id: "x", generation: "V2", statKey: 1, period: 5 } as unknown as Market;
    expect(await liveDevnetProof(marketWithoutKeys)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cluster !== devnet short-circuits to null without ever calling fetch", async () => {
    process.env.CLUSTER = "localnet";
    process.env.DEVNET_TOKEN_CACHE = FAKE_TOKEN_CACHE;
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const liveDevnetProof = (await import("../src/chain.js")).liveDevnetProof;
    expect(await liveDevnetProof(v1Market)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
