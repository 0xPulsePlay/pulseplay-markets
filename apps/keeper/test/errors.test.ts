import { describe, it, expect } from "vitest";
import { describeError } from "../src/errors.js";

// Night 3 Phase A: Mikail hit a raw "fetch failed" on ticket submission — root cause was the keeper
// defaulting to an unreachable localnet RPC (fixed in config.ts / config.test.ts, reproduced live with
// Playwright: POST /api/tickets/build-deposit -> {"error":"fetch failed"} whenever CLUSTER=localnet and
// no local validator is listening). This is the defense-in-depth half: even if a genuinely transient RPC
// outage happens again, the browser must never see the bare, cryptic "fetch failed" string verbatim — it
// should see something that names the endpoint and why.
describe("describeError — honest connection-failure messages, ordinary errors pass through unchanged", () => {
  it("translates the bare undici 'fetch failed' string into an actionable message naming the RPC endpoint", () => {
    const err = new Error("fetch failed");
    const msg = describeError(err);
    expect(msg).not.toBe("fetch failed");
    expect(msg).toMatch(/Solana RPC endpoint/);
    expect(msg).toMatch(/cluster=/);
  });

  it("also catches the underlying ECONNREFUSED cause even if the top-level message differs", () => {
    const err = Object.assign(new Error("request failed"), { cause: { code: "ECONNREFUSED" } });
    const msg = describeError(err);
    expect(msg).toMatch(/Solana RPC endpoint/);
    expect(msg).toMatch(/ECONNREFUSED/);
  });

  it("leaves ordinary application errors completely unchanged (never papers over a real bug with a vaguer message)", () => {
    const err = new Error("this wallet already has a different open market for the same underlying stat");
    expect(describeError(err)).toBe("this wallet already has a different open market for the same underlying stat");
  });

  it("leaves market-not-found / validation errors unchanged", () => {
    expect(describeError(new Error("unknown market"))).toBe("unknown market");
    expect(describeError(new Error("wallet, marketId, side (boolean) required"))).toBe("wallet, marketId, side (boolean) required");
  });
});
