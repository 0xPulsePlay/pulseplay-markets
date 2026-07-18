# BLOCKED / deferred — PulsePlay Markets

Honest log of what is parked and why, with what was tried. None of these block the core deliverable
(V1 + V3 settlement e2e on localnet with tests + storefront + proof receipt), which is green.

## 1. Devnet deploy — faucet dry (P2.8)
**State:** localnet-only. The deploy wallet `6SAXkSaEKGyptFCqc44qna83zMow3h7EHVJ1VbKxHQu6` has **0 devnet
SOL**; `solana airdrop 1 … --url devnet` fails with "airdrop request failed / rate limit reached" (tried
repeatedly). The engine brief mentioned a 5-SOL deploy authority, but the default keypair on this machine
is empty on devnet.
**Impact:** none on the proof of record. Per the engine brief (§8.4), the **local-validator suite against
the REAL cloned oracle IS the settlement proof of record**; a devnet deploy would only add a `create_market`
smoke tx (a live devnet *resolve* is separately blocked — see below).
**To unblock:** fund `6SAX…` with ~4 devnet SOL (https://faucet.solana.com), then:
```
cd onchain && anchor build -- --features devnet   # pins the devnet oracle 6pW64gN…
solana program deploy target/deploy/pulseplay_escrow.so \
  --program-id target/deploy/pulseplay_escrow-keypair.json --url https://api.devnet.solana.com
```
**Second gate (documented fast-follow):** a live devnet *resolve* also needs a devnet `X-Api-Token` —
devnet scores stat-validation returns `403 "Missing API token"` (engine brief §4). Guest JWT covers
odds/fixtures but not scores proofs on devnet. This is why the reference escrow-demo also stopped at a
devnet `create_market` smoke and kept the local-validator suite as the record.

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
