import React, { useEffect, useState } from "react";
import { api, type Catalog, type ProofReceipt } from "../api";
import type { Settled } from "../App";
import { IconShield, IconCheck, IconChevron, IconLink, IconLayers } from "../components/icons";

export function ProofReceiptView({ catalog, settlements, activeReceipt, setActiveReceipt, onBack }: {
  catalog: Catalog | null; settlements: Record<string, Settled>; activeReceipt: string | null;
  setActiveReceipt: (id: string) => void; onBack: () => void;
}) {
  const settledIds = Object.keys(settlements);
  const current = activeReceipt ?? settledIds[0] ?? null;
  const [receipt, setReceipt] = useState<ProofReceipt | null>(null);

  useEffect(() => {
    if (!current) { setReceipt(null); return; }
    const s = settlements[current];
    if (s) { setReceipt(s.receipt); return; }
    api.receipt(current).then(setReceipt).catch(() => setReceipt(null));
  }, [current, settlements]);

  if (!current || !receipt) {
    return (
      <div className="empty-state">
        <IconShield size={28} />
        <p style={{ marginTop: 12 }}>No settled market selected. Play the replay to full time and settle a market to see its proof receipt.</p>
        <button className="btn" style={{ marginTop: 16 }} onClick={onBack}>Go to replay</button>
      </div>
    );
  }

  const settle = settlements[current]?.result;
  const c = receipt.chain;
  const steps = [c.leaf, c.subtree, c.dailyRoot];

  return (
    <div className="grid-main">
      <div className="receipt">
        <div className="card">
          <div className="row spread wrap" style={{ marginBottom: "var(--pp-space-3)" }}>
            <div>
              <div className="kicker">Proof receipt</div>
              <h2 className="display" style={{ fontSize: "var(--pp-text-xl)" }}>{receipt.statLabel}</h2>
              <div className="muted tiny" style={{ marginTop: 4 }}>{receipt.predicate}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div className="kicker">Outcome</div>
              <div className="display" style={{ fontSize: "var(--pp-text-lg)", color: receipt.outcome ? "var(--pp-color-yes)" : "var(--pp-color-no)" }}>
                {receipt.outcome == null ? "—" : receipt.outcome ? "YES" : "NO"}
              </div>
            </div>
          </div>
          <p className="muted" style={{ fontSize: "var(--pp-text-sm)" }}>
            No committee and no vote resolved this market. The chain below is the resolution: one recorded fact,
            hashed and folded step by step into a root that Solana already stored. New to Merkle proofs? Read top to bottom.
          </p>
        </div>

        <div className="card">
          <div className="steps">
            {steps.map((st, i) => (
              <React.Fragment key={i}>
                <div className="step ok">
                  <span className="num">{i + 1}</span>
                  <div>
                    <div className="st">{st.title}</div>
                    <div className="plain">{st.plain}</div>
                    <div className="hashline">{st.hashHex}{"epochDay" in st ? `   ·   epoch day ${(st as any).epochDay}` : ""}</div>
                  </div>
                </div>
              </React.Fragment>
            ))}
            {(() => {
              const unavailable = !c.onChain.match && String(c.onChain.computedRootHex).startsWith("(");
              const bannerColor = c.onChain.match ? "var(--pp-color-verified)" : unavailable ? "var(--pp-color-warning)" : "var(--pp-color-no)";
              const bannerText = c.onChain.match ? "Reconstructed root equals the on-chain root" : unavailable ? "On-chain verification unavailable — not asserting a match" : "Root mismatch — this proof would be rejected";
              return (
                <div className={`step ${c.onChain.match ? "ok" : ""}`}>
                  <span className="num" style={c.onChain.match ? undefined : { color: bannerColor, borderColor: bannerColor }}>
                    {c.onChain.match ? <IconCheck size={14} /> : "4"}
                  </span>
                  <div>
                    <div className="st">{c.onChain.title}</div>
                    <div className="plain">{c.onChain.plain}</div>
                    <div className="match-banner" style={{ marginTop: 8, borderColor: `color-mix(in srgb, ${bannerColor} 45%, var(--pp-color-border))` }}>
                      <IconShield size={18} style={{ color: bannerColor }} />
                      <div>
                        <div style={{ fontWeight: 600, color: bannerColor }}>{bannerText}</div>
                        <div className="tiny mono" style={{ marginTop: 4 }}>PDA {c.onChain.pda}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      <aside className="rail">
        <div className="panel" style={{ padding: "var(--pp-space-4)" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>Settled markets</div>
          <div className="stack" style={{ gap: 6 }}>
            {settledIds.length === 0 && <div className="tiny faint">None settled yet.</div>}
            {settledIds.map((id) => {
              const s = settlements[id];
              return (
                <button key={id} className={`row spread cat-tab ${id === current ? "active" : ""}`} style={{ width: "100%" }} onClick={() => setActiveReceipt(id)}>
                  <span className="row" style={{ gap: 8 }}><IconLayers size={13} /><span style={{ fontSize: "var(--pp-text-sm)" }}>{s.receipt.statLabel.slice(0, 22)}</span></span>
                  <span className="mono tiny" style={{ color: s.result.outcome ? "var(--pp-color-yes)" : "var(--pp-color-no)" }}>{s.result.winningSide}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel" style={{ padding: "var(--pp-space-4)" }}>
          <div className="kicker" style={{ marginBottom: 8 }}>On-chain</div>
          <div className="stat-row"><span className="k">Escrow program</span></div>
          <div className="txlink" style={{ marginBottom: 8 }}>{receipt.escrowProgram}</div>
          <div className="stat-row"><span className="k">TxLINE oracle</span></div>
          <div className="txlink" style={{ marginBottom: 8 }}>{receipt.oracleProgram}</div>
          {settle && <>
            <div className="stat-row"><span className="k">Settle tx</span></div>
            <div className="txlink" style={{ marginBottom: 8 }}>{settle.txids.resolve}</div>
            <div className="stat-row"><span className="k">Winner claimed</span><span className="v yes">{(settle.potLamports / 1e9).toFixed(2)} SOL</span></div>
          </>}
          <div className="row" style={{ gap: 6, marginTop: 10 }}>
            <span className="badge net">localnet</span><span className="badge sim">simulated money</span>
          </div>
        </div>

        <button className="btn block" onClick={onBack}>Back to replay</button>
      </aside>
    </div>
  );
}
