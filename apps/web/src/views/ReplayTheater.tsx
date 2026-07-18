import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type Catalog, type Health, type ReplayData, type ReplayKeyframe, type Market } from "../api";
import type { Settled } from "../App";
import { Flag } from "../components/Flags";
import { IconPlay, IconPause, IconReplay, IconBolt, IconShield, IconCheck, IconChevron } from "../components/icons";

const SPEEDS = [1, 4, 12];
const BASE_MS = 30000; // full match plays in 30s at 1× — cinematic, continuous, never compressed to mush

interface Frame { clockSeconds: number; minuteLabel: string; score: { home: number; away: number }; winProb: { home: number; draw: number; away: number } | null; phase: string; half: number; }

function interpolate(kfs: ReplayKeyframe[], p: number): Frame {
  if (!kfs.length) return { clockSeconds: 0, minuteLabel: "00:00", score: { home: 0, away: 0 }, winProb: null, phase: "", half: 0 };
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
  return { clockSeconds: cs, minuteLabel: /HT/.test(a.minuteLabel) ? "HT" : `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`, score: a.score, winProb: wp, phase: a.phase, half: a.half };
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
          <div className="sb-clock">{atFullTime ? "FULL TIME" : <><span style={{ marginRight: 6 }}>●</span>{frame.minuteLabel} {frame.phase && !/HT/.test(frame.minuteLabel) ? `· ${frame.phase}` : ""}</>}</div>
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
        <WinProbChart kfs={replay.keyframes} progress={progress} home={replay.home} away={replay.away} />
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

function WinProbChart({ kfs, progress, home, away }: { kfs: ReplayKeyframe[]; progress: number; home: string; away: string }) {
  const W = 760, H = 180, PADX = 8, PADY = 14;
  const pts = kfs.filter((k) => k.winProb);
  const x = (t: number) => PADX + t * (W - 2 * PADX);
  const y = (pct: number) => PADY + (1 - pct / 100) * (H - 2 * PADY);
  const line = (sel: (k: ReplayKeyframe) => number) => pts.filter((k) => k.t <= progress + 0.0001)
    .map((k, i) => `${i === 0 ? "M" : "L"}${x(k.t).toFixed(1)},${y(sel(k)).toFixed(1)}`).join(" ");
  const cur = pts.filter((k) => k.t <= progress + 0.0001).slice(-1)[0];
  const goalMarks = kfs.filter((k, i) => i > 0 && (k.score.home + k.score.away) > (kfs[i - 1].score.home + kfs[i - 1].score.away));

  return (
    <div className="chart-wrap">
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        {[25, 50, 75].map((g) => <line key={g} x1={PADX} x2={W - PADX} y1={y(g)} y2={y(g)} stroke="var(--pp-color-border)" strokeWidth="1" strokeDasharray="2 4" />)}
        {goalMarks.map((k, i) => k.t <= progress + 0.0001 && (
          <line key={i} x1={x(k.t)} x2={x(k.t)} y1={PADY} y2={H - PADY} stroke="var(--pp-color-live)" strokeWidth="1" opacity="0.5" />
        ))}
        <path d={line((k) => k.winProb!.home)} fill="none" stroke="var(--pp-graph-ultraviolet)" strokeWidth="2" />
        <path d={line((k) => k.winProb!.away)} fill="none" stroke="var(--pp-graph-cyan)" strokeWidth="2" />
        {cur && <>
          <circle cx={x(cur.t)} cy={y(cur.winProb!.home)} r="3.5" fill="var(--pp-graph-ultraviolet)" />
          <circle cx={x(cur.t)} cy={y(cur.winProb!.away)} r="3.5" fill="var(--pp-graph-cyan)" />
        </>}
      </svg>
      <div className="legend">
        <span><span className="sw" style={{ background: "var(--pp-graph-ultraviolet)" }} />{home} win {cur?.winProb ? `${cur.winProb.home.toFixed(0)}%` : ""}</span>
        <span><span className="sw" style={{ background: "var(--pp-graph-cyan)" }} />{away} win {cur?.winProb ? `${cur.winProb.away.toFixed(0)}%` : ""}</span>
        <span className="faint">de-margined 1X2 · goals marked</span>
      </div>
    </div>
  );
}
