# PulsePlay Markets

A prediction-market exchange where **one platform runs three market categories, each settled trustlessly
on TxLINE-anchored data** — and each uses the generation of the TxLINE validation instruction it's actually
best at:

| Category | Example | Settled by |
|---|---|---|
| **Outcomes** — single-claim | England to score · a red card shown | **V1** `validate_stat` (one read-only PDA) |
| **Combos** — same-match multi-leg | England scores ∧ Argentina 2+ ∧ both booked | **V3** multiproof, full coverage — **one CPI settles the ticket** |
| **Batch** — mega-tickets & derived | corner difference · cross-period tickets | **V3** multiproof / derived binary |

The **proof is the resolution**: a settlement CPIs into the real TxLINE oracle, and a tampered proof
reverts the CPI (fail-closed) so a bad proof can never settle. No committee, no dispute window. The
**sentinel-zero trick** lets occurrence markets settle *both* sides cryptographically — "no red card" is a
provable statement (value 0), not an absence you wait on.

Fair prices come **de-margined** straight from TxLINE's `Pct` field, so the book's margin never touches
your payout — the storefront shows the fair-vs-book gap on every market and the compounding parlay
"margin tax" (three legs at 6% → you keep 84% of fair).

## What's here

```
onchain/          Anchor workspace — pulseplay_escrow program (V1 + V3 settlement, cancel/refund) + txoracle-cpi crate
                  + a 10-check local-validator suite against the REAL cloned oracle
packages/pricing/ de-margined probabilities · LMSR seeded at the fair prior · parlay fair-vs-book · Gaussian copula (15 tests)
apps/keeper/      Express API (:4190): engine data, pricing, on-chain settlement, proof receipts
apps/web/         Vite + React storefront (:4100): three categories, ticket builder, cinematic replay, PROOF RECEIPT view
docs/             BUILD-STATUS.md (acceptance criteria), TXLINE-INTEGRATION.md (endpoints + feedback), screenshots/
```

## Quickstart

See **[STATUS-FOR-MIKAIL.md](./STATUS-FOR-MIKAIL.md)** for the exact run commands, what's verified
end-to-end, honest rough edges, and the 4-minute demo script. TL;DR: start a local validator that clones
the oracle, deploy `pulseplay_escrow`, run the escrow suite (`npx tsx tests/pulseplay-escrow.ts`), then
`pnpm --filter @pulseplay/keeper start` + `pnpm --filter @pulseplay/web dev`.

## Trust & safety
Local validator + devnet only — **no code path signs or submits a mainnet transaction or spends SOL.**
On-chain reads/CPIs go to the cloned oracle; money is simulated (native SOL), labeled `LOCALNET` +
`SIMULATED MONEY` in the UI. Wagering is in SOL, never the TxL credit token.

Built for the TxODDS World Cup Hackathon — Track 1 (Prediction Markets & Settlement).
