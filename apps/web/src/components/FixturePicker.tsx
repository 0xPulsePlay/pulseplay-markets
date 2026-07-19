import React, { useEffect, useMemo, useState } from "react";
import type { SegmentedFixtures, FixtureCard } from "../api";
import { Flag } from "./Flags";
import { IconCheck } from "./icons";

type Segment = "live" | "upcoming" | "finished";
const SEGMENT_LABEL: Record<Segment, string> = { live: "Live", upcoming: "Upcoming", finished: "Completed" };

/**
 * Night 3 Phase E: fixture selection moved from the bottom of the page to a prominent position near the
 * top, segmented into Live / Upcoming / Completed (the keeper already computes these three buckets
 * server-side — GET /api/fixtures — this only changes placement/prominence, not the underlying data).
 * A horizontally-scrolling strip keeps ~100+ completed fixtures from pushing the rest of the page down.
 */
export function FixturePicker({ fixtures, activeFixtureId, demoFixtureId, onSelectFixture }: {
  fixtures: SegmentedFixtures | null; activeFixtureId: number; demoFixtureId: number;
  onSelectFixture: (fixtureId: number, label?: string) => void;
}) {
  const segmentOf = useMemo((): Segment => {
    if (!fixtures) return "finished";
    if (fixtures.live.some((f) => f.id === activeFixtureId)) return "live";
    if (fixtures.upcoming.some((f) => f.id === activeFixtureId)) return "upcoming";
    return "finished";
  }, [fixtures, activeFixtureId]);

  const [segment, setSegment] = useState<Segment>(segmentOf);
  // Follow the active fixture's segment on first load / whenever the selection jumps segments from
  // elsewhere (e.g. a deep link) — but don't fight the user once they've manually picked a tab.
  useEffect(() => { setSegment(segmentOf); }, [segmentOf]);

  if (!fixtures) return <div className="card muted">Loading fixtures…</div>;

  const counts: Record<Segment, number> = { live: fixtures.live.length, upcoming: fixtures.upcoming.length, finished: fixtures.finished.length };
  const items: FixtureCard[] = segment === "live" ? fixtures.live : segment === "upcoming" ? fixtures.upcoming : fixtures.finished;

  return (
    <div className="card fixture-picker">
      <div className="section-head" style={{ margin: "0 0 var(--pp-space-3)" }}>
        <h2>Fixtures</h2>
        <span className="kicker">tap any match to browse its markets + replay</span>
      </div>
      <div className="cat-tabs">
        {(["live", "upcoming", "finished"] as Segment[]).map((s) => (
          <button key={s} className={`cat-tab ${segment === s ? "active" : ""}`} onClick={() => setSegment(s)} disabled={counts[s] === 0}>
            {s === "live" && counts.live > 0 && <span className="dot live-dot" />}
            {SEGMENT_LABEL[s]} <span className="mono tiny faint">{counts[s]}</span>
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="muted tiny" style={{ padding: "var(--pp-space-3) 0" }}>
          {segment === "live" ? "No live matches right now." : segment === "upcoming" ? "No upcoming matches scheduled." : "No completed matches."}
        </div>
      ) : (
        <div className="fixture-scroll">
          {items.map((f) => {
            const selected = f.id === activeFixtureId;
            return (
              <button
                key={f.id}
                className={`fixture-pill ${selected ? "selected" : ""}`}
                onClick={() => onSelectFixture(f.id, `${f.home} v ${f.away}`)}
                aria-pressed={selected}
              >
                {selected && <IconCheck size={12} className="fp-check" />}
                <div className="fp-teams">
                  <Flag code={f.homeCode} team={f.home} /> <span className="fp-v">v</span> <Flag code={f.awayCode} team={f.away} />
                </div>
                <div className="fp-names">{f.home} <span className="faint">v</span> {f.away}</div>
                <div className="fp-meta">
                  <span className="mono tiny">
                    {f.score ? `${f.score.home}–${f.score.away}` : new Date(f.startTime).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                  {f.id === demoFixtureId && <span className="pill tiny" title="Settlement proofs are recorded for this fixture">settleable</span>}
                  {segment === "live" && <span className="pill tiny live-pill">live</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
