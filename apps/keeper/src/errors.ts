import { CONFIG } from "./config.js";

/**
 * Translates a raw connection-refused-style error (Node's global `fetch`/undici throws the bare string
 * `"fetch failed"` with the real reason nested in `err.cause`, e.g. `ECONNREFUSED`) into an honest,
 * actionable message instead of leaking the cryptic literal string straight to the browser. This is NOT
 * a vaguer message than the original — it's strictly more specific (names the endpoint + cluster + the
 * underlying OS error code) — and it never fires for ordinary application errors, which pass through
 * unchanged. See docs/BUILD-STATUS.md "Night 3" for the root cause this was found alongside (the keeper
 * defaulting to an unreachable localnet RPC, which produced this exact literal string) — that default is
 * fixed in config.ts; this is defense in depth for any future transient RPC outage so the failure mode
 * stays legible either way.
 */
export function describeError(err: unknown): string {
  const e = err as { message?: unknown; cause?: { code?: unknown } } | undefined;
  const msg = String(e?.message ?? err);
  const code = e?.cause?.code;
  const isConnectionFailure = msg === "fetch failed" || code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ETIMEDOUT";
  if (isConnectionFailure) {
    return `Could not reach the Solana RPC endpoint (${CONFIG.rpcUrl}, cluster=${CONFIG.cluster}). The configured cluster looks unreachable right now${code ? ` (${String(code)})` : ""} — check connectivity and try again.`;
  }
  return msg;
}
