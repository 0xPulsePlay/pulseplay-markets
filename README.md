# PulsePlay Markets

A prediction-market exchange where **one platform runs three market categories, each settled trustlessly
on TxLINE-anchored data** — and each uses the generation of the TxLINE validation instruction it's actually
best at:

| Category | Example | Settled by |
|---|---|---|
| **Outcomes** — single-claim | England to score · a red card shown | **V1** `validate_stat` (one read-only PDA) |
| **Combos** — same-match multi-leg | England 1 ∧ Argentina 2 ∧ England booked | **V2** `validate_stat_v2` — indexed strategy, **one CPI settles the ticket** |
| **Batch** — mega-tickets & derived | corner difference · cross-period tickets | **V3** multiproof / derived binary |

Deliberately, the three categories exercise **all three generations** of the TxLINE validation
instruction — V1, V2, and V3 — settled by our own program in three transactions.

The **proof is the resolution**: a settlement CPIs into the real TxLINE oracle, and a tampered proof
reverts the CPI (fail-closed) so a bad proof can never settle. No committee, no dispute window. The
**sentinel-zero trick** lets occurrence markets settle *both* sides cryptographically — "no red card" is a
provable statement (value 0), not an absence you wait on.

Fair prices come **de-margined** straight from TxLINE's `Pct` field, so the book's margin never touches
your payout — the storefront shows the fair-vs-book gap on every market and the compounding parlay
"margin tax" (three legs at 6% → you keep 84% of fair).

## What's here

```
onchain/          Anchor workspace — pulseplay_escrow program (V1/V2/V3 settlement, cancel/refund) + txoracle-cpi crate
                  + a 15-check local-validator suite against the REAL cloned oracle
packages/pricing/ de-margined probabilities · LMSR seeded at the fair prior · parlay fair-vs-book · Gaussian copula (15 tests)
apps/keeper/      Express API (:4190): engine data, pricing, on-chain settlement, proof receipts
apps/web/         Vite + React storefront (:4100): three categories, ticket builder, cinematic replay, PROOF RECEIPT view
docs/             TXLINE-INTEGRATION.md (the TxLINE endpoints used + notes back to TxODDS) + screenshots/
```

## Quickstart

See **[TECHNICAL.md](./TECHNICAL.md)** for the full run commands and architecture. TL;DR: start a
local validator that clones the oracle, deploy `pulseplay_escrow`, run the escrow suite (`npx tsx
tests/pulseplay-escrow.ts`), then `pnpm --filter @pulseplay/keeper start` + `pnpm --filter
@pulseplay/web dev`.

## Trust & safety
Local validator + devnet only — **no code path signs or submits a mainnet transaction or spends SOL.**
On-chain reads/CPIs go to the cloned oracle; money is simulated (native SOL), labeled `LOCALNET` +
`SIMULATED MONEY` in the UI. Wagering is in SOL, never the TxL credit token.

Built for the TxODDS World Cup Hackathon — Track 1 (Prediction Markets & Settlement).
