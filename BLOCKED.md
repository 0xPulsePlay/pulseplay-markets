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

## 2. V2 helper gap — `validate_stat_v2` not shipped by the vendored crate/SDK
**State:** the `txoracle-cpi` Rust crate exposes `cpi_validate_stat` (V1) and `cpi_validate_stat_v3` (V3)
only — there is **no `cpi_validate_stat_v2`**. `@txline/verify` similarly ships V1 + V3 instruction
builders (it exports a `VALIDATE_STAT_V2_DISCRIMINATOR` constant but no full V2 builder/verifier).
**Decision (not a stall):** the three product categories map cleanly onto the two shipped generations —
Outcomes → **V1**, Combos → **V3 full-coverage** (one CPI covers every requested stat exactly once, which
is precisely the "indexed multi-leg, one ticket, one CPI" semantics V2 was meant to provide), Batch → **V3
multiproof / derived binary**. The multiproof (V3) subsumes V2. Both settle correctly and fail-closed in
the local-validator suite (10/10).
**To add a literal V2 CPI later:** mirror the V2 Borsh layout in a thin local helper in this repo (do NOT
edit the vendored crate) using discriminator `[208,215,194,214,241,71,246,178]`; deferred because it
duplicates coverage V3 already proves and carries reverse-engineering risk without a recorded V2 fixture.

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
