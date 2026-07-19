import React, { useEffect, useState, useCallback } from "react";
import { api, type Health, type SegmentedFixtures, type Catalog, type Market, type ProofReceipt, type SettleResult } from "./api";
import { Storefront } from "./views/Storefront";
import { ReplayTheater } from "./views/ReplayTheater";
import { ProofReceiptView } from "./views/ProofReceiptView";
import { IconShield, IconBolt } from "./components/icons";

export type View = "store" | "replay" | "receipt";
export interface TicketLeg { market: Market; side: boolean; }
export interface Settled { result: SettleResult; receipt: ProofReceipt; }

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [fixtures, setFixtures] = useState<SegmentedFixtures | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedFixtureId, setSelectedFixtureId] = useState<number | null>(null);
  const [view, setView] = useState<View>("store");
  const [ticket, setTicket] = useState<TicketLeg[]>([]);
  const [settlements, setSettlements] = useState<Record<string, Settled>>({});
  const [activeReceipt, setActiveReceipt] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
    api.fixtures().then(setFixtures).catch(() => {});
  }, []);

  const flash = useCallback((m: string) => { setToast(m); setTimeout(() => setToast(null), 2600); }, []);

  // Re-fetch the catalog whenever the selected fixture changes (Phase 2: the fixtures list is
  // clickable). `undefined` fixtureId defers to the keeper's own demo-fixture default, so the very
  // first load behaves exactly as before a fixture is ever picked.
  useEffect(() => {
    setCatalogLoading(true);
    api.catalog(selectedFixtureId ?? undefined)
      .then((c) => { setCatalog(c); setTicket([]); setSettlements({}); })
      .catch(() => {})
      .finally(() => setCatalogLoading(false));
  }, [selectedFixtureId]);

  const selectFixture = useCallback((fixtureId: number, label?: string) => {
    setSelectedFixtureId(fixtureId);
    setView("store");
    flash(label ? `Now browsing ${label}` : "Fixture selected");
  }, [flash]);

  const addLeg = useCallback((market: Market, side: boolean) => {
    setTicket((t) => {
      const without = t.filter((l) => l.market.id !== market.id);
      return [...without, { market, side }];
    });
    flash(`Added ${market.title} · ${side ? "YES" : "NO"}`);
  }, [flash]);
  const removeLeg = useCallback((id: string) => setTicket((t) => t.filter((l) => l.market.id !== id)), []);

  const recordSettlement = useCallback((s: Settled) => {
    setSettlements((prev) => ({ ...prev, [s.result.marketId]: s }));
  }, []);

  const openReceipt = useCallback((marketId: string) => { setActiveReceipt(marketId); setView("receipt"); }, []);

  return (
    <div className="app">
      <header className="topbar">
        <img className="logo" src="/logos/lockup-horizontal-on-dark.svg" alt="PulsePlay" />
        <nav>
          <button className={`navlink ${view === "store" ? "active" : ""}`} onClick={() => setView("store")}>Markets</button>
          <button className={`navlink ${view === "replay" ? "active" : ""}`} onClick={() => setView("replay")}>Replay</button>
          <button className={`navlink ${view === "receipt" ? "active" : ""}`} onClick={() => setView("receipt")} disabled={!activeReceipt && Object.keys(settlements).length === 0}>Proof</button>
        </nav>
        <span className="spacer" />
        <span className="badge net"><IconShield size={13} />{health?.network ?? "localnet"}</span>
        <span className="badge sim">simulated money</span>
        <span className="badge verified" title="TxLINE oracle CPI"><IconBolt size={12} />TxLINE settled</span>
      </header>

      <main className="page">
        {view === "store" && (
          <Storefront
            health={health} fixtures={fixtures} catalog={catalog} catalogLoading={catalogLoading}
            selectedFixtureId={selectedFixtureId} onSelectFixture={selectFixture}
            ticket={ticket} addLeg={addLeg} removeLeg={removeLeg}
            onOpenReplay={() => setView("replay")}
          />
        )}
        {view === "replay" && (
          <ReplayTheater
            catalog={catalog} health={health}
            settlements={settlements} recordSettlement={recordSettlement}
            onOpenReceipt={openReceipt} flash={flash}
          />
        )}
        {view === "receipt" && (
          <ProofReceiptView
            catalog={catalog} settlements={settlements} activeReceipt={activeReceipt}
            setActiveReceipt={setActiveReceipt} onBack={() => setView("replay")}
          />
        )}
      </main>

      {toast && <div className="toast mono">{toast}</div>}
    </div>
  );
}
