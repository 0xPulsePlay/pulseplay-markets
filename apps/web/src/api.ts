// Typed client for the PulsePlay keeper/API (proxied via Vite to :4190).

export interface FixtureCard {
  id: number; home: string; away: string; homeCode: string; awayCode: string;
  competition: string; startTime: number; status: "live" | "upcoming" | "finished";
  statusLabel: string; score: { home: number; away: number } | null; oddsTickCount: number; replayable: boolean;
}
export interface SegmentedFixtures { live: FixtureCard[]; upcoming: FixtureCard[]; finished: FixtureCard[]; }

export interface Health {
  ok: boolean; engine: boolean; chain: boolean; programId: string; cluster: string;
  slot?: number; demoFixtureId: number; oracleProgram: string; moneyMode: string; network: string;
}

export interface Leg { label: string; statLabel: string; fairPct: number; margin: number; source: string; }
export interface Market {
  id: string; category: "outcomes" | "combos" | "batch"; kind: number; title: string; subtitle: string;
  predicateLabel: string; generation: "V1" | "V2" | "V3"; statKey: number; period: number; comparison: number;
  threshold: number; combineOp: number; fixtureProofFile: string; settleable: boolean; expectedOutcome: boolean;
  pricingSource: "de-margined" | "modeled"; fairYesPct: number; fairNoPct: number; bookYesPct: number;
  fairYesOdds: number; bookYesOdds: number; marginTaxPct: number; legs?: Leg[];
  lmsr?: { b: number; openPrices: number[]; maxLossBinary: number; outcomes: string[] }; settlementNote: string;
}
export interface Catalog { fixtureId: number; categories: { outcomes: Market[]; combos: Market[]; batch: Market[] }; }

export interface ReplayKeyframe {
  t: number; seq: number; ts: number; clockSeconds: number; minuteLabel: string; phase: string;
  half: 0 | 1 | 2; score: { home: number; away: number }; winProb: { home: number; draw: number; away: number } | null;
}
export interface ReplayData {
  fixtureId: number; home: string; away: string; homeCode: string; awayCode: string;
  finalScore: { home: number; away: number } | null; keyframes: ReplayKeyframe[];
}

export interface ParlayResult {
  legs: number; fairProbIndependent: number; fairProbCorrelated?: number; fairOdds: number; bookOdds: number;
  payoutRatio: number; marginTax: number; stake: number; fairPayout: number; bookPayout: number;
}

export interface ProofReceipt {
  marketId: string; fixtureId: number; statLabel: string; statTriple: { key: number; value: number; period: number };
  predicate: string; outcome: boolean | null; verified: boolean;
  chain: {
    leaf: { title: string; plain: string; hashHex: string };
    subtree: { title: string; plain: string; hashHex: string };
    dailyRoot: { title: string; plain: string; hashHex: string; epochDay: number };
    onChain: { title: string; plain: string; pda: string; onChainRootHex: string; computedRootHex: string; match: boolean };
  };
  settleTx: string | null; escrowProgram: string; oracleProgram: string;
}

export interface SettleResult {
  marketId: string; outcome: boolean; winningSide: "YES" | "NO";
  potBaseUnits: string; mint: string; mintDecimals: number; mintLabel: string;
  market: string; vault: string;
  txids: { create: string; depositYes: string; depositNo: string; resolve: string; claim: string };
  settledAt: number; proofFile: string; generation: "V1" | "V2" | "V3";
}

async function get<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json();
}

export const api = {
  health: () => get<Health>("/api/health"),
  fixtures: () => get<SegmentedFixtures>("/api/fixtures"),
  catalog: (fixtureId?: number) => get<Catalog>(fixtureId ? `/api/catalog?fixtureId=${fixtureId}` : "/api/catalog"),
  replay: (id: number) => get<ReplayData>(`/api/fixtures/${id}/replay`),
  parlay: (legs: { p: number; margin: number; label?: string }[], stake: number, pairwiseRho?: number[]) =>
    post<ParlayResult>("/api/parlay", { legs, stake, pairwiseRho }),
  settle: (marketId: string) => post<{ result: SettleResult; receipt: ProofReceipt }>(`/api/settle/${marketId}`),
  receipt: (marketId: string) => get<ProofReceipt>(`/api/receipt/${marketId}`),
};
