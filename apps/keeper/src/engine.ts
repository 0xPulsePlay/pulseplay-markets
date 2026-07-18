/** TxLINE engine access: fixtures segmentation + cinematic replay keyframe builder. */
import { TxlinePlatformClient } from "@txline/client-sdk";
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
export interface ReplayKeyframe {
  t: number; // normalized 0..1 across the replay
  seq: number;
  ts: number;
  clockSeconds: number; // real match clock
  minuteLabel: string; // e.g. "67:24" or "HT"
  phase: string; // statusLabel
  half: 1 | 2 | 0;
  score: { home: number; away: number };
  winProb: { home: number; draw: number; away: number } | null; // de-margined 1X2
}

export interface ReplayData {
  fixtureId: number;
  home: string;
  away: string;
  homeCode: string;
  awayCode: string;
  finalScore: { home: number; away: number } | null;
  keyframes: ReplayKeyframe[];
}

const replayCache = new Map<number, ReplayData>();

function minuteLabel(clockSeconds: number, statusLabel: string): string {
  if (/half.?time|^ht$/i.test(statusLabel)) return "HT";
  const m = Math.floor(clockSeconds / 60);
  const s = Math.floor(clockSeconds % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export async function buildReplay(fixtureId: number, samples = 90): Promise<ReplayData> {
  if (replayCache.has(fixtureId)) return replayCache.get(fixtureId)!;
  const card = await fixtureCard(fixtureId);

  // 1X2 de-margined win-prob series (per-minute pctClose for part1/draw/part2).
  let winSeries: { ts: number; home: number; draw: number; away: number }[] = [];
  try {
    const odds: any = await client.odds(fixtureId, { market: "1X2_PARTICIPANT_RESULT" });
    const byBucket = new Map<number, any>();
    for (const s of odds.series ?? []) {
      const b = s.minuteBucket;
      if (!byBucket.has(b)) byBucket.set(b, {});
      byBucket.get(b)[s.priceName] = s.pctClose;
    }
    winSeries = [...byBucket.entries()]
      .map(([bucket, p]) => ({ ts: bucket * 60000, home: p.part1 ?? null, draw: p.draw ?? null, away: p.part2 ?? null }))
      .filter((x) => x.home != null && x.away != null)
      .sort((a, b) => a.ts - b.ts);
  } catch { /* odds may be missing */ }

  const startTs = winSeries.length ? winSeries[0].ts : card.startTime;
  const endTs = winSeries.length ? winSeries[winSeries.length - 1].ts : startTs + 110 * 60000;
  const nearestWin = (ts: number) => {
    if (!winSeries.length) return null;
    let best = winSeries[0], bd = Infinity;
    for (const w of winSeries) { const d = Math.abs(w.ts - ts); if (d < bd) { bd = d; best = w; } }
    const total = best.home + best.draw + best.away || 100;
    return { home: (best.home / total) * 100, draw: (best.draw / total) * 100, away: (best.away / total) * 100 };
  };

  // Sample real match state across the window (real score + real clock).
  const keyframes: ReplayKeyframe[] = [];
  const promises: Promise<any>[] = [];
  const tsList: number[] = [];
  for (let i = 0; i < samples; i++) {
    const ts = Math.round(startTs + ((endTs - startTs) * i) / (samples - 1));
    tsList.push(ts);
    promises.push(client.state(fixtureId, { ts }).catch(() => null));
  }
  const states = await Promise.all(promises);
  let last: ReplayKeyframe | null = null;
  states.forEach((st: any, i) => {
    if (!st) return;
    const clockSeconds = st.clock?.seconds ?? 0;
    const statusLabel = st.statusLabel ?? "";
    const half: 1 | 2 | 0 = clockSeconds >= 2700 ? 2 : clockSeconds > 0 ? 1 : 0;
    const kf: ReplayKeyframe = {
      t: i / (samples - 1),
      seq: st.seq ?? 0,
      ts: tsList[i],
      clockSeconds,
      minuteLabel: minuteLabel(clockSeconds, statusLabel),
      phase: statusLabel,
      half,
      score: { home: st.score?.participant1 ?? 0, away: st.score?.participant2 ?? 0 },
      winProb: nearestWin(tsList[i]),
    };
    // Drop exact duplicate frames (clock stuck) to keep the animation moving.
    if (last && last.clockSeconds === kf.clockSeconds && last.score.home === kf.score.home && last.score.away === kf.score.away && i !== samples - 1) return;
    keyframes.push(kf);
    last = kf;
  });

  const data: ReplayData = {
    fixtureId,
    home: card.home, away: card.away, homeCode: card.homeCode, awayCode: card.awayCode,
    finalScore: card.score,
    keyframes,
  };
  replayCache.set(fixtureId, data);
  return data;
}
