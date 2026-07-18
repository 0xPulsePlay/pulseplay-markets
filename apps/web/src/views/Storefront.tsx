import React, { useState } from "react";
import type { Health, SegmentedFixtures, Catalog, Market } from "../api";
import type { TicketLeg } from "../App";
import { MarketCard } from "../components/MarketCard";
import { TicketBuilder } from "../components/TicketBuilder";
import { Flag } from "../components/Flags";
import { IconReplay, IconBolt } from "../components/icons";

const CATS: { key: Market["category"]; label: string; blurb: string }[] = [
  { key: "outcomes", label: "Outcomes", blurb: "Single-claim markets · V1 validate_stat" },
  { key: "combos", label: "Combos", blurb: "Same-match multi-leg · V2 indexed strategy, one CPI" },
  { key: "batch", label: "Batch", blurb: "Mega-tickets & derived markets · V3 multiproof" },
];

export function Storefront({ health, fixtures, catalog, ticket, addLeg, removeLeg, onOpenReplay }: {
  health: Health | null; fixtures: SegmentedFixtures | null; catalog: Catalog | null;
  ticket: TicketLeg[]; addLeg: (m: Market, side: boolean) => void; removeLeg: (id: string) => void; onOpenReplay: () => void;
}) {
  const [cat, setCat] = useState<Market["category"]>("outcomes");
  const sideFor = (id: string) => ticket.find((l) => l.market.id === id)?.side;
  const markets = catalog?.categories[cat] ?? [];
  const demo = fixtures?.finished.find((f) => f.id === (health?.demoFixtureId ?? 18241006));

  return (
    <div className="grid-main">
      <div>
        {/* hero */}
        {demo && (
          <div className="card hero">
            <div className="hero-head">
              <span className="badge live"><span className="dot" />replay ready</span>
              <span className="muted tiny">{demo.competition || "World Cup"} · semifinal</span>
              <span className="grow" />
              <span className="pill mono">{demo.oddsTickCount.toLocaleString()} odds ticks</span>
            </div>
            <div className="hero-teams">
              <div className="team"><Flag code={demo.homeCode} team={demo.home} /><span className="name">{demo.home}</span></div>
              <span className="scoreline">{demo.score ? `${demo.score.home}–${demo.score.away}` : "–"}</span>
              <div className="team"><span className="name">{demo.away}</span><Flag code={demo.awayCode} team={demo.away} /></div>
            </div>
            <p className="muted" style={{ fontSize: "var(--pp-text-sm)", maxWidth: 620 }}>
              One platform, three market categories, every one settled trustlessly on TxLINE-anchored data.
              Fair prices come de-margined from the feed — the book's margin never touches your payout.
            </p>
            <div className="row wrap">
              <button className="btn primary" onClick={onOpenReplay}><IconReplay size={16} /> Watch the replay settle</button>
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
        <div className="cat-tabs">
          {CATS.map((c) => (
            <button key={c.key} className={`cat-tab ${cat === c.key ? "active" : ""}`} onClick={() => setCat(c.key)}>
              {c.label} <span className="mono tiny faint">{catalog?.categories[c.key]?.length ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="stack">
          {markets.length === 0 && <div className="card muted">Loading markets…</div>}
          {markets.map((m) => (
            <MarketCard key={m.id} market={m} selectedSide={sideFor(m.id)} onPick={(side) => addLeg(m, side)} />
          ))}
        </div>

        {/* fixtures spine */}
        {fixtures && (
          <>
            <div className="section-head"><h2>Fixtures</h2><span className="kicker">{fixtures.finished.length} finished · {fixtures.upcoming.length} upcoming</span></div>
            <div className="card">
              <FixtureList title="Finished" items={fixtures.finished.slice(0, 6)} />
              <div style={{ height: 1, background: "var(--pp-color-border)", margin: "var(--pp-space-3) 0" }} />
              <FixtureList title="Upcoming" items={fixtures.upcoming.slice(0, 4)} muted />
            </div>
          </>
        )}
      </div>

      <TicketBuilder ticket={ticket} removeLeg={removeLeg} onOpenReplay={onOpenReplay} />
    </div>
  );
}

function FixtureList({ title, items, muted }: { title: string; items: SegmentedFixtures["finished"]; muted?: boolean }) {
  return (
    <div>
      <div className="kicker" style={{ marginBottom: 8 }}>{title}</div>
      <div className="stack" style={{ gap: 8 }}>
        {items.map((f) => (
          <div key={f.id} className="row spread">
            <div className="row" style={{ gap: 8 }}>
              <Flag code={f.homeCode} team={f.home} />
              <span style={{ fontSize: "var(--pp-text-sm)" }}>{f.home} <span className="faint">v</span> {f.away}</span>
              <Flag code={f.awayCode} team={f.away} />
            </div>
            <span className="mono tiny" style={{ color: muted ? "var(--pp-color-text-faint)" : "var(--pp-color-text-muted)" }}>
              {f.score ? `${f.score.home}–${f.score.away}` : new Date(f.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
