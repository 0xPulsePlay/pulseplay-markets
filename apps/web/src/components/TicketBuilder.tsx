import React, { useEffect, useState } from "react";
import { api, type ParlayResult } from "../api";
import type { TicketLeg } from "../App";
import { IconX, IconBolt } from "./icons";

const money = (n: number) => `$${n.toFixed(2)}`;

export function TicketBuilder({ ticket, removeLeg, onOpenReplay }: {
  ticket: TicketLeg[]; removeLeg: (id: string) => void; onOpenReplay: () => void;
}) {
  const [stake, setStake] = useState(100);
  const [result, setResult] = useState<ParlayResult | null>(null);

  useEffect(() => {
    if (ticket.length < 1) { setResult(null); return; }
    const legs = ticket.map((l) => ({
      p: (l.side ? l.market.fairYesPct : l.market.fairNoPct) / 100,
      margin: 0.06,
      label: `${l.market.title} ${l.side ? "YES" : "NO"}`,
    }));
    // same-match legs are positively correlated — pass an adjacent-pair rho chain (honest estimate).
    const rho = ticket.length > 1 ? ticket.slice(1).map(() => 0.3) : undefined;
    api.parlay(legs, stake, rho).then(setResult).catch(() => setResult(null));
  }, [ticket, stake]);

  return (
    <aside className="rail">
      <div className="panel" style={{ padding: "var(--pp-space-4)" }}>
        <div className="row spread" style={{ marginBottom: "var(--pp-space-3)" }}>
          <h3 className="display" style={{ fontSize: "var(--pp-text-md)" }}>Ticket</h3>
          <span className="pill">{ticket.length} {ticket.length === 1 ? "leg" : "legs"}</span>
        </div>

        {ticket.length === 0 ? (
          <div className="ticket-empty">Pick outcomes to build a ticket.<br />Fair pricing updates live.</div>
        ) : (
          <>
            <div className="stack" style={{ gap: 0 }}>
              {ticket.map((l) => (
                <div key={l.market.id} className="ticket-leg">
                  <div>
                    <div style={{ fontSize: "var(--pp-text-sm)", fontWeight: 600 }}>{l.market.title}</div>
                    <div className="tiny mono" style={{ color: l.side ? "var(--pp-color-yes)" : "var(--pp-color-no)" }}>
                      {l.side ? "YES" : "NO"} · {(l.side ? l.market.fairYesPct : l.market.fairNoPct).toFixed(1)}%
                    </div>
                  </div>
                  <button className="rm" onClick={() => removeLeg(l.market.id)} aria-label="Remove"><IconX size={13} /></button>
                </div>
              ))}
            </div>

            <div className="row spread" style={{ margin: "var(--pp-space-3) 0" }}>
              <span className="muted tiny">Stake</span>
              <div className="row" style={{ gap: 6 }}>
                {[25, 100, 250].map((s) => (
                  <button key={s} className={`speed ${stake === s ? "active" : ""}`} onClick={() => setStake(s)}>${s}</button>
                ))}
              </div>
            </div>

            {result && (
              <div className="stack" style={{ gap: 6, marginTop: "var(--pp-space-2)" }}>
                <div className="stat-row"><span className="k">Fair payout</span><span className="v fair">{money(result.fairPayout)}</span></div>
                <div className="stat-row"><span className="k">Book-style payout</span><span className="v">{money(result.bookPayout)}</span></div>
                <div className="stat-row"><span className="k">You keep vs book</span><span className="v yes">+{money(result.fairPayout - result.bookPayout)}</span></div>
                <div className="stat-row"><span className="k">Margin tax avoided</span><span className="v tax">{(result.marginTax * 100).toFixed(1)}%</span></div>
                {result.fairProbCorrelated != null && (
                  <div className="tiny faint" style={{ marginTop: 4 }}>
                    Correlation-adjusted win prob {(result.fairProbCorrelated * 100).toFixed(1)}% (independent {(result.fairProbIndependent * 100).toFixed(1)}%).
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="panel" style={{ padding: "var(--pp-space-4)" }}>
        <div className="row" style={{ gap: 8, marginBottom: 8 }}>
          <IconBolt size={16} className="" />
          <strong style={{ fontSize: "var(--pp-text-sm)" }}>Settles by proof, not by us</strong>
        </div>
        <p className="tiny muted" style={{ lineHeight: 1.5 }}>
          Every ticket resolves against TxLINE data anchored on Solana — one oracle CPI, no dispute window.
          Watch it settle on the semifinal replay.
        </p>
        <button className="btn primary block" style={{ marginTop: "var(--pp-space-3)" }} onClick={onOpenReplay}>Open the replay</button>
      </div>
    </aside>
  );
}
