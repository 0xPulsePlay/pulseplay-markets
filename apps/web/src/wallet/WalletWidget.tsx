import React, { useState } from "react";
import { useWallet } from "./WalletContext";
import { IconWallet, IconDroplet, IconSpinner, IconChevron } from "../components/icons";

const short = (pk: string) => `${pk.slice(0, 4)}…${pk.slice(-4)}`;

export function WalletWidget() {
  const w = useWallet();
  const [open, setOpen] = useState(false);

  if (!w.connected) {
    return (
      <button className="btn ghost wallet-btn" onClick={() => w.connect()} disabled={w.connecting}>
        {w.connecting ? <IconSpinner size={14} className="spin" /> : <IconWallet size={14} />}
        {w.connecting ? "Connecting…" : w.available ? "Connect wallet" : "Get Phantom"}
      </button>
    );
  }

  const tokenAmount = w.balances ? Number(w.balances.wagerToken) / 10 ** w.balances.mintDecimals : 0;

  return (
    <div className="wallet-widget">
      <button className="btn ghost wallet-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <IconWallet size={14} />
        {short(w.publicKey!)}
        <span className="mono tiny faint">{w.balances ? `${tokenAmount.toFixed(1)} USDC` : "…"}</span>
        <IconChevron size={12} className={open ? "rot" : ""} />
      </button>
      {open && (
        <div className="wallet-panel card">
          <div className="tiny muted" style={{ marginBottom: 4 }}>Connected devnet-test wallet</div>
          <div className="mono tiny" style={{ wordBreak: "break-all", marginBottom: 10 }}>{w.publicKey}</div>
          <div className="stat-row"><span className="k">SOL (gas)</span><span className="v mono">{w.balances ? w.balances.sol.toFixed(4) : "…"}</span></div>
          <div className="stat-row"><span className="k">{w.balances?.mintLabel ?? "USDC · test token"}</span><span className="v mono">{w.balances ? tokenAmount.toFixed(2) : "…"}</span></div>
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={() => w.fund()} disabled={w.funding}>
            {w.funding ? <><IconSpinner size={14} className="spin" /> Funding…</> : <><IconDroplet size={14} /> Fund my wallet</>}
          </button>
          <p className="tiny faint" style={{ marginTop: 6, lineHeight: 1.4 }}>
            Mints test USDC + a little gas SOL, free — this is a devnet test token, never real money.
          </p>
          <button className="row tiny faint" style={{ marginTop: 10, background: "none", border: "none", justifyContent: "flex-start", width: "100%", cursor: "pointer" }} onClick={() => { w.disconnect(); setOpen(false); }}>
            Disconnect
          </button>
        </div>
      )}
    </div>
  );
}
