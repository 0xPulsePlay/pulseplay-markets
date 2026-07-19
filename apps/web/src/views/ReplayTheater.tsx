import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type Catalog, type Health, type ReplayData, type ReplayKeyframe, type ReplaySeriesDef, type PhaseBand, type MatchPhase, type Market } from "../api";
import type { Settled } from "../App";
import { Flag } from "../components/Flags";
import { IconPlay, IconPause, IconReplay, IconBolt, IconShield, IconCheck, IconChevron } from "../components/icons";

const SPEEDS = [1, 4, 12];
const BASE_MS = 30000; // full match plays in 30s at 1× — cinematic, continuous, never compressed to mush

/** Plain-language label for the refined phase enum — display-only, mirrors engine.ts's PHASE_LABEL. */
const MATCH_PHASE_LABEL: Record<MatchPhase, string> = {
  "pre-match": "Pre-match", H1: "1st Half", HT: "Half-time", H2: "2nd Half",
  ET1: "Extra Time 1", ET2: "Extra Time 2", stoppage: "Stoppage", "full-time": "Full Time",
};

interface Frame {
  clockSeconds: number; minuteLabel: string; score: { home: number; away: number };
  winProb: { home: number; draw: number; away: number } | null; phase: string; matchPhase: MatchPhase; half: number;
}

function interpolate(kfs: ReplayKeyframe[], p: number): Frame {
  if (!kfs.length) return { clockSeconds: 0, minuteLabel: "00:00", score: { home: 0, away: 0 }, winProb: null, phase: "", matchPhase: "pre-match", half: 0 };
  const x = Math.max(0, Math.min(1, p));
  let i = 0;
  while (i < kfs.length - 1 && kfs[i + 1].t <= x) i++;
  const a = kfs[i], b = kfs[Math.min(i + 1, kfs.length - 1)];
  const span = b.t - a.t || 1;
  const f = Math.max(0, Math.min(1, (x - a.t) / span));
  const cs = a.clockSeconds + (b.clockSeconds - a.clockSeconds) * f;
  const m = Math.floor(cs / 60), s = Math.floor(cs % 60);
  const wp = a.winProb && b.winProb ? {
    home: a.winProb.home + (b.winProb.home - a.winProb.home) * f,
    draw: a.winProb.draw + (b.winProb.draw - a.winProb.draw) * f,
    away: a.winProb.away + (b.winProb.away - a.winProb.away) * f,
  } : a.winProb;
  return {
    clockSeconds: cs, minuteLabel: /HT/.test(a.minuteLabel) ? "HT" : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`,
    score: a.score, winProb: wp, phase: a.phase, matchPhase: a.matchPhase, half: a.half,
  };
}

export function ReplayTheater({ catalog, health, settlements, recordSettlement, onOpenReceipt, flash }: {
  catalog: Catalog | null; health: Health | null; settlements: Record<string, Settled>;
  recordSettlement: (s: Settled) => void; onOpenReceipt: (id: string) => void; flash: (m: string) => void;
}) {
  const [replay, setReplay] = useState<ReplayData | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const [settling, setSettling] = useState(false);
  const raf = useRef<number | null>(null);
  const last = useRef<number>(0);

  useEffect(() => {
    if (!catalog) return;
    api.replay(catalog.fixtureId).then((r) => { setReplay(r); setProgress(0); setPlaying(true); }).catch(() => {});
  }, [catalog]);

  useEffect(() => {
    if (!playing) { if (raf.current) cancelAnimationFrame(raf.current); return; }
    last.current = performance.now();
    const tick = (now: number) => {
      const dt = now - last.current; last.current = now;
      setProgress((p) => {
        const np = p + (dt * speed) / BASE_MS;
        if (np >= 1) { setPlaying(false); return 1; }
        return np;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [playing, speed]);

  const frame = useMemo(() => interpolate(replay?.keyframes ?? [], progress), [replay, progress]);
  const atFullTime = progress >= 0.999;

  const settleables: Market[] = catalog ? [...catalog.categories.outcomes.filter((m) => m.settleable), ...catalog.categories.combos, ...catalog.categories.batch] : [];

  async function settleAll() {
    setSettling(true);
    for (const m of settleables) {
      if (settlements[m.id]) continue;
      try {
        flash(`Keeper settling ${m.title}…`);
        const s = await api.settle(m.id);
        recordSettlement(s);
      } catch (e) { flash(`Settle failed: ${m.title}`); }
    }
    setSettling(false);
    flash("All full-time markets settled on-chain");
  }

  if (!replay) return <div className="empty-state">Loading the semifinal replay…</div>;

  return (
    <div className="theater">
      {/* scoreboard */}
      <div className="card panel scoreboard">
        <div className="sb-team">
          <Flag code={replay.homeCode} team={replay.home} />
          <span className="name display" style={{ fontSize: "var(--pp-text-lg)" }}>{replay.home}</span>
        </div>
        <div>
          <div className="sb-score">{frame.score.home}–{frame.score.away}</div>
          <div className="sb-clock">{atFullTime ? "FULL TIME" : <><span style={{ marginRight: 6 }}>●</span>{frame.minuteLabel} {frame.matchPhase && frame.matchPhase !== "HT" ? `· ${MATCH_PHASE_LABEL[frame.matchPhase]}` : ""}</>}</div>
        </div>
        <div className="sb-team away">
          <span className="name display" style={{ fontSize: "var(--pp-text-lg)" }}>{replay.away}</span>
          <Flag code={replay.awayCode} team={replay.away} />
        </div>
      </div>

      {/* transport */}
      <div className="card">
        <div className="transport">
          <button className="btn ghost" onClick={() => { if (atFullTime) { setProgress(0); setPlaying(true); } else setPlaying((p) => !p); }} aria-label={playing ? "Pause" : "Play"}>
            {atFullTime ? <IconReplay size={16} /> : playing ? <IconPause size={16} /> : <IconPlay size={16} />}
            {atFullTime ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <div className="scrub" onClick={(e) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); setProgress(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))); }}>
            <div className="fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <div className="speed-group">
            {SPEEDS.map((s) => <button key={s} className={`speed ${speed === s ? "active" : ""}`} onClick={() => setSpeed(s)}>{s}×</button>)}
          </div>
        </div>
        <ReplayChart kfs={replay.keyframes} seriesDefs={replay.seriesDefs} phaseBands={replay.phaseBands} progress={progress} />
      </div>

      {/* market ticker */}
      <div className="card">
        <div className="section-head" style={{ margin: "0 0 var(--pp-space-3)" }}>
          <h2 style={{ fontSize: "var(--pp-text-md)" }}>Full-time markets</h2>
          <span className="kicker">settle by TxLINE proof</span>
        </div>
        <div className="chips">
          {settleables.map((m) => {
            const s = settlements[m.id];
            return (
              <div key={m.id} className={`chip ${s ? "settled" : ""}`}>
                <span className="cn">{m.title} <span className="mono faint">{m.generation}</span></span>
                <span className="cv" style={{ color: s ? (s.result.outcome ? "var(--pp-color-yes)" : "var(--pp-color-no)") : "var(--pp-color-text)" }}>
                  {s ? (s.result.winningSide) : `${m.fairYesPct.toFixed(0)}% fair`}
                </span>
                {s && <button className="tiny txlink" onClick={() => onOpenReceipt(m.id)}>proof receipt →</button>}
              </div>
            );
          })}
        </div>
      </div>

      {/* settlement climax */}
      <div className="card panel" style={{ borderColor: atFullTime ? "color-mix(in srgb, var(--pp-color-verified) 40%, var(--pp-color-border))" : undefined }}>
        <div className="row spread wrap">
          <div className="row" style={{ gap: 10 }}>
            <IconBolt size={18} />
            <div>
              <strong>Keeper settlement</strong>
              <div className="tiny muted">On full time the keeper fetches TxLINE proofs and settles every market in one CPI each — V1, V3 multiproof, V3 derived.</div>
            </div>
          </div>
          <button className="btn primary" disabled={!atFullTime || settling} onClick={settleAll}>
            {settling ? <><span className="spinner" /> settling…</> : <>Settle full-time markets</>}
          </button>
        </div>
        {!atFullTime && <div className="tiny faint" style={{ marginTop: 8 }}>Play to full time to arm settlement.</div>}
        {Object.keys(settlements).length > 0 && (
          <div className="stack" style={{ marginTop: "var(--pp-space-3)", gap: 8 }}>
            {Object.values(settlements).map((s) => (
              <div key={s.result.marketId} className="row spread" style={{ borderTop: "1px solid var(--pp-color-border)", paddingTop: 8 }}>
                <span className="row" style={{ gap: 8 }}><IconCheck size={14} className="tick" style={{ color: "var(--pp-color-verified)" } as any} />
                  <span style={{ fontSize: "var(--pp-text-sm)" }}>{s.receipt.statLabel}</span>
                  <span className="pill mono">{s.result.generation}</span>
                </span>
                <button className="row tiny txlink" onClick={() => onOpenReceipt(s.result.marketId)}>
                  {s.result.txids.resolve.slice(0, 10)}… <IconChevron size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Background shade per phase-band kind — a stable, deliberate mapping onto the existing PulsePlay
 * semantic palette (never decorative): live/orange = added time, verified/teal = settled full-time,
 * warning/amber = the two breaks (HT + ET), a barely-there brand tint alternates 1st/2nd half so the
 * halves read as distinct regions without competing with the series lines drawn on top. */
const BAND_FILL: Record<MatchPhase, string> = {
  "pre-match": "var(--pp-color-surface-raised-secondary)",
  H1: "transparent",
  HT: "color-mix(in srgb, var(--pp-color-warning) 14%, transparent)",
  H2: "color-mix(in srgb, var(--pp-color-brand) 6%, transparent)",
  ET1: "color-mix(in srgb, var(--pp-color-warning) 20%, transparent)",
  ET2: "color-mix(in srgb, var(--pp-color-warning) 26%, transparent)",
  stoppage: "color-mix(in srgb, var(--pp-color-live) 16%, transparent)",
  "full-time": "color-mix(in srgb, var(--pp-color-verified) 14%, transparent)",
};

function ReplayChart({ kfs, seriesDefs, phaseBands, progress }: {
  kfs: ReplayKeyframe[]; seriesDefs: ReplaySeriesDef[]; phaseBands: PhaseBand[]; progress: number;
}) {
  const W = 760, H = 180, PADX = 8, PADY = 14;
  const x = (t: number) => PADX + t * (W - 2 * PADX);
  const y = (pct: number) => PADY + (1 - pct / 100) * (H - 2 * PADY);

  const visible = kfs.filter((k) => k.t <= progress + 0.0001);
  const cur = visible[visible.length - 1];
  // Pre-match is drawn as a dashed, muted lead-in (nearest-neighbor-extrapolated, not a live reading —
  // "label reality everywhere": the flat/dashed look itself signals "not real match action yet").
  const preMatchEndT = phaseBands.find((b) => b.kind === "pre-match")?.endT ?? 0;

  // `visible` is ascending in t and preMatchEndT is a fixed cutoff, so "is this keyframe in the
  // pre-match segment" is monotonic — a plain filter+map is exact and far simpler than a stateful scan.
  const pathFor = (seriesId: string, wantPreMatch: boolean) => {
    const segment = visible.filter((k) => (k.t <= preMatchEndT + 0.0001) === wantPreMatch && k.series[seriesId] != null);
    return segment.map((k, i) => `${i === 0 ? "M" : "L"}${x(k.t).toFixed(1)},${y(k.series[seriesId]!).toFixed(1)}`).join(" ");
  };
  // Bridge point so the dashed pre-match lead-in visually joins the solid live line (no gap at kickoff).
  const bridgeFor = (seriesId: string) => {
    const preKfs = visible.filter((k) => k.t <= preMatchEndT + 0.0001 && k.series[seriesId] != null);
    const postKf = visible.find((k) => k.t > preMatchEndT + 0.0001 && k.series[seriesId] != null);
    if (!preKfs.length || !postKf) return "";
    const last = preKfs[preKfs.length - 1];
    return `M${x(last.t).toFixed(1)},${y(last.series[seriesId]!).toFixed(1)} L${x(postKf.t).toFixed(1)},${y(postKf.series[seriesId]!).toFixed(1)}`;
  };

  const goalMarks = kfs.filter((k, i) => i > 0 && (k.score.home + k.score.away) > (kfs[i - 1].score.home + kfs[i - 1].score.away));

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {phaseBands.map((b) => (
          <rect key={b.id} x={x(b.startT)} y={PADY} width={Math.max(0, x(b.endT) - x(b.startT))} height={H - 2 * PADY} fill={BAND_FILL[b.kind]} />
        ))}
        {[25, 50, 75].map((g) => <line key={g} x1={PADX} x2={W - PADX} y1={y(g)} y2={y(g)} stroke="var(--pp-color-border)" strokeWidth="1" strokeDasharray="2 4" />)}
        {phaseBands.slice(1).map((b) => (
          <line key={`sep-${b.id}`} x1={x(b.startT)} x2={x(b.startT)} y1={PADY} y2={H - PADY} stroke="var(--pp-color-border-strong)" strokeWidth="1" opacity="0.5" />
        ))}
        {goalMarks.map((k, i) => k.t <= progress + 0.0001 && (
          <line key={i} x1={x(k.t)} x2={x(k.t)} y1={PADY} y2={H - PADY} stroke="var(--pp-color-live)" strokeWidth="1.5" opacity="0.7" />
        ))}
        {seriesDefs.map((def) => (
          <g key={def.id}>
            <path d={bridgeFor(def.id)} fill="none" stroke={`var(${def.colorVar})`} strokeWidth="1.5" strokeDasharray="1 3" opacity="0.55" />
            <path d={pathFor(def.id, true)} fill="none" stroke={`var(${def.colorVar})`} strokeWidth="1.5" strokeDasharray="1 3" opacity="0.55" />
            <path d={pathFor(def.id, false)} fill="none" stroke={`var(${def.colorVar})`} strokeWidth="2" />
          </g>
        ))}
        {cur && seriesDefs.map((def) => {
          const v = cur.series[def.id];
          if (v == null) return null;
          return <circle key={def.id} cx={x(cur.t)} cy={y(v)} r="3.5" fill={`var(${def.colorVar})`} />;
        })}
        {phaseBands.filter((b) => x(b.endT) - x(b.startT) > 34).map((b) => (
          <text key={`lbl-${b.id}`} x={(x(b.startT) + x(b.endT)) / 2} y={PADY + 11} textAnchor="middle"
            className="chart-band-label" fill="var(--pp-color-text-faint)">
            {b.kind === "stoppage" ? "+" : b.label.toUpperCase()}
          </text>
        ))}
      </svg>
      <div className="legend">
        {seriesDefs.map((def) => (
          <span key={def.id}>
            <span className="sw" style={{ background: `var(${def.colorVar})` }} />
            {def.label} {cur?.series[def.id] != null ? `${cur.series[def.id]!.toFixed(0)}%` : ""}
          </span>
        ))}
        <span className="faint">de-margined · goals marked · shaded = HT / 2nd half / stoppage / full time</span>
      </div>
    </div>
  );
}
