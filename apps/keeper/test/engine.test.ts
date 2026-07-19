import { describe, it, expect } from "vitest";
import {
  computeMatchPhase, buildPhaseBands, makeTMap, build1x2Series, buildLineSeries, nearestValue,
  assembleKeyframes, type StateSample, type ReplaySeriesDef, type SeriesPoint,
} from "../src/engine.js";
import type { Phase, OddsSeriesRow } from "@txline/client-sdk";

// Recorded fixture-shaped data for 18241006 (England 1-2 Argentina), pulled live from the TxLINE
// engine during development (see docs/TXLINE-INTEGRATION.md) and pinned here as plain literals so
// this suite never touches the network. Real timeline.phases from GET /v1/fixtures/18241006:
//   NS  ts=1784139512944 wallStart=1784139512944 wallEnd=1784142020222 matchMinuteStart=0   seq=3
//   H1  ts=1784142020222 wallStart=1784142020222 wallEnd=1784144922222 matchMinuteStart=0   seq=14
//   HT  ts=1784144922222 wallStart=1784144922222 wallEnd=1784145816257 matchMinuteStart=45  seq=422
//   H2  ts=1784145816257 wallStart=1784145816257 wallEnd=1784149378047 matchMinuteStart=45  seq=426
//   FT  ts=1784149378047 wallStart=1784149378047 wallEnd=1784150064772 matchMinuteStart=90  seq=959
//   FINAL ts=1784150064772 wallStart=1784150064772 wallEnd=1784150592580 matchMinuteStart=90 seq=962
// No ET — this fixture was decided in regulation (real GET /v1/fixtures/18241006/state samples
// confirmed H1 stoppage at clock.seconds=2873 (47:53) and H2 stoppage at clock.seconds=6071 (101:11)).
const NS: Phase = { status: 1, code: "NS", label: "NS", ts: 1784139512944, seq: 3, wallStart: 1784139512944, wallEnd: 1784142020222, matchMinuteStart: 0 };
const H1: Phase = { status: 2, code: "H1", label: "H1", ts: 1784142020222, seq: 14, wallStart: 1784142020222, wallEnd: 1784144922222, matchMinuteStart: 0 };
const HT: Phase = { status: 3, code: "HT", label: "HT", ts: 1784144922222, seq: 422, wallStart: 1784144922222, wallEnd: 1784145816257, matchMinuteStart: 45 };
const H2: Phase = { status: 4, code: "H2", label: "H2", ts: 1784145816257, seq: 426, wallStart: 1784145816257, wallEnd: 1784149378047, matchMinuteStart: 45 };
const FT: Phase = { status: 5, code: "FT", label: "FT", ts: 1784149378047, seq: 959, wallStart: 1784149378047, wallEnd: 1784150064772, matchMinuteStart: 90 };
const FINAL: Phase = { status: 100, code: "FINAL", label: "FINAL", ts: 1784150064772, seq: 962, wallStart: 1784150064772, wallEnd: 1784150592580, matchMinuteStart: 90 };
const PHASES = [NS, H1, HT, H2, FT, FINAL];
const KICKOFF_TS = H1.wallStart;
const PRE_MATCH_START_TS = NS.wallStart;
const END_TS = FINAL.wallEnd!;

describe("computeMatchPhase — refined phase-band enum", () => {
  it("classifies pre-kickoff as pre-match regardless of the raw code/clock", () => {
    expect(computeMatchPhase("NS", 0, false)).toBe("pre-match");
    expect(computeMatchPhase("H1", 0, false)).toBe("pre-match");
  });
  it("classifies regulation H1 before 45:00", () => {
    expect(computeMatchPhase("H1", 1977, true)).toBe("H1"); // 32:57, recorded sample
  });
  it("classifies H1 added/stoppage time (clock ran past 45:00 while still H1)", () => {
    expect(computeMatchPhase("H1", 2873, true)).toBe("stoppage"); // 47:53, recorded sample
  });
  it("classifies half-time as its own break, clock frozen at 45:00", () => {
    expect(computeMatchPhase("HT", 2700, true)).toBe("HT");
  });
  it("classifies regulation H2 before 90:00", () => {
    expect(computeMatchPhase("H2", 4304, true)).toBe("H2"); // 71:44, recorded sample
  });
  it("classifies H2 added/stoppage time (clock ran well past 90:00 while still H2)", () => {
    expect(computeMatchPhase("H2", 6071, true)).toBe("stoppage"); // 101:11, recorded sample — 11+ min of stoppage
  });
  it("classifies FT and FINAL as full-time", () => {
    expect(computeMatchPhase("FT", 0, true)).toBe("full-time");
    expect(computeMatchPhase("FINAL", 0, true)).toBe("full-time");
  });
  it("falls back to stoppage (not a crash) for an unrecognized in-play code", () => {
    expect(computeMatchPhase("PEN", 0, true)).toBe("stoppage");
  });
});

describe("makeTMap — piecewise pre-match-compressed progress map", () => {
  const tMap = makeTMap({ preMatchStartTs: PRE_MATCH_START_TS, kickoffTs: KICKOFF_TS, endTs: END_TS });

  it("anchors the window: t(preMatchStart)=0, t(end)=1", () => {
    expect(tMap(PRE_MATCH_START_TS)).toBeCloseTo(0, 10);
    expect(tMap(END_TS)).toBeCloseTo(1, 10);
  });
  it("compresses the whole pre-match window into the reserved 5% slice by default", () => {
    expect(tMap(KICKOFF_TS)).toBeCloseTo(0.05, 6);
  });
  it("is continuous at the kickoff seam (no jump between the two linear pieces)", () => {
    const justBefore = tMap(KICKOFF_TS - 1);
    const at = tMap(KICKOFF_TS);
    const justAfter = tMap(KICKOFF_TS + 1);
    expect(Math.abs(at - justBefore)).toBeLessThan(1e-4);
    expect(Math.abs(justAfter - at)).toBeLessThan(1e-4);
  });
  it("is monotonically non-decreasing across an arbitrary increasing ts series (never plays backward)", () => {
    const samples = [PRE_MATCH_START_TS, PRE_MATCH_START_TS + 500000, KICKOFF_TS - 1000, KICKOFF_TS,
      KICKOFF_TS + 60000, HT.ts, H2.ts + 3_000_000, END_TS - 1, END_TS];
    const mapped = samples.map(tMap);
    for (let i = 1; i < mapped.length; i++) expect(mapped[i]).toBeGreaterThanOrEqual(mapped[i - 1]);
  });
});

describe("buildPhaseBands — HT/2H/ET/stoppage bands from the real phase timeline", () => {
  const tMap = makeTMap({ preMatchStartTs: PRE_MATCH_START_TS, kickoffTs: KICKOFF_TS, endTs: END_TS });
  const bands = buildPhaseBands(PHASES, tMap);

  it("produces a pre-match band starting the whole timeline at t=0", () => {
    expect(bands[0].kind).toBe("pre-match");
    expect(bands[0].startT).toBeCloseTo(0, 10);
  });
  it("splits H1 into a regular band plus a trailing stoppage band (this fixture ran 2:53 into added time)", () => {
    const h1 = bands.find((b) => b.kind === "H1");
    expect(h1).toBeTruthy();
    const idx = bands.indexOf(h1!);
    expect(bands[idx + 1].kind).toBe("stoppage");
    expect(bands[idx + 1].startT).toBeGreaterThan(h1!.startT);
    expect(bands[idx + 1].endT).toBeGreaterThan(bands[idx + 1].startT);
  });
  it("gives half-time its own non-zero-width band", () => {
    const ht = bands.find((b) => b.kind === "HT");
    expect(ht).toBeTruthy();
    expect(ht!.endT).toBeGreaterThan(ht!.startT);
  });
  it("splits H2 into a regular band plus a much longer trailing stoppage band (11+ real minutes)", () => {
    const h2 = bands.find((b) => b.kind === "H2");
    expect(h2).toBeTruthy();
    const idx = bands.indexOf(h2!);
    expect(bands[idx + 1].kind).toBe("stoppage");
    // H2 stoppage (~11 min) is much wider than H1 stoppage (~3.4 min) in t-space.
    const h1Stoppage = bands.find((b, i) => b.kind === "stoppage" && bands[i - 1]?.kind === "H1");
    const h2Stoppage = bands[idx + 1];
    expect(h2Stoppage.endT - h2Stoppage.startT).toBeGreaterThan((h1Stoppage!.endT - h1Stoppage!.startT) * 2);
  });
  it("merges the back-to-back FT + FINAL phases into a single full-time band reaching t=1", () => {
    const fullTimeBands = bands.filter((b) => b.kind === "full-time");
    expect(fullTimeBands.length).toBe(1);
    expect(fullTimeBands[0].endT).toBeCloseTo(1, 10);
  });
  it("bands are ordered and contiguous (no gaps, no overlaps) across the whole [0,1] range", () => {
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].startT).toBeCloseTo(bands[i - 1].endT, 6);
    }
    expect(bands[bands.length - 1].endT).toBeCloseTo(1, 10);
  });
});

describe("build1x2Series — de-margined home/draw/away, normalized per bucket", () => {
  const rows: OddsSeriesRow[] = [
    { superOddsType: "1X2_PARTICIPANT_RESULT", marketPeriod: "", marketParameters: "", phase: "regulation", matchMinute: 0, priceName: "part1", minuteBucket: 1000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 40, tickCount: 1 },
    { superOddsType: "1X2_PARTICIPANT_RESULT", marketPeriod: "", marketParameters: "", phase: "regulation", matchMinute: 0, priceName: "draw", minuteBucket: 1000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 32, tickCount: 1 },
    { superOddsType: "1X2_PARTICIPANT_RESULT", marketPeriod: "", marketParameters: "", phase: "regulation", matchMinute: 0, priceName: "part2", minuteBucket: 1000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 24, tickCount: 1 },
    // bucket 1001: part1 missing entirely — should be skipped, never fabricated.
    { superOddsType: "1X2_PARTICIPANT_RESULT", marketPeriod: "", marketParameters: "", phase: "regulation", matchMinute: 1, priceName: "part2", minuteBucket: 1001, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 25, tickCount: 1 },
  ];
  const { home, draw, away } = build1x2Series(rows);

  it("normalizes the three sides to sum to 100 even when the raw pcts don't (40+32+24=96)", () => {
    expect(home.length).toBe(1);
    const total = home[0].value + draw[0].value + away[0].value;
    expect(total).toBeCloseTo(100, 8);
    expect(home[0].value).toBeCloseTo((40 / 96) * 100, 6);
  });
  it("converts minuteBucket to a ts in ms (bucket * 60000)", () => {
    expect(home[0].ts).toBe(1000 * 60000);
  });
  it("skips a bucket missing either side rather than fabricating a value", () => {
    expect(home.length).toBe(1); // bucket 1001 (part1 missing) never made it in
  });
});

describe("buildLineSeries — a single priceName/marketParameters tuple, charted verbatim", () => {
  const rows: OddsSeriesRow[] = [
    { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketPeriod: "", marketParameters: "line=0.5", phase: "regulation", matchMinute: 10, priceName: "over", minuteBucket: 2000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 70, tickCount: 1 },
    { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketPeriod: "", marketParameters: "line=0.5", phase: "regulation", matchMinute: 5, priceName: "over", minuteBucket: 1990, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 65, tickCount: 1 },
    { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketPeriod: "", marketParameters: "line=1.5", phase: "regulation", matchMinute: 10, priceName: "over", minuteBucket: 2000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 30, tickCount: 1 },
    { superOddsType: "OVERUNDER_PARTICIPANT_GOALS", marketPeriod: "", marketParameters: "line=0.5", phase: "regulation", matchMinute: 10, priceName: "under", minuteBucket: 2000, priceOpen: null, priceHigh: null, priceLow: null, priceClose: null, pctOpen: null, pctHigh: null, pctLow: null, pctClose: 30, tickCount: 1 },
  ];

  it("filters to exactly the requested priceName + marketParameters tuple, sorted by ts", () => {
    const over05 = buildLineSeries(rows, "over", "line=0.5");
    expect(over05.map((p) => p.value)).toEqual([65, 70]); // sorted by ts, not input order
  });
  it("a market/line the fixture has no ticks for returns an empty series, never a fabricated one", () => {
    expect(buildLineSeries(rows, "over", "line=9.5")).toEqual([]);
  });
});

describe("nearestValue", () => {
  it("returns null for an empty series", () => expect(nearestValue([], 12345)).toBeNull());
  it("picks the closest point by |ts - target|", () => {
    const pts: SeriesPoint[] = [{ ts: 0, value: 1 }, { ts: 100, value: 2 }, { ts: 300, value: 3 }];
    expect(nearestValue(pts, 90)).toBe(2);
    expect(nearestValue(pts, 5)).toBe(1);
    expect(nearestValue(pts, 1000)).toBe(3);
  });
});

describe("assembleKeyframes — multi-series + phase composition, no network", () => {
  const seriesDefs: ReplaySeriesDef[] = [
    { id: "1x2-home", label: "England win", market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-ultraviolet" },
    { id: "1x2-draw", label: "Draw", market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-amber" },
    { id: "1x2-away", label: "Argentina win", market: "1X2_PARTICIPANT_RESULT", colorVar: "--pp-graph-cyan" },
    { id: "ou-goals-over-0.5", label: "Over 0.5 match goals", market: "OVERUNDER_PARTICIPANT_GOALS", colorVar: "--pp-graph-green" },
  ];
  // One series point seeded near each state sample's ts below, so nearest-neighbor picks the
  // obviously-intended reading (avoids nearest-neighbor edge effects from sparse seed data).
  const seriesPoints: Record<string, SeriesPoint[]> = {
    "1x2-home": [
      { ts: KICKOFF_TS, value: 38 },
      { ts: KICKOFF_TS + 1_977_000, value: 42 },
      { ts: KICKOFF_TS + 2_873_000, value: 44 },
      { ts: H2.wallStart + 1_756_000, value: 60 },
      { ts: H2.wallStart + 3_524_000, value: 30 },
      { ts: END_TS, value: 20 },
    ],
    "1x2-draw": [
      { ts: KICKOFF_TS, value: 30 }, { ts: KICKOFF_TS + 1_977_000, value: 28 }, { ts: KICKOFF_TS + 2_873_000, value: 27 },
      { ts: H2.wallStart + 1_756_000, value: 22 }, { ts: H2.wallStart + 3_524_000, value: 15 }, { ts: END_TS, value: 5 },
    ],
    "1x2-away": [
      { ts: KICKOFF_TS, value: 32 }, { ts: KICKOFF_TS + 1_977_000, value: 30 }, { ts: KICKOFF_TS + 2_873_000, value: 29 },
      { ts: H2.wallStart + 1_756_000, value: 18 }, { ts: H2.wallStart + 3_524_000, value: 55 }, { ts: END_TS, value: 75 },
    ],
    "ou-goals-over-0.5": [
      { ts: KICKOFF_TS, value: 60 }, { ts: KICKOFF_TS + 1_977_000, value: 64 },
      { ts: H2.wallStart + 1_756_000, value: 85 }, { ts: H2.wallStart + 3_524_000, value: 95 }, { ts: END_TS, value: 97 },
    ],
  };
  const tMap = makeTMap({ preMatchStartTs: PRE_MATCH_START_TS, kickoffTs: KICKOFF_TS, endTs: END_TS });

  // Recorded state samples (real values pulled from GET /v1/fixtures/18241006/state?ts=…).
  const samples: StateSample[] = [
    { ts: PRE_MATCH_START_TS, seq: 7, statusLabel: "NS", clockSeconds: 0, score: null },
    { ts: PRE_MATCH_START_TS + 1_000_000, seq: 9, statusLabel: "NS", clockSeconds: 0, score: null }, // dup of the above pre-kickoff state
    { ts: KICKOFF_TS + 1_977_000, seq: 274, statusLabel: "H1", clockSeconds: 1977, score: { home: 0, away: 0 } },
    { ts: KICKOFF_TS + 2_873_000, seq: 417, statusLabel: "H1", clockSeconds: 2873, score: { home: 0, away: 0 } }, // H1 stoppage
    { ts: HT.wallStart + 50000, seq: 424, statusLabel: "HT", clockSeconds: 2700, score: { home: 0, away: 0 } },
    { ts: HT.wallStart + 400000, seq: 425, statusLabel: "HT", clockSeconds: 2700, score: { home: 0, away: 0 } }, // exact dup of the HT frame above → should collapse
    { ts: H2.wallStart + 1_756_000, seq: 683, statusLabel: "H2", clockSeconds: 4304, score: { home: 1, away: 0 } },
    { ts: H2.wallStart + 3_524_000, seq: 957, statusLabel: "H2", clockSeconds: 6071, score: { home: 1, away: 2 } }, // H2 stoppage
    { ts: FT.wallStart, seq: 959, statusLabel: "FT", clockSeconds: 0, score: { home: 1, away: 2 } },
    // buildReplay() always samples the window's true endTs as its last tsList entry (see the sampling
    // loop) — mirror that here: the last sample sits exactly at END_TS, not at FINAL.wallStart.
    { ts: END_TS, seq: 962, statusLabel: "FINAL", clockSeconds: 0, score: { home: 1, away: 2 } }, // exact dup vs FT by clock/score/matchPhase, but is the LAST sample → must be kept
  ];

  const kfs = assembleKeyframes(samples, KICKOFF_TS, tMap, seriesDefs, seriesPoints);

  it("collapses the exact-duplicate pre-kickoff and HT frames, but always keeps the final sample", () => {
    // 10 input samples, 2 exact-duplicate pairs (pre-kickoff NS×2, HT×2) → 8 kept.
    expect(kfs.length).toBe(8);
    expect(kfs[kfs.length - 1].seq).toBe(962); // FINAL, kept even though it dup-matches FT
  });
  it("assigns matchPhase per keyframe using the refined enum, matching the recorded transitions", () => {
    const phases = kfs.map((k) => k.matchPhase);
    expect(phases).toEqual(["pre-match", "H1", "stoppage", "HT", "H2", "stoppage", "full-time", "full-time"]);
  });
  it("carries every seriesDef through, nearest-sampled — pre-kickoff falls back to the nearest real reading (the opening kickoff-time price), never a fabricated value", () => {
    const preKickoff = kfs[0];
    expect(preKickoff.series["1x2-home"]).toBe(38); // nearest available point is the seeded kickoff-time price
    const h1 = kfs[1]; // ts = KICKOFF_TS + 1_977_000, a seeded point sits exactly there
    expect(h1.series["1x2-home"]).toBe(42);
    expect(h1.series["ou-goals-over-0.5"]).toBe(64);
  });
  it("derives the back-compat winProb field from the 1x2 series", () => {
    const h1 = kfs[1];
    expect(h1.winProb).toEqual({ home: 42, draw: 28, away: 30 });
  });
  it("t is strictly non-decreasing across kept keyframes (regression guard: interpolation never runs backward)", () => {
    for (let i = 1; i < kfs.length; i++) expect(kfs[i].t).toBeGreaterThanOrEqual(kfs[i - 1].t);
    expect(kfs[0].t).toBeCloseTo(0, 6);
    expect(kfs[kfs.length - 1].t).toBeCloseTo(1, 6);
  });
  it("real score is carried through and held (never resets to 0-0 once the match is underway)", () => {
    const final = kfs[kfs.length - 1];
    expect(final.score).toEqual({ home: 1, away: 2 });
  });
});
