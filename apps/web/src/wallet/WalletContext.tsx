import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Connection, VersionedTransaction } from "@solana/web3.js";
import { api, type Health, type WalletBalances } from "../api";

/**
 * Phantom wallet-connect via `window.phantom.solana` — same detection pattern proven in the sibling
 * `battlefield` project tonight (read for reference, never modified). We deliberately do NOT pull in
 * @solana/wallet-adapter (a much heavier dependency graph for one wallet); Phantom's injected
 * provider is a small, stable surface and this is the ONLY wallet the brief asks for.
 */
interface PhantomProvider {
  isPhantom?: boolean;
  publicKey?: { toString(): string } | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): Promise<void>;
  signTransaction<T>(tx: T): Promise<T>;
}

function getPhantom(): PhantomProvider | null {
  try {
    const w = window as any;
    return (w.phantom && w.phantom.solana) || (w.solana && w.solana.isPhantom ? w.solana : null);
  } catch {
    return null;
  }
}

const base64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export interface WalletState {
  available: boolean; // Phantom extension detected in this browser
  connected: boolean;
  connecting: boolean;
  publicKey: string | null;
  balances: WalletBalances | null;
  balancesLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  refreshBalances: () => Promise<void>;
  fund: (tokens?: number, sol?: number) => Promise<void>;
  funding: boolean;
  /** Signs a base64 unsigned transaction the keeper built, submits it, waits for confirmation,
   *  refreshes balances, and returns the confirmed signature. */
  signAndSend: (transactionBase64: string) => Promise<string>;
  explorerTx: (sig: string) => string;
}

const WalletCtx = createContext<WalletState | null>(null);

export function WalletProvider({ health, children }: { health: Health | null; children: React.ReactNode }) {
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [balancesLoading, setBalancesLoading] = useState(false);
  const [funding, setFunding] = useState(false);
  const available = useMemo(() => !!getPhantom(), []);

  const refreshBalances = useCallback(async () => {
    if (!publicKey) return;
    setBalancesLoading(true);
    try {
      setBalances(await api.walletBalances(publicKey));
    } catch {
      /* keeper might be mid-restart — leave the last known balances rather than blanking them */
    } finally {
      setBalancesLoading(false);
    }
  }, [publicKey]);

  useEffect(() => {
    if (publicKey) refreshBalances();
  }, [publicKey, refreshBalances]);

  const connect = useCallback(async () => {
    const p = getPhantom();
    if (!p) {
      window.open("https://phantom.app/", "_blank", "noopener,noreferrer");
      return;
    }
    setConnecting(true);
    try {
      const resp = await p.connect();
      setPublicKey(resp.publicKey.toString());
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    getPhantom()?.disconnect().catch(() => {});
    setPublicKey(null);
    setBalances(null);
  }, []);

  const fund = useCallback(async (tokens = 500, sol = 0.25) => {
    if (!publicKey) return;
    setFunding(true);
    try {
      await api.faucet(publicKey, tokens, sol);
      await refreshBalances();
    } finally {
      setFunding(false);
    }
  }, [publicKey, refreshBalances]);

  const signAndSend = useCallback(async (transactionBase64: string): Promise<string> => {
    const p = getPhantom();
    if (!p || !publicKey) throw new Error("connect a wallet first");
    if (!health?.rpcUrl) throw new Error("chain RPC unavailable — is the keeper up?");
    const vtx = VersionedTransaction.deserialize(base64ToBytes(transactionBase64));
    const signed = await p.signTransaction(vtx);
    const conn = new Connection(health.rpcUrl, "confirmed");
    const sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    await conn.confirmTransaction(sig, "confirmed");
    refreshBalances();
    return sig;
  }, [publicKey, health, refreshBalances]);

  const explorerTx = useCallback((sig: string) => {
    const cluster = health?.explorerCluster ?? "custom&customUrl=http://127.0.0.1:8999";
    return `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
  }, [health]);

  const value: WalletState = {
    available, connected: !!publicKey, connecting, publicKey, balances, balancesLoading,
    connect, disconnect, refreshBalances, fund, funding, signAndSend, explorerTx,
  };
  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useWallet() must be used inside <WalletProvider>");
  return ctx;
}
