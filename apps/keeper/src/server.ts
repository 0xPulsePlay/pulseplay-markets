/** PulsePlay keeper/API — engine data, pricing, on-chain settlement, proof receipts. Port 4190. */
import express from "express";
import cors from "cors";
import { compareParlay, type ParlayLeg } from "@pulseplay/pricing";
import { CONFIG } from "./config.js";
import { segmentedFixtures, fixtureCard, buildReplay } from "./engine.js";
import { buildCatalog, type Market } from "./catalog.js";
import { settleMarket, buildReceipt, chainHealth, getSettlement, allSettlements } from "./chain.js";

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
  try { engine = (await (await fetch(`${CONFIG.engineUrl}/health`)).json()).ok === true; } catch { /* down */ }
  res.json({ ok: true, engine, ...ch, demoFixtureId: CONFIG.demoFixtureId, oracleProgram: CONFIG.oracleProgram, moneyMode: "simulated", network: CONFIG.cluster });
}));

app.get("/api/fixtures", wrap(async (_req, res) => res.json(await segmentedFixtures())));
app.get("/api/fixtures/:id", wrap(async (req, res) => res.json(await fixtureCard(Number(req.params.id)))));
app.get("/api/fixtures/:id/replay", wrap(async (req, res) => res.json(await buildReplay(Number(req.params.id)))));

app.get("/api/catalog", wrap(async (_req, res) => res.json(await catalogFor(CONFIG.demoFixtureId))));
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
app.get("/api/settlement/:marketId", wrap(async (req, res) => {
  const s = getSettlement(req.params.marketId);
  if (!s) return res.status(404).json({ error: "not settled" });
  res.json(s);
}));

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[keeper] error:", err?.message ?? err);
  res.status(500).json({ error: String(err?.message ?? err) });
});

app.listen(CONFIG.port, () => {
  console.log(`[keeper] PulsePlay keeper/API on http://localhost:${CONFIG.port}`);
  console.log(`[keeper] engine=${CONFIG.engineUrl} chain=${CONFIG.rpcUrl} program=${CONFIG.programId}`);
});
