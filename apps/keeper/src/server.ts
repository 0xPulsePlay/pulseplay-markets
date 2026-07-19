/** PulsePlay keeper/API — engine data, pricing, on-chain settlement, proof receipts. Port 4190. */
import express from "express";
import cors from "cors";
import { compareParlay, type ParlayLeg } from "@pulseplay/pricing";
import { CONFIG } from "./config.js";
import { segmentedFixtures, fixtureCard, buildReplay } from "./engine.js";
import { buildCatalog, type Market } from "./catalog.js";
import {
  settleMarket, buildReceipt, chainHealth, getSettlement, allSettlements, faucetFund,
  walletBalances, walletMarketStatus, buildDepositTransaction, buildClaimTransaction, resolveWalletMarket,
} from "./chain.js";

const app = express();
app.use(cors());
app.use(express.json());

const catalogCache = new Map<number, Awaited<ReturnType<typeof buildCatalog>>>();
async function catalogFor(id: number) {
  if (!catalogCache.has(id)) catalogCache.set(id, await buildCatalog(id));
  return catalogCache.get(id)!;
}
async function findMarket(marketId: string): Promise<Market | undefined> {
  const cat = await catalogFor(CONFIG.demoFixtureId);
  return [...cat.categories.outcomes, ...cat.categories.combos, ...cat.categories.batch].find((m) => m.id === marketId);
}
const wrap = (fn: express.Handler): express.Handler => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", wrap(async (_req, res) => {
  const ch = await chainHealth();
  let engine = false;
  try { const h = (await (await fetch(`${CONFIG.engineUrl}/health`)).json()) as { ok?: boolean }; engine = h.ok === true; } catch { /* down */ }
  res.json({
    ok: true, engine, ...ch, demoFixtureId: CONFIG.demoFixtureId, oracleProgram: CONFIG.oracleProgram,
    moneyMode: "simulated", network: CONFIG.cluster, rpcUrl: CONFIG.rpcUrl,
    explorerCluster: CONFIG.cluster === "devnet" ? "devnet" : `custom&customUrl=${encodeURIComponent(CONFIG.rpcUrl)}`,
  });
}));

app.get("/api/fixtures", wrap(async (_req, res) => res.json(await segmentedFixtures())));
app.get("/api/fixtures/:id", wrap(async (req, res) => res.json(await fixtureCard(Number(req.params.id)))));
app.get("/api/fixtures/:id/replay", wrap(async (req, res) => res.json(await buildReplay(Number(req.params.id)))));

// ?fixtureId= scopes the catalog to any fixture (Phase 2: the fixtures list is now clickable); omitted
// defaults to the demo fixture exactly as before. /api/catalog/:id kept for existing callers.
app.get("/api/catalog", wrap(async (req, res) => {
  const fixtureId = req.query.fixtureId ? Number(req.query.fixtureId) : CONFIG.demoFixtureId;
  res.json(await catalogFor(fixtureId));
}));
app.get("/api/catalog/:id", wrap(async (req, res) => res.json(await catalogFor(Number(req.params.id)))));

app.post("/api/parlay", wrap(async (req, res) => {
  const legs: ParlayLeg[] = (req.body?.legs ?? []).map((l: any) => ({ p: l.p, margin: l.margin ?? 0.06, label: l.label }));
  const stake = Number(req.body?.stake ?? 100);
  const rho = Array.isArray(req.body?.pairwiseRho) ? req.body.pairwiseRho : undefined;
  if (!legs.length) return res.status(400).json({ error: "legs required" });
  res.json(compareParlay(legs, stake, rho));
}));

app.post("/api/settle/:marketId", wrap(async (req, res) => {
  const m = await findMarket(req.params.marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  if (!m.settleable) return res.status(400).json({ error: "market is priced-only, not settleable in the demo" });
  const result = await settleMarket(m);
  const receipt = await buildReceipt(m);
  res.json({ result, receipt });
}));

app.get("/api/receipt/:marketId", wrap(async (req, res) => {
  const m = await findMarket(req.params.marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  res.json(await buildReceipt(m));
}));

app.get("/api/settlements", wrap(async (_req, res) => res.json({ settlements: allSettlements() })));

// "Fund my wallet": mint test wager-token + a little gas SOL to any wallet's ATA. No rate limit — we
// control the mint authority. Body: { wallet: "<base58 pubkey>", tokens?: number, sol?: number }.
app.post("/api/faucet", wrap(async (req, res) => {
  const wallet = String(req.body?.wallet ?? "");
  if (!wallet) return res.status(400).json({ error: "wallet (base58 pubkey) required" });
  const tokens = Number(req.body?.tokens ?? 500);
  const sol = Number(req.body?.sol ?? 0.25);
  const result = await faucetFund(wallet, tokens, sol);
  res.json(result);
}));
app.get("/api/settlement/:marketId", wrap(async (req, res) => {
  const s = getSettlement(req.params.marketId);
  if (!s) return res.status(404).json({ error: "not settled" });
  res.json(s);
}));

// ── Phase 3: wallet-connected ticket submission ──────────────────────────────────────────────────
// The keeper builds these transactions (it has the Anchor Program + IDL) but never signs them; the
// CLIENT signs with Phantom and submits itself. See chain.ts for why a connected wallet gets its OWN
// market instance (authority = the wallet) rather than reusing settleMarket()'s fake-bettor markets.

app.get("/api/wallet/:wallet/balances", wrap(async (req, res) => res.json(await walletBalances(req.params.wallet))));

app.get("/api/wallet/:wallet/market/:marketId", wrap(async (req, res) => {
  const m = await findMarket(req.params.marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  res.json(await walletMarketStatus(req.params.wallet, m));
}));

app.post("/api/tickets/build-deposit", wrap(async (req, res) => {
  const { wallet, marketId, side, amountWhole } = req.body ?? {};
  if (!wallet || !marketId || typeof side !== "boolean") return res.status(400).json({ error: "wallet, marketId, side (boolean) required" });
  const m = await findMarket(marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  if (!m.settleable) return res.status(400).json({ error: "this fixture has no recorded settlement proof — pick the demo semifinal to bet on a market that will actually resolve" });
  const result = await buildDepositTransaction(wallet, m, side, Number(amountWhole ?? 1));
  res.json(result);
}));

app.post("/api/tickets/build-claim", wrap(async (req, res) => {
  const { wallet, marketId } = req.body ?? {};
  if (!wallet || !marketId) return res.status(400).json({ error: "wallet, marketId required" });
  const m = await findMarket(marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  const result = await buildClaimTransaction(wallet, m);
  res.json(result);
}));

// Resolve a connected wallet's OWN market (permissionless on-chain — the keeper pays gas and signs,
// but the proof is what actually authorizes the outcome). Claiming any winnings still needs the
// wallet's own signature via /api/tickets/build-claim.
app.post("/api/wallet/:wallet/market/:marketId/resolve", wrap(async (req, res) => {
  const m = await findMarket(req.params.marketId);
  if (!m) return res.status(404).json({ error: "unknown market" });
  if (!m.settleable) return res.status(400).json({ error: "this fixture has no recorded settlement proof" });
  const result = await resolveWalletMarket(req.params.wallet, m);
  res.json(result);
}));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[keeper] error:", err?.message ?? err);
  res.status(500).json({ error: String(err?.message ?? err) });
});

app.listen(CONFIG.port, () => {
  console.log(`[keeper] PulsePlay keeper/API on http://localhost:${CONFIG.port}`);
  console.log(`[keeper] engine=${CONFIG.engineUrl} chain=${CONFIG.rpcUrl} program=${CONFIG.programId}`);
});
