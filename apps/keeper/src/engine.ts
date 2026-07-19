/** TxLINE engine access: fixtures segmentation + cinematic replay keyframe builder. */
import { TxlinePlatformClient } from "@txline/client-sdk";
import type { Phase, OddsSeriesRow } from "@txline/client-sdk";
import { CONFIG, TEAM_CODES } from "./config.js";

export const client = new TxlinePlatformClient({ baseUrl: CONFIG.engineUrl });

export interface FixtureCard {
  id: number;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  competition: string;
  startTime: number;
  status: "live" | "upcoming" | "finished";
  statusLabel: string;
  score: { home: number; away: number } | null;
  oddsTickCount: number;
  replayable: boolean;
}

const codeFor = (team: string) => TEAM_CODES[team] ?? team.slice(0, 2).toLowerCase();

function toCard(f: any): FixtureCard {
  const homeFirst = f.participant1IsHome !== false;
  const home = homeFirst ? f.participant1 : f.participant2;
  const away = homeFirst ? f.participant2 : f.participant1;
  const fs = f.finalScore as number[] | null;
  const score = fs ? { home: homeFirst ? fs[0] : fs[1], away: homeFirst ? fs[1] : fs[0] } : null;
  const status: FixtureCard["status"] = f.status === "played" || f.isFinal ? "finished" : f.status === "live" ? "live" : "upcoming";
  return {
    id: f.fixtureId,
    home, away,
    homeCode: codeFor(home), awayCode: codeFor(away),
    competition: f.competition ?? "",
    startTime: f.startTime,
    status,
    statusLabel: f.statusLabel ?? "",
    score,
    oddsTickCount: f.oddsTickCount ?? 0,
    replayable: (f.oddsTickCount ?? 0) > 500,
  };
}

export interface SegmentedFixtures {
  live: FixtureCard[];
  upcoming: FixtureCard[];
  finished: FixtureCard[];
}

export async function segmentedFixtures(): Promise<SegmentedFixtures> {
  const [live, upcoming, played] = await Promise.all([
    client.fixtures({ status: "live", limit: 50 }),
    client.fixtures({ status: "upcoming", limit: 50 }),
    client.fixtures({ status: "played", limit: 200 }),
  ]);
  const cards = (r: any) => (r.fixtures ?? []).map(toCard);
  const finished: FixtureCard[] = cards(played);
  // Surface the demo fixture first among finished (it has the richest corpus).
  finished.sort((a, b) => (a.id === CONFIG.demoFixtureId ? -1 : b.id === CONFIG.demoFixtureId ? 1 : b.oddsTickCount - a.oddsTickCount));
  return { live: cards(live), upcoming: cards(upcoming), finished };
}

export async function fixtureCard(id: number): Promise<FixtureCard> {
  const d: any = await client.fixture(id);
  return toCard(d.fixture ?? d);
}

// ── Cinematic replay keyframes (match-clock semantics: real clock.seconds + real score) ────────────

/**
 * Refined phase-band enum (Night 2 Phase 4 — was a crude `half: 1|2|0`). Regulation halves are
 * 45/90 real match-minutes; ET periods 105/120 when the fixture goes there. "stoppage" is its own
 * bucket rather than a per-half variant — visually it's a thin trailing shade on whichever half/ET
 * period is running, and text/labels still show the real clock underneath it.
 */
export type MatchPhase = "pre-match" | "H1" | "HT" | "H2" | "ET1" | "ET2" | "stoppage" | "full-time";

/** Real match-minute (in seconds) at which each running period ends in regulation — anything past
 * this while the period is still live is stoppage/added time. Sourced from the brief: 45/90/105/120. */
const PERIOD_END_SECONDS: Record<string, number> = { H1: 45 * 60, H2: 90 * 60, ET1: 105 * 60, ET2: 120 * 60 };

/**
 * Pure: classify a single (statusLabel, clock.seconds) reading into the refined phase enum.
 * `kickedOff` lets the caller mark the pre-match tracked window (status "NS") distinctly even before
 * any real clock/score data exists for it. No network, no fixture-specific assumptions — safe to
 * unit-test with recorded/synthetic samples.
 */
export function computeMatchPhase(code: string, clockSeconds: number, kickedOff: boolean): MatchPhase {
  if (!kickedOff) return "pre-match";
  const upper = (code || "").toUpperCase();
  if (upper === "HT" || upper === "HTET") return "HT";
  if (upper === "FT" || upper === "FINAL") return "full-time";
  const periodEnd = PERIOD_END_SECONDS[upper];
  if (periodEnd != null) return clockSeconds > periodEnd ? "stoppage" : (upper as MatchPhase);
  if (upper === "NS") return "pre-match";
  return "stoppage"; // PEN/WPE/FPE/unrecognized in-play labels — defensive fallback, not exercised by the demo fixture
}

const PHASE_LABEL: Record<MatchPhase, string> = {
  "pre-match": "Pre-match", H1: "1st Half", HT: "Half-time", H2: "2nd Half",
  ET1: "Extra Time 1", ET2: "Extra Time 2", stoppage: "Stoppage", "full-time": "Full Time",
};

export interface PhaseBand { id: string; kind: MatchPhase; label: string; startT: number; endT: number; }

/**
 * Pure: derive HT/2H/ET/stoppage background bands straight from the fixture's real phase timeline
 * (server-computed wall-clock boundaries from `client.fixture()`) — independent of which sampled
 * keyframes survive the dedup pass, so band widths stay proportionally honest even when a whole band
 * (e.g. a short HT) collapses to one or two kept keyframes. Stoppage is estimated by assuming the
 * match clock ran 1:1 with wall-clock inside the phase (true for a live feed, since the clock only
 * pauses at breaks) — the point where `matchMinuteStart*60 + elapsed wall-ms` crosses the period's
 * regulation end.
 */
export function buildPhaseBands(phases: Phase[], tMap: (ts: number) => number): PhaseBand[] {
  const raw: PhaseBand[] = [];
  for (const phase of phases) {
    if (phase.wallEnd == null) continue;
    const code = phase.code.toUpperCase();
    const kind: MatchPhase =
      code === "NS" ? "pre-match" :
      code === "HT" || code === "HTET" ? "HT" :
      code === "FT" || code === "FINAL" ? "full-time" :
      PERIOD_END_SECONDS[code] != null ? (code as MatchPhase) : "stoppage";
    const periodEnd = PERIOD_END_SECONDS[code];
    let stoppageStart: number | null = null;
    if (periodEnd != null && phase.matchMinuteStart != null) {
      const s = phase.wallStart + (periodEnd - phase.matchMinuteStart * 60) * 1000;
      if (s > phase.wallStart && s < phase.wallEnd) stoppageStart = s;
    }
    const startT = tMap(phase.wallStart);
    const endT = tMap(phase.wallEnd);
    if (stoppageStart != null) {
      const midT = tMap(stoppageStart);
      raw.push({ id: `${phase.code}-${phase.seq}`, kind, label: PHASE_LABEL[kind], startT, endT: midT });
      raw.push({ id: `${phase.code}-${phase.seq}-stoppage`, kind: "stoppage", label: "Stoppage", startT: midT, endT });
    } else {
      raw.push({ id: `${phase.code}-${phase.seq}`, kind, label: PHASE_LABEL[kind], startT, endT });
    }
  }
  // Merge back-to-back bands of the same kind (e.g. FT immediately followed by FINAL) into one.
  const merged: PhaseBand[] = [];
  for (const b of raw) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === b.kind && Math.abs(prev.endT - b.startT) < 1e-6) prev.endT = b.endT;
    else merged.push({ ...b });
  }
  return merged;
}

export interface TimeWindow { preMatchStartTs: number; kickoffTs: number; endTs: number; preMatchFraction?: number; }

/**
 * Pure: piecewise-linear ts→t (0..1 progress) map. The pre-match tracked window (which can span
 * dozens of real minutes) is compressed into a small fixed slice of the progress axis (default 5%)
 * so the cinematic replay doesn't burn playback time on a flat "nothing happening yet" segment —
 * the live match still gets the remaining 95%, uniformly in real time, so scrubbing/fast-forward
 * stays proportionally honest to match-clock time once kicked off.
 */
export function makeTMap(win: TimeWindow): (ts: number) => number {
  const frac = win.preMatchFraction ?? 0.05;
  const preSpan = Math.max(1, win.kickoffTs - win.preMatchStartTs);
  const matchSpan = Math.max(1, win.endTs - win.kickoffTs);
  return (ts: number) => {
    if (ts <= win.kickoffTs) {
      const local = Math.max(0, Math.min(1, (ts - win.preMatchStartTs) / preSpan));
      return local * frac;
    }
    const local = Math.max(0, Math.min(1, (ts - win.kickoffTs) / matchSpan));
    return frac + local * (1 - frac);
  };
}

export interface ReplaySeriesDef { id: string; label: string; market: string; colorVar: string; }
export interface SeriesPoint { ts: number; value: number; }

/**
 * Pure: de-margined 1X2 win-prob series (home/draw/away), bucketed by minute and normalized so the
 * three sides sum to 100 at each bucket — the same free de-margined price the storefront's Outcomes
 * pricing uses, just charted across the whole match instead of read once at the opening bucket.
 */
export function build1x2Series(rows: OddsSeriesRow[]): { home: SeriesPoint[]; draw: SeriesPoint[]; away: SeriesPoint[] } {
  const byBucket = new Map<number, Record<string, number>>();
  for (const r of rows) {
    if (r.pctClose == null) continue;
    if (!byBucket.has(r.minuteBucket)) byBucket.set(r.minuteBucket, {});
    byBucket.get(r.minuteBucket)![r.priceName] = r.pctClose;
  }
  const home: SeriesPoint[] = [], draw: SeriesPoint[] = [], away: SeriesPoint[] = [];
  for (const [bucket, p] of [...byBucket.entries()].sort((a, b) => a[0] - b[0])) {
    if (p.part1 == null || p.part2 == null) continue;
    const d = p.draw ?? 0;
    const total = p.part1 + d + p.part2 || 100;
    const ts = bucket * 60000;
    home.push({ ts, value: (p.part1 / total) * 100 });
    draw.push({ ts, value: (d / total) * 100 });
    away.push({ ts, value: (p.part2 / total) * 100 });
  }
  return { home, draw, away };
}

/**
 * Pure: a single-line probability series for one priceName/marketParameters tuple of a market — used
 * for the OVERUNDER_PARTICIPANT_GOALS "over/line=0.5" line the catalog reuses to price "England to
 * score". Charted verbatim (TxLINE's own pctClose), not re-de-margined against its "under" complement.
 */
export function buildLineSeries(rows: OddsSeriesRow[], priceName: string, marketParameters: string): SeriesPoint[] {
  return rows
    .filter((r) => r.priceName === priceName && r.marketParameters === marketParameters && r.pctClose != null)
    .map((r) => ({ ts: r.minuteBucket * 60000, value: r.pctClose as number }))
    .sort((a, b) => a.ts - b.ts);
}

/** Pure: nearest-timestamp lookup (the replay samples at fixed intervals; series ticks rarely land exactly on them). */
export function nearestValue(points: SeriesPoint[], ts: number): number | null {
  if (!points.length) return null;
  let best = points[0], bd = Infinity;
  for (const p of points) { const d = Math.abs(p.ts - ts); if (d < bd) { bd = d; best = p; } }
  return best.value;
}

export interface ReplayKeyframe {
  t: number; // normalized 0..1 across the replay (piecewise — see makeTMap)
  seq: number;
  ts: number;
  clockSeconds: number; // real match clock
  minuteLabel: string; // e.g. "67:24" or "HT"
  phase: string; // raw statusLabel, e.g. "H1"/"HT"/"H2"/"FT" (kept for back-compat display)
  matchPhase: MatchPhase; // refined phase-band enum
  half: 1 | 2 | 0; // kept for back-compat; derived from matchPhase
  score: { home: number; away: number };
  winProb: { home: number; draw: number; away: number } | null; // de-margined 1X2 (kept for back-compat)
  series: Record<string, number | null>; // every ReplayData.seriesDefs entry, nearest-sampled at this ts
}

export interface ReplayData {
  fixtureId: number;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  finalScore: { home: number; away: number } | null;
  kickoffTs: number;
  seriesDefs: ReplaySeriesDef[];
  phaseBands: PhaseBand[];
  keyframes: ReplayKeyframe[];
}

const replayCache = new Map<number, ReplayData>();

function minuteLabel(clockSeconds: number, statusLabel: string): string {
  if (/half.?time|^ht$/i.test(statusLabel)) return "HT";
  const m = Math.floor(clockSeconds / 60);
  const s = Math.floor(clockSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export interface StateSample {
  ts: number;
  seq: number;
  statusLabel: string;
  clockSeconds: number;
  score: { home: number; away: number } | null;
}

/**
 * Pure: assembles the final keyframe list from already-fetched state samples + already-extracted
 * series points — no network here, so this is the seam a hermetic unit test drives directly with
 * recorded/synthetic fixture-shaped data.
 */
export function assembleKeyframes(
  samples: StateSample[],
  kickoffTs: number,
  tMap: (ts: number) => number,
  seriesDefs: ReplaySeriesDef[],
  seriesPoints: Record<string, SeriesPoint[]>,
): ReplayKeyframe[] {
  const keyframes: ReplayKeyframe[] = [];
  let last: ReplayKeyframe | null = null;
  const sorted = [...samples].sort((a, b) => a.ts - b.ts);
  sorted.forEach((s, i) => {
    const kickedOff = s.ts >= kickoffTs;
    const matchPhase = computeMatchPhase(s.statusLabel, s.clockSeconds, kickedOff);
    const half: 1 | 2 | 0 =
      matchPhase === "H2" || matchPhase === "ET2" ? 2 :
      matchPhase === "H1" || matchPhase === "ET1" || matchPhase === "stoppage" ? 1 :
      matchPhase === "pre-match" ? 0 : (last?.half ?? 0);
    const series: Record<string, number | null> = {};
    for (const def of seriesDefs) series[def.id] = nearestValue(seriesPoints[def.id] ?? [], s.ts);
    const winProb = series["1x2-home"] != null && series["1x2-away"] != null
      ? { home: series["1x2-home"] as number, draw: series["1x2-draw"] ?? 0, away: series["1x2-away"] as number }
      : null;
    const kf: ReplayKeyframe = {
      t: tMap(s.ts), seq: s.seq, ts: s.ts, clockSeconds: s.clockSeconds,
      minuteLabel: minuteLabel(s.clockSeconds, s.statusLabel), phase: s.statusLabel, matchPhase, half,
      score: s.score ?? { home: 0, away: 0 }, winProb, series,
    };
    const isLast = i === sorted.length - 1;
    // Drop exact duplicate frames (clock/score/phase stuck — HT breaks, pre-kickoff idle) to keep the animation moving.
    if (last && !isLast && last.clockSeconds === kf.clockSeconds && last.score.home === kf.score.home
      && last.score.away === kf.score.away && last.matchPhase === kf.matchPhase) return;
    keyframes.push(kf);
    last = kf;
  });
  return keyframes;
}

export async function buildReplay(fixtureId: number, samples = 90): Promise<ReplayData> {
  if (replayCache.has(fixtureId)) return replayCache.get(fixtureId)!;
  const detail: any = await client.fixture(fixtureId);
  const card = toCard(detail.fixture ?? detail);
  const phases: Phase[] = detail.timeline?.phases ?? [];

  const kickoffTs: number = detail.kickoffTs ?? phases.find((p) => p.code.toUpperCase() !== "NS")?.wallStart ?? card.startTime;
  const preMatchStartTs = phases[0] && phases[0].code.toUpperCase() === "NS" ? phases[0].wallStart : kickoffTs - 5 * 60000;
  const lastPhase = phases[phases.length - 1];
  const endTs: number = lastPhase?.wallEnd ?? lastPhase?.ts ?? kickoffTs + 110 * 60000;

  // Pull odds ticks for the markets the catalog actually prices that have a real series for this
  // fixture — not just 1X2. Verified against /v1/fixtures/:id/markets: only 1X2_PARTICIPANT_RESULT,
  // OVERUNDER_PARTICIPANT_GOALS and ASIANHANDICAP_PARTICIPANT_GOALS have any ticks for 18241006, and
  // only the first two are what the catalog actually prices off (eng-score reuses the OU 0.5 line;
  // arg-2plus reuses 1X2 part2). eng-exact-1/red-card are deliberately "modeled" (no live series) —
  // we never fabricate a chart line for those. Any market with zero ticks is skipped, not synthesized.
  const seriesDefs: ReplaySeriesDef[] = [];
  const seriesPoints: Record<string, SeriesPoint[]> = {};
  try {
    const odds1x2: any = await client.odds(fixtureId, { market: "1X2_PARTICIPANT_RESULT" });
    const { home, draw, away } = build1x2Series(odds1x2.series ?? []);
    if (home.length) {
      seriesDefs.push({ id: "1x2-home", label: `${card.home} win`, market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-ultraviolet" });
      seriesDefs.push({ id: "1x2-draw", label: "Draw", market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-amber" });
      seriesDefs.push({ id: "1x2-away", label: `${card.away} win`, market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-cyan" });
      seriesPoints["1x2-home"] = home; seriesPoints["1x2-draw"] = draw; seriesPoints["1x2-away"] = away;
    }
  } catch { /* odds may be missing */ }
  try {
    const oddsOU: any = await client.odds(fixtureId, { market: "OVERUNDER_PARTICIPANT_GOALS" });
    const over = buildLineSeries(oddsOU.series ?? [], "over", "line=0.5");
    if (over.length) {
      seriesDefs.push({ id: "ou-goals-over-0.5", label: `Over 0.5 match goals`, market: "OVERUNDER_PARTICIPANT_GOALS", colorVar: "--pp-graph-green" });
      seriesPoints["ou-goals-over-0.5"] = over;
    }
  } catch { /* market may be missing for this fixture */ }

  const tMap = makeTMap({ preMatchStartTs, kickoffTs, endTs });

  // Sample real match state: a short fixed slice for pre-match (clearly separated, but brief — the
  // showpiece is the live match, not 40+ minutes of nothing) + dense coverage of the match itself.
  const preMatchSamples = Math.min(8, Math.max(2, Math.round(samples * 0.08)));
  const matchSamples = Math.max(2, samples - preMatchSamples);
  const tsList: number[] = [];
  for (let i = 0; i < preMatchSamples; i++) tsList.push(Math.round(preMatchStartTs + ((kickoffTs - preMatchStartTs) * i) / preMatchSamples));
  for (let i = 0; i < matchSamples; i++) tsList.push(Math.round(kickoffTs + ((endTs - kickoffTs) * i) / (matchSamples - 1)));

  const states = await Promise.all(tsList.map((ts) => client.state(fixtureId, { ts }).catch(() => null)));
  const stateSamples: StateSample[] = [];
  states.forEach((st: any, i) => {
    if (!st) return;
    stateSamples.push({
      ts: tsList[i],
      seq: st.seq ?? 0,
      statusLabel: st.statusLabel ?? "",
      clockSeconds: st.clock?.seconds ?? 0,
      score: st.score ? { home: st.score.participant1 ?? 0, away: st.score.participant2 ?? 0 } : null,
    });
  });

  const keyframes = assembleKeyframes(stateSamples, kickoffTs, tMap, seriesDefs, seriesPoints);
  const phaseBands = buildPhaseBands(phases, tMap);

  const data: ReplayData = {
    fixtureId,
    home: card.home, away: card.away, homeCode: card.homeCode, awayCode: card.awayCode,
    finalScore: card.score,
    kickoffTs, seriesDefs, phaseBands,
    keyframes,
  };
  replayCache.set(fixtureId, data);
  return data;
}
