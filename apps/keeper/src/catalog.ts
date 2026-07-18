/**
 * The three-category market catalog for a fixture, priced off TxLINE's DE-MARGINED Pct (the fair price
 * is free data). Each market carries: the settlement predicate (stat_key/period/comparison/threshold),
 * the fair YES/NO, a synthetic "book-style" price (fair re-margined), and an LMSR quote seeded at the
 * fair prior. Combos/Batch aggregate legs with the parlay fair-vs-book math.
 *
 * Every `settleable` market maps to a RECORDED proof whose predicate resolves correctly for the demo
 * final (England 1 – 2 Argentina): the keeper runs the real create→deposit→resolve→claim on-chain.
 */
import { LMSR, compareParlay, bookDecimalOdds, fairDecimalOdds, type ParlayLeg } from "@pulseplay/pricing";
import { client } from "./engine.js";
import { CONFIG } from "./config.js";

export type Category = "outcomes" | "combos" | "batch";
export type PricingSource = "de-margined" | "modeled";

export interface Leg {
  label: string;
  statLabel: string;
  fairPct: number;
  margin: number;
  source: string;
}

export interface Market {
  id: string;
  category: Category;
  kind: number; // on-chain market_kind: 0 outcome / 1 combo / 2 batch
  title: string;
  subtitle: string;
  predicateLabel: string; // the exact on-chain predicate, in plain language
  generation: "V1" | "V2" | "V3"; // which validate_stat generation settles it
  statKey: number;
  period: number;
  comparison: number; // 0 GT / 1 LT / 2 EQ
  threshold: number;
  combineOp: number; // 0 single|full / 1 add / 2 sub
  fixtureProofFile: string;
  settleable: boolean;
  expectedOutcome: boolean; // what the recorded proof resolves to (YES=true)
  pricingSource: PricingSource;
  fairYesPct: number;
  fairNoPct: number;
  bookYesPct: number;
  fairYesOdds: number;
  bookYesOdds: number;
  marginTaxPct: number;
  legs?: Leg[];
  lmsr?: { b: number; openPrices: number[]; maxLossBinary: number; outcomes: string[] };
  settlementNote: string;
}

const oddsCache = new Map<string, any>();
async function series(fixtureId: number, market: string) {
  const key = `${fixtureId}:${market}`;
  if (!oddsCache.has(key)) oddsCache.set(key, await client.odds(fixtureId, { market }).catch(() => ({ series: [] })));
  return oddsCache.get(key);
}

/** De-margined fair probability (%) for a priceName, normalized across the market's names at the opening bucket. */
async function fairPct(fixtureId: number, superOddsType: string, priceName: string, params?: string): Promise<number | null> {
  const s = await series(fixtureId, superOddsType);
  const rows = (s.series ?? []).filter((r: any) => r.priceName === priceName && (params == null || (r.marketParameters ?? "") === params));
  if (!rows.length) return null;
  rows.sort((a: any, b: any) => a.minuteBucket - b.minuteBucket);
  const bucket = rows[0].minuteBucket;
  const all = (s.series ?? []).filter((r: any) => r.minuteBucket === bucket && (params == null || (r.marketParameters ?? "") === params));
  const total = all.reduce((acc: number, r: any) => acc + (r.pctClose ?? 0), 0) || 100;
  return (rows[0].pctClose / total) * 100;
}

interface Def {
  id: string; title: string; subtitle: string; predicateLabel: string;
  statKey: number; period: number; comparison: number; threshold: number; combineOp: number;
  fixtureProofFile: string; expectedOutcome: boolean; margin: number; settlementNote: string;
  pricingSource: PricingSource;
  price: () => Promise<number>;
}

const B = 300; // LMSR liquidity subsidy per market (spec guidance)

export async function buildCatalog(fixtureId: number = CONFIG.demoFixtureId): Promise<{ fixtureId: number; categories: Record<Category, Market[]> }> {
  const defs: Def[] = [
    {
      id: "eng-score", title: "England to score", subtitle: "Home goals in the match",
      predicateLabel: "England full-match goals > 0", statKey: 1, period: 5, comparison: 0, threshold: 0, combineOp: 0,
      fixtureProofFile: "scores-proof-18241006-seq960-keys1-2.json", expectedOutcome: true, margin: 0.05, pricingSource: "de-margined",
      settlementNote: "V1 validate_stat: England scored 1 (>0) → YES, program-attested.",
      price: async () => (await fairPct(fixtureId, "OVERUNDER_PARTICIPANT_GOALS", "over", "line=0.5")) ?? 76,
    },
    {
      id: "arg-2plus", title: "Argentina 2+ goals", subtitle: "Away goals in the match",
      predicateLabel: "Argentina full-match goals > 1", statKey: 2, period: 5, comparison: 0, threshold: 1, combineOp: 0,
      fixtureProofFile: "scores-proof-18241006-seq960-keys1-2.json", expectedOutcome: true, margin: 0.06, pricingSource: "de-margined",
      settlementNote: "V1 validate_stat: Argentina scored 2 (>1) → YES. (De-margined price uses the 1X2 Argentina-win line.)",
      price: async () => (await fairPct(fixtureId, "1X2_PARTICIPANT_RESULT", "part2")) ?? 33,
    },
    {
      id: "eng-exact-1", title: "England exactly 1 goal", subtitle: "Exact home tally",
      predicateLabel: "England full-match goals == 1", statKey: 1, period: 5, comparison: 2, threshold: 1, combineOp: 0,
      fixtureProofFile: "scores-proof-18241006-seq960-keys1-2.json", expectedOutcome: true, margin: 0.07, pricingSource: "modeled",
      settlementNote: "V1 validate_stat: England final tally == 1 → YES (EqualTo predicate).",
      price: async () => 27,
    },
    {
      id: "red-card", title: "Red card shown", subtitle: "Occurrence market · sentinel-zero",
      predicateLabel: "Red cards (home) > 0", statKey: 5, period: 5, comparison: 0, threshold: 0, combineOp: 0,
      fixtureProofFile: "scores-proof-18241006-key5-redcard.json", expectedOutcome: false, margin: 0.08, pricingSource: "modeled",
      settlementNote: "Sentinel-zero: value 0 is a PROVABLE absence. 'No red card' settles the NO side cryptographically via V1 validate_stat.",
      price: async () => 18,
    },
  ];

  const outcomes = await Promise.all(defs.map(materialize));

  // combo — same-match multi-leg (V3 full coverage, one CPI settles the whole ticket).
  const argWin = outcomes.find((m) => m.id === "arg-2plus")!;
  const engScore = outcomes.find((m) => m.id === "eng-score")!;
  const comboLegs: Leg[] = [
    { label: "England exactly 1 goal", statLabel: "England goals == 1", fairPct: outcomes.find((m) => m.id === "eng-exact-1")!.fairYesPct, margin: 0.06, source: "modeled prior" },
    { label: "Argentina exactly 2 goals", statLabel: "Argentina goals == 2", fairPct: argWin.fairYesPct, margin: 0.06, source: "1X2 de-margined Pct" },
    { label: "England exactly 1 yellow", statLabel: "England yellows == 1", fairPct: 40, margin: 0.06, source: "modeled prior" },
  ];
  const combo = comboMarket("combo-final-scoreline", "The exact-final ticket", comboLegs, {
    predicateLabel: "England goals==1 ∧ Argentina goals==2 ∧ both booked — one indexed strategy",
    statKey: 1, period: 5, comparison: 2, threshold: 1, combineOp: 0, kind: 1,
    fixtureProofFile: "scores-proof-v2-18241006-keys1-2-3.json", expectedOutcome: true,
    settlementNote: "validate_stat_v2 indexed strategy: every requested stat covered exactly once by a discrete predicate; ONE CPI settles the whole same-match ticket atomically. Each leg carries its own membership path (no shared multiproof — that's V3's job for batches).",
  });

  // batch — derived market: corner difference (home − away) via a binary predicate in one CPI.
  const batch = derivedMarket("batch-corner-diff", "Corner difference", {
    predicateLabel: "(home corners − away corners) == −5",
    subtitle: "Mega-ticket · V3 multiproof · derived binary",
    statKey: 7, period: 5, comparison: 2, threshold: -5, combineOp: 2, kind: 2,
    fixtureProofFile: "scores-proof-v3-18241006-keys7-8.json", expectedOutcome: true,
    settlementNote: "Cross-period legs settle in ONE V3 multiproof CPI. Here a binary predicate: home corners (1) − away corners (6) == −5 → YES.",
    fairYesPct: 12, margin: 0.09,
  });

  return { fixtureId, categories: { outcomes, combos: [combo], batch: [batch] } };
}

async function materialize(d: Def): Promise<Market> {
  const fairYesPct = Math.max(1, Math.min(99, await d.price()));
  const fairNoPct = 100 - fairYesPct;
  const bookYesPct = Math.min(99.5, fairYesPct * (1 + d.margin));
  const fair = fairYesPct / 100;
  const lmsr = LMSR.seededAtPrior(B, [fair, 1 - fair]);
  return {
    id: d.id, category: "outcomes", kind: 0, title: d.title, subtitle: d.subtitle, predicateLabel: d.predicateLabel,
    generation: "V1", statKey: d.statKey, period: d.period, comparison: d.comparison, threshold: d.threshold, combineOp: d.combineOp,
    fixtureProofFile: d.fixtureProofFile, settleable: true, expectedOutcome: d.expectedOutcome, pricingSource: d.pricingSource,
    fairYesPct, fairNoPct, bookYesPct,
    fairYesOdds: fairDecimalOdds(fair), bookYesOdds: bookDecimalOdds(fair, d.margin),
    marginTaxPct: (1 - 1 / (1 + d.margin)) * 100,
    lmsr: { b: B, openPrices: lmsr.prices(), maxLossBinary: LMSR.maxLoss(B, 2), outcomes: ["YES", "NO"] },
    settlementNote: d.settlementNote,
  };
}

function comboMarket(id: string, title: string, legs: Leg[], meta: { predicateLabel: string; statKey: number; period: number; comparison: number; threshold: number; combineOp: number; kind: number; fixtureProofFile: string; expectedOutcome: boolean; settlementNote: string }): Market {
  const parlayLegs: ParlayLeg[] = legs.map((l) => ({ p: l.fairPct / 100, margin: l.margin, label: l.label }));
  const cmp = compareParlay(parlayLegs, 100, legs.slice(1).map(() => 0.3));
  const fairYesPct = (cmp.fairProbCorrelated ?? cmp.fairProbIndependent) * 100;
  return {
    id, category: "combos", kind: meta.kind, title, subtitle: `${legs.length}-leg same-match ticket`, predicateLabel: meta.predicateLabel,
    generation: "V2", statKey: meta.statKey, period: meta.period, comparison: meta.comparison, threshold: meta.threshold, combineOp: meta.combineOp,
    fixtureProofFile: meta.fixtureProofFile, settleable: true, expectedOutcome: meta.expectedOutcome, pricingSource: "de-margined",
    fairYesPct, fairNoPct: 100 - fairYesPct, bookYesPct: fairYesPct,
    fairYesOdds: cmp.fairOdds, bookYesOdds: cmp.bookOdds, marginTaxPct: cmp.marginTax * 100,
    legs, settlementNote: meta.settlementNote,
  };
}

function derivedMarket(id: string, title: string, meta: { predicateLabel: string; subtitle: string; statKey: number; period: number; comparison: number; threshold: number; combineOp: number; kind: number; fixtureProofFile: string; expectedOutcome: boolean; settlementNote: string; fairYesPct: number; margin: number }): Market {
  const fair = meta.fairYesPct / 100;
  return {
    id, category: "batch", kind: meta.kind, title, subtitle: meta.subtitle, predicateLabel: meta.predicateLabel,
    generation: "V3", statKey: meta.statKey, period: meta.period, comparison: meta.comparison, threshold: meta.threshold, combineOp: meta.combineOp,
    fixtureProofFile: meta.fixtureProofFile, settleable: true, expectedOutcome: meta.expectedOutcome, pricingSource: "modeled",
    fairYesPct: meta.fairYesPct, fairNoPct: 100 - meta.fairYesPct,
    bookYesPct: Math.min(99.5, meta.fairYesPct * (1 + meta.margin)),
    fairYesOdds: fairDecimalOdds(fair), bookYesOdds: bookDecimalOdds(fair, meta.margin),
    marginTaxPct: (1 - 1 / (1 + meta.margin)) * 100,
    settlementNote: meta.settlementNote,
  };
}
