# BLOCKED / deferred — PulsePlay Markets

Honest log of what is parked and why, with what was tried. None of these block the core deliverable
(V1 + V3 settlement e2e on localnet with tests + storefront + proof receipt), which is green.

## 1. Devnet deploy + live resolve — RESOLVED (Night 2, 2026-07-19)
**Was blocked:** the deploy wallet used last night (`6SAXkSaEKGyptFCqc44qna83zMow3h7EHVJ1VbKxHQu6`) had
0 devnet SOL and the public faucet was rate-limited dry. A live devnet *resolve* was additionally
expected to need a devnet `X-Api-Token` that scores stat-validation would reject with 403.
**Resolved:** Mikail supplied a funded deploy wallet
(`5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ`, ~8.4 devnet SOL). `pulseplay_escrow` is deployed to
devnet at the same stable program id (`2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin`), authority = the
deploy wallet. The devnet `X-Api-Token` gate is also resolved:
`apps/keeper/scripts/get-devnet-token.mjs` replicates the subscribe→activate flow against the DEVNET
TxLINE program (`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`, devnet mint
`4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG`, `serviceLevelId=1` — NOT the mainnet mint/id=12 the
reference script defaults to; both had to be cross-checked against a read-only doc in the sibling
`txline-explorer` repo before spending anything) — dry-run clean, real run confirmed (0-cost free tier).
**Bonus, not just unblocked but a genuine live-settlement win:** the local engine at `localhost:3001`
only proxies MAINNET TxLINE, so devnet proof-fetching calls `https://txline-dev.txodds.com` directly
(raw upstream REST, different shape than the aggregated `/v1/*` surface — see
`docs/TXLINE-INTEGRATION.md` "Devnet"). Doing that turned up that the demo semifinal fixture
(`18241006`, England 1–2 Argentina) is ALSO live on devnet with matching score data. A full live
`resolve_outcome` — fetch a real proof from `txline-dev.txodds.com` at settle time, CPI the live devnet
oracle, claim — works end-to-end (`apps/keeper/scripts/verify-devnet-live-resolve.mjs`, 8/8 checks) and
is now wired into the actual keeper (`chain.ts`'s `settleMarket()` tries a live devnet proof for V1
before falling back to the recorded fixture). **Residual, not fully closed:** V2/V3 live devnet proofs
are unconfirmed (the local `/v1` surface doesn't serve V3 multiproofs even for mainnet, and the raw
devnet `/api/scores/stat-validation` multi-stat shape wasn't tested this session) — Combos/Batch stay
on recorded fixtures on devnet too, same as localnet. Not a regression, just not yet extended.

## 2. V2 (`validate_stat_v2`) — RESOLVED (was: no crate helper)
**Was blocked:** the vendored `txoracle-cpi` Rust crate ships `cpi_validate_stat` (V1) +
`cpi_validate_stat_v3` (V3) only — no `cpi_validate_stat_v2`.
**Resolved:** implemented `cpi_validate_stat_v2` as a thin **local adapter** in the program (contract-
permitted — the vendored crate is untouched). The SDK's own docstring pins it: **"V3 == V2 + a
`multiproof` field after `statsToProve`"**, so V2 is V3 minus the multiproof, with discriminator
`d0d7c2d6f147f6b2`. Wire format cross-checked against the recorded `validate-stat-v2v3` golden fixture
(offsets: ts · summary · subTreeProof · mainTreeProof · eventStatRoot · statsToProve · trailer). Combos
now settle via a real `resolve_combo` → `validate_stat_v2` indexed strategy; the V2 payload comes from the
**LIVE `/v1` multi-stat proof** (each leg carries its own membership path). Verified on-chain: escrow
suite P2.5b (settle + tamper-revert) and keeper `/api/settle/combo-final-scoreline` (generation V2, root
match). So the demo shows **all three generations — V1, V2, V3 — in three transactions.**
**Residual (minor):** Anchor's JS instruction coder allocates a fixed **1000-byte** buffer
(`@coral-xyz/anchor@0.31.1`), so a V2 combo with full per-leg membership paths is capped at ~3 legs
(~924 bytes; a 4th leg overflows at ~1084). This is a client-SDK limit, not the program or oracle — the
program accepts any number of legs. A 3-leg same-match ticket is the demo combo. To lift the cap, build
the instruction data outside Anchor's coder (e.g. via `@txline/verify` encoders) and send a raw tx.

## 3. Local validator is memory-sensitive under parallel builds (operational note)
The `solana-test-validator` that clones the mainnet oracle + PDA was OOM-reaped once while five hackathon
apps were building in parallel. It is not a code issue — restart with the documented command (see
STATUS-FOR-MIKAIL.md → Run it) and re-deploy; the escrow test suite + keeper `/api/settle` reproduce all
on-chain evidence in ~1 minute. The pricing tests and the storefront/proof-receipt (which reads on-chain
roots via the engine's mainnet verify) do not require the local validator.

## 4. V3 proofs are recorded fixtures, not live `/v1` (by design)
The local `/v1` surface does not serve V3 multiproofs (engine brief §7.4/§11). The V3 combo + batch demos
use the recorded fixtures in `onchain/fixtures/` (copied read-only from the verify package) against the
local validator. This matches the reference pattern and is the intended approach, not a gap.
