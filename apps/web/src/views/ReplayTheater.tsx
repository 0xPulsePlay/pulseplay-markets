import React, { useEffect, useMemo, useRef, useState } from "react";
import { api, type Catalog, type Health, type ReplayData, type ReplayKeyframe, type ReplaySeriesDef, type PhaseBand, type MatchPhase, type Market, type WalletMarketInfo, type ResolveWalletMarketResult } from "../api";
import type { Settled } from "../App";
import { Flag } from "../components/Flags";
import { useWallet } from "../wallet/WalletContext";
import { IconPlay, IconPause, IconReplay, IconBolt, IconShield, IconCheck, IconChevron, IconWallet, IconSpinner } from "../components/icons";

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
          <div className="stack" style={{ marginTop: "var(--pp-space-3)", gap: 4 }}>
            {Object.values(settlements).map((s) => (
              <SettlementSteps key={s.result.marketId} settled={s} health={health} onOpenReceipt={onOpenReceipt} />
            ))}
          </div>
        )}
      </div>

      {catalog && <WalletSettlementPanel catalog={catalog} atFullTime={atFullTime} health={health} flash={flash} />}
    </div>
  );
}

/** Step-by-step CPI lifecycle for one settled market — create -> deposit x2 -> resolve (the oracle
 *  CPI) -> claim, each its own real explorer link, instead of one opaque post-hoc tx link. Collapsed
 *  by default (it's per-market detail, not the headline), expands on click. */
function SettlementSteps({ settled, health, onOpenReceipt }: { settled: Settled; health: Health | null; onOpenReceipt: (id: string) => void }) {
  const wallet = useWallet();
  const [open, setOpen] = useState(false);
  const s = settled.result;
  const explorer = (tx: string) => wallet.explorerTx ? wallet.explorerTx(tx) : `https://explorer.solana.com/tx/${tx}?cluster=${health?.explorerCluster ?? "custom&customUrl=http://127.0.0.1:8999"}`;
  const potFmt = (Number(s.potBaseUnits) / 10 ** s.mintDecimals).toFixed(2);

  return (
    <div style={{ borderTop: "1px solid var(--pp-color-border)", paddingTop: 8 }}>
      <button className="row spread" style={{ width: "100%", background: "none", border: "none", cursor: "pointer" }} onClick={() => setOpen((o) => !o)}>
        <span className="row" style={{ gap: 8 }}>
          <IconCheck size={14} style={{ color: "var(--pp-color-verified)" } as any} />
          <span style={{ fontSize: "var(--pp-text-sm)" }}>{settled.receipt.statLabel}</span>
          <span className="pill mono">{s.generation}</span>
          {s.liveProof && <span className="pill" title="This proof was fetched live from TxLINE's devnet API at settle time, not a recorded fixture">live proof</span>}
        </span>
        <span className="row tiny faint" style={{ gap: 6 }}>
          vault {potFmt} {s.mintLabel.split(" · ")[0]} → 0 <IconChevron size={13} className={open ? "rot" : ""} />
        </span>
      </button>
      {open && (
        <div className="stack" style={{ gap: 6, marginTop: 8, marginLeft: 22 }}>
          {s.steps.map((step) => (
            <div key={step.label} className="row spread" style={{ gap: 8 }}>
              <div>
                <div className="tiny" style={{ fontWeight: 600 }}>{step.label}</div>
                <div className="tiny faint" style={{ maxWidth: 480 }}>{step.description}</div>
              </div>
              <a className="tiny txlink" href={explorer(step.tx)} target="_blank" rel="noreferrer">{step.tx.slice(0, 8)}…</a>
            </div>
          ))}
          <button className="tiny txlink" style={{ textAlign: "left" }} onClick={() => onOpenReceipt(s.marketId)}>open the full proof receipt →</button>
        </div>
      )}
    </div>
  );
}

/** For a CONNECTED wallet: any market the wallet itself deposited into (via TicketBuilder's "Submit
 *  ticket") gets its own resolve+claim flow here, independent of the keeper's fake-bettor
 *  demo-settle button above. Resolve is permissionless (keeper-paid); claim needs the wallet's own
 *  signature. This is what actually shows a real wallet balance moving, not just the demo mechanics. */
function WalletSettlementPanel({ catalog, atFullTime, health, flash }: { catalog: Catalog; atFullTime: boolean; health: Health | null; flash: (m: string) => void }) {
  const wallet = useWallet();
  const settleables = [...catalog.categories.outcomes.filter((m) => m.settleable), ...catalog.categories.combos, ...catalog.categories.batch];
  const [statuses, setStatuses] = useState<Record<string, WalletMarketInfo>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [outcomes, setOutcomes] = useState<Record<string, ResolveWalletMarketResult>>({});
  const [claimed, setClaimed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!wallet.connected || !wallet.publicKey) { setStatuses({}); return; }
    let cancelled = false;
    Promise.all(settleables.map((m) => api.walletMarket(wallet.publicKey!, m.id).then((info) => [m.id, info] as const).catch(() => null)))
      .then((rows) => { if (!cancelled) setStatuses(Object.fromEntries(rows.filter((r): r is [string, WalletMarketInfo] => !!r))); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.connected, wallet.publicKey, catalog.fixtureId]);

  const mine = settleables.filter((m) => statuses[m.id]?.exists);
  if (!wallet.connected || mine.length === 0) return null;

  async function resolveMine(m: Market) {
    setBusy((b) => ({ ...b, [m.id]: true }));
    try {
      const r = await api.resolveWalletMarket(wallet.publicKey!, m.id);
      setOutcomes((o) => ({ ...o, [m.id]: r }));
      flash(r.resolveTx ? `Resolved ${m.title}: ${r.winningSide}` : `${m.title} already resolved: ${r.winningSide}`);
    } catch (e) {
      flash(`Resolve failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [m.id]: false }));
    }
  }
  async function claimMine(m: Market) {
    setBusy((b) => ({ ...b, [m.id]: true }));
    try {
      const built = await api.buildClaim(wallet.publicKey!, m.id);
      const sig = await wallet.signAndSend(built.transactionBase64);
      setClaimed((c) => ({ ...c, [m.id]: sig }));
      flash(`Claimed ${m.title} — winnings sent to your wallet`);
    } catch (e) {
      flash(`Claim failed: ${(e as Error).message}`);
    } finally {
      setBusy((b) => ({ ...b, [m.id]: false }));
    }
  }

  return (
    <div className="card panel">
      <div className="row" style={{ gap: 10, marginBottom: 10 }}>
        <IconWallet size={18} />
        <div>
          <strong>Your tickets</strong>
          <div className="tiny muted">Markets you personally deposited into with your connected wallet — resolve is permissionless (the keeper pays gas), claiming needs your own signature.</div>
        </div>
      </div>
      {!atFullTime && <div className="tiny faint">Play to full time before resolving — the proof only exists once the match has a final result.</div>}
      <div className="stack" style={{ gap: 8 }}>
        {mine.map((m) => {
          const resolved = outcomes[m.id];
          const isBusy = !!busy[m.id];
          const claimTx = claimed[m.id];
          return (
            <div key={m.id} className="row spread" style={{ borderTop: "1px solid var(--pp-color-border)", paddingTop: 8 }}>
              <div>
                <div style={{ fontSize: "var(--pp-text-sm)", fontWeight: 600 }}>{m.title}</div>
                {resolved && (
                  <div className="tiny" style={{ color: resolved.outcome ? "var(--pp-color-yes)" : "var(--pp-color-no)" }}>
                    resolved {resolved.outcome ? "YES" : "NO"} · vault {(Number(resolved.vaultBaseUnits) / 10 ** resolved.mintDecimals).toFixed(2)} {resolved.mintLabel.split(" · ")[0]}
                    {claimTx ? " · claimed" : ""}
                  </div>
                )}
                {claimTx && (
                  <a className="tiny txlink" href={wallet.explorerTx(claimTx)} target="_blank" rel="noreferrer">{claimTx.slice(0, 10)}…</a>
                )}
              </div>
              {!resolved ? (
                <button className="btn ghost" disabled={!atFullTime || isBusy} onClick={() => resolveMine(m)}>
                  {isBusy ? <IconSpinner size={14} className="spin" /> : "Resolve"}
                </button>
              ) : !claimTx ? (
                <button className="btn primary" disabled={isBusy} onClick={() => claimMine(m)}>
                  {isBusy ? <IconSpinner size={14} className="spin" /> : "Claim winnings"}
                </button>
              ) : (
                <span className="pill">done</span>
              )}
            </div>
          );
        })}
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
