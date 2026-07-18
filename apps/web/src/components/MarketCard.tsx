import React, { useState } from "react";
import type { Market } from "../api";
import { IconChevron, IconLayers, IconTarget } from "./icons";

const odds = (o: number) => o.toFixed(2);
const pct = (p: number) => `${p.toFixed(1)}%`;

export function MarketCard({ market, selectedSide, onPick }: {
  market: Market; selectedSide?: boolean; onPick: (side: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const isTicket = market.category !== "outcomes";

  return (
    <div className="card market">
      <div className="market-top">
        <div>
          <div className="market-title">{market.title}</div>
          <div className="market-sub">{market.subtitle}</div>
        </div>
        <span className="gen-chip" title={market.generation === "V1" ? "validate_stat — single stat, one PDA" : market.generation === "V2" ? "validate_stat_v2 — indexed multi-leg, one CPI" : "validate_stat_v3 — shared multiproof"}>
          {market.generation === "V1" ? <IconTarget size={11} /> : <IconLayers size={11} />} {market.generation}
        </span>
      </div>

      <div className="row wrap tiny">
        <span className={`pill ${market.pricingSource === "de-margined" ? "demarg" : ""}`}>
          {market.pricingSource === "de-margined" ? "de-margined price" : "modeled prior"}
        </span>
        <span className="pill">{market.predicateLabel}</span>
      </div>

      {!isTicket ? (
        <>
          <div className="outcomes-row">
            <button className={`oc yes ${selectedSide === true ? "sel" : ""}`} onClick={() => onPick(true)} aria-pressed={selectedSide === true}>
              <span className="lab">Yes</span><span className="val">{pct(market.fairYesPct)}</span>
            </button>
            <button className={`oc no ${selectedSide === false ? "sel" : ""}`} onClick={() => onPick(false)} aria-pressed={selectedSide === false}>
              <span className="lab">No</span><span className="val">{pct(market.fairNoPct)}</span>
            </button>
          </div>
          <div className="price-strip">
            <div className="price-cell fair">
              <div className="k">Fair (PulsePlay)</div><div className="v">{odds(market.fairYesOdds)}</div><div className="sub">YES decimal</div>
            </div>
            <div className="price-cell">
              <div className="k">Book-style</div><div className="v">{odds(market.bookYesOdds)}</div><div className="sub">{pct(market.bookYesPct)} implied</div>
            </div>
            <div className="price-cell">
              <div className="k">Margin tax</div><div className="v tax">−{market.marginTaxPct.toFixed(1)}%</div><div className="sub">book keeps</div>
            </div>
          </div>
        </>
      ) : (
        <>
          {market.legs && (
            <div className="stack">
              {market.legs.map((l, i) => (
                <div key={i} className="stat-row">
                  <span className="k">{l.label}</span>
                  <span className="v fair">{pct(l.fairPct)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="price-strip">
            <div className="price-cell fair"><div className="k">Fair payout</div><div className="v">{odds(market.fairYesOdds)}×</div><div className="sub">PulsePlay</div></div>
            <div className="price-cell"><div className="k">Book payout</div><div className="v">{odds(market.bookYesOdds)}×</div><div className="sub">typical book</div></div>
            <div className="price-cell"><div className="k">Margin tax</div><div className="v tax">−{market.marginTaxPct.toFixed(1)}%</div><div className="sub">on the parlay</div></div>
          </div>
          <button className={`oc yes ${selectedSide === true ? "sel" : ""}`} style={{ width: "100%" }} onClick={() => onPick(true)} aria-pressed={selectedSide === true}>
            <span className="lab">Back this ticket</span><span className="val">{odds(market.fairYesOdds)}×</span>
          </button>
        </>
      )}

      <button className="row tiny faint" style={{ justifyContent: "space-between", width: "100%" }} onClick={() => setOpen((o) => !o)}>
        <span>How it settles</span>
        <IconChevron size={14} className={open ? "rot" : ""} />
      </button>
      {open && <div className="tiny muted" style={{ lineHeight: 1.5 }}>{market.settlementNote}</div>}
    </div>
  );
}
