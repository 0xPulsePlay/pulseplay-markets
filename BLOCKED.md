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
on-chain evidence in ~1 minute. The pricing tests do not require the local validator. (Round-3 note: the
proof-receipt's step-4 match now reads the `daily_scores_roots` PDA **directly over the keeper's Solana
RPC connection**, not via the engine — so it needs the validator/RPC reachable; if the read fails it
degrades to the honest "on-chain verification unavailable" state rather than a false verdict.)

## 4. V3 proofs are recorded fixtures, not live `/v1` (by design)
The local `/v1` surface does not serve V3 multiproofs (engine brief §7.4/§11). The V3 combo + batch demos
use the recorded fixtures in `onchain/fixtures/` (copied read-only from the verify package) against the
local validator. This matches the reference pattern and is the intended approach, not a gap.

## 5. V2/V3 live devnet resolve — not attempted (V1 only, by timebox choice)
**State:** `chain.ts`'s `settleMarket()`/`resolveWalletMarket()` only try a live devnet proof fetch for
V1 (Outcomes) markets; V2 (Combos) and V3 (Batch) always use the recorded localnet fixtures, even when
`CLUSTER=devnet`.
**Why:** getting V1 working live against `txline-dev.txodds.com` (§1 above) was the timeboxed win —
`GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` returns the V1 singular shape cleanly. The
raw devnet API's PLURAL multi-stat shape (`statKeys=1,2,3` — what V2's indexed strategy needs) and
whether it serves V3 multiproofs at all were never queried this session; extending live-devnet beyond
V1 needs that exploration first, and there wasn't a clear time budget left to also chase V2/V3's likely
different response shapes and fail-closed edge cases.
**Impact:** none on the proof of record — the recorded-fixture path is the SAME proven mechanism V2/V3
already use on localnet, and it's what runs when live devnet doesn't apply.
**To unblock:** hit `GET /api/scores/stat-validation?fixtureId=18241006&seq=960&statKey=1&statKey2=2&statKey3=3`
against `txline-dev.txodds.com` (same headers as `get-devnet-token.mjs` uses) and see whether the
response shape matches the recorded `scores-proof-v2-18241006-keys1-2-3.json` fixture's plural
`statsToProve[]`/`statProofs[]` shape closely enough to feed `chain.ts`'s existing `comboArgs()`/
`ticketArgs()` mappers directly.

## 6. One connected wallet can hold only one open market per (statKey, period) — RESOLVED with a
## deliberate product-layer guard, not an on-chain fix
**Was found:** the on-chain `market` PDA is seeded only by `(authority, fixtureId, statKey, period)` —
not the predicate (comparison/threshold/combineOp/kind). Several catalog entries deliberately share a
(statKey, period) with a DIFFERENT predicate (e.g. "England to score" `>0` and "England exactly 1 goal"
`==1` are both statKey=1/period=5). `settleMarket()`'s demo-settle flow never collides (a fresh random
`Keypair` is the authority every call), but a connected WALLET is the same authority across every
market IT bets on — so two catalog entries sharing (statKey, period) would silently resolve to the same
on-chain account for that wallet.
**Resolved (product layer):** `marketMatchesCatalogEntry()` in `chain.ts` compares the on-chain
market's actual predicate fields against the requested catalog entry before treating a PDA hit as "this
wallet's ticket for THIS market" — `walletMarketStatus()` returns `exists:false` on a mismatch (no
phantom ticket shown in "Your tickets"), and `buildDepositTransaction()` throws a clear error instead of
silently depositing into the wrong market's vault.
**Deliberately NOT fixed on-chain:** widening the PDA seeds to include the predicate would need
`pulseplay_escrow` rebuilt and re-verified end-to-end on BOTH localnet and devnet this late in the
session — assessed as the wrong risk/reward this close to the deadline given the guard achieves the
same user-facing correctness (never silently corrupts state, always errors clearly) without touching
the already-proven, already-redeployed program. A same-wallet, same-(statKey,period) multi-market UX
(e.g. auto-suffixing a client-only PDA-derivation salt into a distinct `authority` derived from the
wallet) would be the next step if this needs lifting later — full detail in `docs/BUILD-STATUS.md`
Phase 3.4.
