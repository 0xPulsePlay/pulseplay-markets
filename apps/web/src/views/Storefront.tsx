import React, { useMemo, useState } from "react";
import type { Health, SegmentedFixtures, Catalog, Market, FixtureCard } from "../api";
import type { TicketLeg } from "../App";
import { MarketCard } from "../components/MarketCard";
import { TicketBuilder } from "../components/TicketBuilder";
import { Flag } from "../components/Flags";
import { IconReplay, IconBolt, IconCheck } from "../components/icons";

const CATS: { key: Market["category"]; label: string; plain: string; blurb: string }[] = [
  { key: "outcomes", label: "Outcomes", plain: "One question, one answer — e.g. \"will they score?\"", blurb: "Single-claim markets · V1 validate_stat" },
  { key: "combos", label: "Combos", plain: "Bundle a few outcomes from the SAME match — all legs settle together, in one transaction.", blurb: "Same-match multi-leg · V2 indexed strategy, one CPI" },
  { key: "batch", label: "Batch", plain: "Bigger tickets, including calculated markets like a corner-count difference.", blurb: "Mega-tickets & derived markets · V3 multiproof" },
];

export function Storefront({ health, fixtures, catalog, catalogLoading, selectedFixtureId, onSelectFixture, ticket, addLeg, removeLeg, onOpenReplay }: {
  health: Health | null; fixtures: SegmentedFixtures | null; catalog: Catalog | null; catalogLoading?: boolean;
  selectedFixtureId: number | null; onSelectFixture: (fixtureId: number, label?: string) => void;
  ticket: TicketLeg[]; addLeg: (m: Market, side: boolean) => void; removeLeg: (id: string) => void; onOpenReplay: () => void;
}) {
  const [cat, setCat] = useState<Market["category"]>("outcomes");
  const sideFor = (id: string) => ticket.find((l) => l.market.id === id)?.side;
  const markets = catalog?.categories[cat] ?? [];
  const demoFixtureId = health?.demoFixtureId ?? 18241006;
  const activeFixtureId = selectedFixtureId ?? catalog?.fixtureId ?? demoFixtureId;

  const active = useMemo(() => {
    if (!fixtures) return undefined;
    return [...fixtures.live, ...fixtures.upcoming, ...fixtures.finished].find((f) => f.id === activeFixtureId);
  }, [fixtures, activeFixtureId]);
  const isDemo = activeFixtureId === demoFixtureId;

  return (
    <div className="grid-main">
      <div>
        {/* hero — reflects whichever fixture is currently selected, not always the demo */}
        {active && (
          <div className="card hero">
            <div className="hero-head">
              {isDemo
                ? <span className="badge live"><span className="dot" />replay ready</span>
                : <span className="badge">priced only · pick the demo semifinal below to settle</span>}
              <span className="muted tiny">{active.competition || "World Cup"}</span>
              <span className="grow" />
              <span className="pill mono">{active.oddsTickCount.toLocaleString()} odds ticks</span>
            </div>
            <div className="hero-teams">
              <div className="team"><Flag code={active.homeCode} team={active.home} /><span className="name">{active.home}</span></div>
              <span className="scoreline">{active.score ? `${active.score.home}–${active.score.away}` : "–"}</span>
              <div className="team"><span className="name">{active.away}</span><Flag code={active.awayCode} team={active.away} /></div>
            </div>
            <p className="muted" style={{ fontSize: "var(--pp-text-sm)", maxWidth: 620 }}>
              {isDemo
                ? "One platform, three market categories, every one settled trustlessly on TxLINE-anchored data. Fair prices come de-margined from the feed — the book's margin never touches your payout."
                : "Real fair pricing for this fixture, from the same de-margined feed. Settlement proofs are only recorded for the semifinal demo below — pick it to watch a market settle on-chain."}
            </p>
            <div className="row wrap">
              {isDemo && <button className="btn primary" onClick={onOpenReplay}><IconReplay size={16} /> Watch the replay settle</button>}
              <span className="badge verified"><IconBolt size={12} /> oracle {health?.oracleProgram?.slice(0, 4)}…</span>
              <span className="badge net">{health?.chain ? "chain live" : "chain offline"}</span>
            </div>
          </div>
        )}

        {/* categories */}
        <div className="section-head">
          <h2>Markets</h2>
          <span className="kicker">{CATS.find((c) => c.key === cat)?.blurb}</span>
        </div>
        <p className="muted" style={{ fontSize: "var(--pp-text-sm)", margin: "0 0 var(--pp-space-3)" }}>
          {CATS.find((c) => c.key === cat)?.plain}
        </p>
        <div className="cat-tabs">
          {CATS.map((c) => (
            <button key={c.key} className={`cat-tab ${cat === c.key ? "active" : ""}`} onClick={() => setCat(c.key)} title={c.plain}>
              {c.label} <span className="mono tiny faint">{catalog?.categories[c.key]?.length ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="stack">
          {catalogLoading && <div className="card muted">Loading markets for this fixture…</div>}
          {!catalogLoading && markets.length === 0 && <div className="card muted">No markets for this fixture yet.</div>}
          {!catalogLoading && markets.map((m) => (
            <MarketCard key={m.id} market={m} selectedSide={sideFor(m.id)} onPick={(side) => addLeg(m, side)} />
          ))}
        </div>

        {/* fixtures spine — every row is clickable and scopes the whole storefront to that fixture */}
        {fixtures && (
          <>
            <div className="section-head"><h2>Fixtures</h2><span className="kicker">tap any match to browse its markets · {fixtures.finished.length} finished · {fixtures.upcoming.length} upcoming</span></div>
            <div className="card">
              {fixtures.live.length > 0 && <FixtureList title="Live" items={fixtures.live} activeId={activeFixtureId} demoFixtureId={demoFixtureId} onPick={onSelectFixture} />}
              <FixtureList title="Finished" items={fixtures.finished.slice(0, 8)} activeId={activeFixtureId} demoFixtureId={demoFixtureId} onPick={onSelectFixture} />
              <div style={{ height: 1, background: "var(--pp-color-border)", margin: "var(--pp-space-3) 0" }} />
              <FixtureList title="Upcoming" items={fixtures.upcoming.slice(0, 4)} activeId={activeFixtureId} demoFixtureId={demoFixtureId} onPick={onSelectFixture} muted />
            </div>
          </>
        )}
      </div>

      <TicketBuilder ticket={ticket} removeLeg={removeLeg} onOpenReplay={onOpenReplay} />
    </div>
  );
}

function FixtureList({ title, items, activeId, demoFixtureId, onPick, muted }: {
  title: string; items: FixtureCard[]; activeId: number; demoFixtureId: number;
  onPick: (id: number, label?: string) => void; muted?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 8 }}>{title}</div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((f) => {
          const selected = f.id === activeId;
          return (
            <button
              key={f.id}
              className={`row spread fixture-row ${selected ? "selected" : ""}`}
              onClick={() => onPick(f.id, `${f.home} v ${f.away}`)}
              aria-pressed={selected}
              style={{ width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: "4px 0" }}
            >
              <div className="row" style={{ gap: 8 }}>
                {selected && <IconCheck size={13} style={{ color: "var(--pp-color-verified)" }} />}
                <Flag code={f.homeCode} team={f.home} />
                <span style={{ fontSize: "var(--pp-text-sm)" }}>{f.home} <span className="faint">v</span> {f.away}</span>
                <Flag code={f.awayCode} team={f.away} />
                {f.id === demoFixtureId && <span className="pill tiny" title="Settlement proofs are recorded for this fixture">settleable</span>}
              </div>
              <span className="mono tiny" style={{ color: muted ? "var(--pp-color-text-faint)" : "var(--pp-color-text-muted)" }}>
                {f.score ? `${f.score.home}–${f.score.away}` : new Date(f.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
