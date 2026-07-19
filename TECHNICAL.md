# PulsePlay Markets — technical documentation

_TxODDS World Cup Hackathon · Track 1 (Prediction Markets & Settlement)_

**Live app:** https://pulseplay-markets.gershwin.dev
**Repo:** https://github.com/0xPulsePlay/pulseplay-markets
**TxLINE data layer:** https://txline-api.gershwin.dev
**Demo video:** [DEMO VIDEO LINK]

---

## Core idea

A prediction-market exchange where **one platform runs three market categories and every one of them
is settled trustlessly on TxLINE-anchored data — with no resolver, no committee, and no dispute
window.** When a market settles, our own Solana program (`pulseplay_escrow`) CPIs into the real TxLINE
oracle to check the exact match stat against the Merkle root TxLINE already anchored on-chain. **The
proof is the resolution:** if the proof is authentic and the predicate holds, the vault pays; a
tampered proof reverts the CPI, so a bad proof can never settle (fail-closed).

The three categories are deliberately chosen so the demo exercises **all three generations** of the
TxLINE validation instruction:

| Category | Example | On-chain instruction | Oracle CPI |
|---|---|---|---|
| **Outcomes** — single-claim | "England to score", "red card shown?" | `resolve_outcome` | **V1** `validate_stat` (one read-only PDA) |
| **Combos** — same-match multi-leg | England 1 ∧ Argentina 2 ∧ both booked | `resolve_combo` | **V2** `validate_stat_v2` (indexed strategy, one CPI settles the whole ticket) |
| **Batch** — mega-tickets & derived | corner difference (home − away) | `resolve_ticket` | **V3** `validate_stat_v3` (shared multiproof, one CPI) |

Two ideas fall out of anchoring on TxLINE data:

- **Fair prices are free data.** TxLINE publishes a *de-margined* `Pct` per price name. That is the
  true probability with the book's margin already removed — so the storefront shows the fair-vs-book
  gap on every market, and the compounding parlay "margin tax" (three legs at ~6% → the bettor keeps
  ~84% of fair) is quantified straight from the feed rather than asserted.
- **Sentinel-zero.** A value of `0` is a *provable* statement, not an absence you wait on. "No red
  card" settles the NO side cryptographically (`key==0`, `EqualTo`) — so occurrence markets resolve
  **both** sides with the same proof mechanism.

---

## Repository layout (pnpm monorepo)

```
onchain/          Anchor workspace: pulseplay_escrow program (V1/V2/V3 settlement + cancel/refund),
                  the vendored txoracle-cpi crate, and a settlement suite (15 checks) run against the
                  REAL mainnet oracle cloned into a local validator.
packages/pricing/ De-margined probabilities · LMSR seeded at the fair prior · parlay fair-vs-book
                  "margin tax" · Gaussian-copula correlation. 15 unit tests.
apps/keeper/      Express API (:4190): TxLINE ingestion, pricing, on-chain settlement, proof receipts,
                  wallet-signed ticket building. 34 hermetic engine tests + a 4-test receipt suite.
apps/web/         Vite + React storefront (:4100): three categories, ticket builder, wallet connect,
                  cinematic tick-by-tick replay, and the proof-receipt view.
docs/             BUILD-STATUS.md (acceptance criteria), TXLINE-INTEGRATION.md (endpoints + feedback),
                  DEMO-PLAN.md, screenshots/.
```

---

## Technical highlights

### 1. Pricing (`packages/pricing`)

- **De-margined probability** (`probability.ts`): parses TxLINE's `Pct` (which arrives as `string[]`
  on raw ticks, `number` on downsampled series) and normalizes it. We never re-derive the true
  probability from raw prices — TxLINE already did, and that de-margined value is the headline edge.
- **LMSR seeded at the prior** (`lmsr.ts`): Hanson's Logarithmic Market Scoring Rule with the pool
  *opened at the TxLINE de-margined prior* (`q_i = b·ln(π_i) ⇒ p_i = π_i` exactly), which minimizes
  expected bleed. Hard worst-case loss bound `b·ln(n)`.
- **Parlay "margin tax"** (`parlay.ts`): parlay payouts multiply, so book margin compounds
  geometrically (`∏ 1/(1+m_i) ≈ (1+m)^{−n}`). We quantify exactly how much fair value a book skims.
- **Correlation, honestly** (`correlation.ts`): same-match legs are not independent, so the joint is
  estimated with a Gaussian copula `p_{12} = Φ_ρ(Φ⁻¹(p_1), Φ⁻¹(p_2))` (Acklam inverse-normal, error
  < 1.15e-9) rather than a naive product.

### 2. Keeper (`apps/keeper`)

An Express API on `:4190` that is the seam between TxLINE and the chain:

- **Ingestion + replay** (`engine.ts`): pulls fixtures, per-fixture state samples, and odds series
  from the TxLINE engine via `@txline/client-sdk`, then builds cinematic replay keyframes — real
  match clock + real score at each sample, four labeled odds series, and shaded match-phase bands
  (pre-match / 1st half / HT / 2nd half / stoppage / full time) derived from the fixture's real phase
  timeline. The keyframe assembler is a pure function driven by recorded fixture-shaped data in the
  34 hermetic unit tests (no network in the tests themselves).
- **Catalog + pricing** (`catalog.ts`): materializes the three-category catalog for any fixture,
  priced off the de-margined `Pct`. Only the demo fixture is `settleable` (recorded proofs exist only
  for it); every other fixture prices for real but is honestly labeled priced-only.
- **Settlement orchestration** (`chain.ts`): runs the real `create_market → deposit → deposit →
  resolve → claim` lifecycle on-chain and returns it as an ordered, human-readable list of five real
  transaction signatures. Also **builds but never signs** wallet transactions — it returns an
  unsigned base64 `VersionedTransaction` with `feePayer = wallet` for the browser to sign with Phantom
  and submit itself.

### 3. On-chain program (`onchain/programs/pulseplay-escrow`)

- **Escrow custody is a classic SPL-token vault**: each market's vault is an Associated Token Account
  owned by the *market PDA itself* (the market signs for its own payouts — no separate vault PDA). A
  market is bound to its mint at `create_market`, and every later instruction re-checks the passed
  mint (`WrongMint` on mismatch) so a bogus mint can't redirect state. Wagering is in an SPL token
  (devnet: a labeled "USDC (Devnet Test)" mint) or SOL — **never** the TxL credit token.
- **Three resolve paths, one guarantee**:
  - `resolve_outcome` → CPI `validate_stat` (V1). Binds the proof to the market's fixture + stat, then
    the predicate (`threshold`, `comparison`) comes from the *market*, not the caller.
  - `resolve_combo` → CPI `validate_stat_v2` (V2). Indexed strategy: every proven stat is covered
    exactly once by a `Single EqualTo`-its-value predicate; one CPI settles the whole same-match
    ticket. (`validate_stat_v2` ships as a thin local adapter — the vendored crate had V1 + V3 only;
    per the SDK's own docstring, V2 = V3 minus the multiproof.)
  - `resolve_ticket` → CPI `validate_stat_v3` (V3). One shared multiproof verifies every leg —
    including value-0 absence legs — in a single CPI; supports derived binary markets (Add/Subtract,
    e.g. corner difference).
- **Fail-closed**: a malformed or tampered proof makes the oracle CPI revert, so state never changes
  on a bad proof. The escrow suite proves this directly — flip one byte of a Merkle path and the
  transaction reverts, market stays unresolved (checks P2.4, P2.5b, P2.7).
- **Timeout path**: `cancel` / `refund` — anyone can cancel a still-unresolved market past its
  `resolve_deadline`, and every depositor reclaims their exact stake.

### 4. Proof receipt / verification (`chain.ts` `buildReceipt`)

Every settled market opens a plain-language, four-step receipt:

1. **The stat leaf** — the single fact ("home full-match goals = 1") hashed into one Merkle leaf.
2. **The fixture's event-stats subtree** — sibling hashes fold upward, proving the stat belongs to
   *this* match, untouched.
3. **The day's anchored root** — the subtree folds into the root of every stat TxLINE recorded that
   epoch day, reconstructed client-side from the proof alone.
4. **The on-chain match** — that reconstructed root is compared to the root Solana actually stores in
   the `daily_scores_roots` PDA.

The step-4 comparison is **self-sufficient**: the keeper reads the PDA directly over its own Solana
RPC connection (via `@txline/verify`'s `verifyScoresStatProofOnChain`) — it does not depend on any
service to grade its own proof. If the RPC read fails, the receipt shows an honest **"on-chain
verification unavailable"** state and asserts nothing, rather than fabricating a green check. On a
trust product a spurious "verified" is the worst possible bug, so absent a real on-chain root we
refuse to claim a match.

---

## TxLINE endpoints used

TxLINE data is the **primary live input** to the whole app: fixtures, the match clock and score used
by the replay, the de-margined odds every price is built from, and the Merkle proofs + anchored root
that settlement and the receipt depend on. Nothing is synthesized where TxLINE has the real value.

### Primary REST surface — via `@txline/client-sdk` against the TxLINE data layer

`ENGINE_URL` (default `http://localhost:3001`; deployed: `https://txline-api.gershwin.dev`).

| Endpoint | Used for | Called from |
|---|---|---|
| `GET /v1/fixtures?status=live\|upcoming\|played&limit=` | storefront fixtures, segmented live / upcoming / finished | `engine.ts` `segmentedFixtures()` |
| `GET /v1/fixtures/{id}` | match header (teams, final score) + the phase timeline the replay bands read | `engine.ts` `fixtureCard()`, `buildReplay()` |
| `GET /v1/fixtures/{id}/state?ts=` | **replay keyframes** — real match clock + score at each sample | `engine.ts` `buildReplay()` |
| `GET /v1/fixtures/{id}/odds?market=1X2_PARTICIPANT_RESULT` | **de-margined win-prob** series + fair 1X2 pricing | `engine.ts`, `catalog.ts` |
| `GET /v1/fixtures/{id}/odds?market=OVERUNDER_PARTICIPANT_GOALS&…` | de-margined fair price for goal markets (e.g. "to score") | `engine.ts`, `catalog.ts` |
| `GET /v1/corpus` | corpus-size / health banner | `@txline/client-sdk` |
| `GET /v1/validation/scores?fixtureId=&seq=&statKeys=&verify=1` | documented proof-validation surface (on-chain root, epoch day, PDA, verdict) | `@txline/client-sdk` |

### On-chain oracle (the settlement + receipt trust root)

- **CPI `validate_stat` (V1), `validate_stat_v2` (V2), `validate_stat_v3` (V3)** from
  `pulseplay_escrow` into the TxLINE oracle program.
- **`daily_scores_roots` PDA** — the single read-only account each CPI reads; the receipt reads the
  same PDA directly over Solana RPC to grade its reconstructed root.
- `@txline/verify` helpers `statLeaf()` / `describeStatKey()` / `verifyScoresStatProofOnChain()` build
  the leaf hashes and the on-chain verdict for the receipt.

### Devnet raw surface — direct against `https://txline-dev.txodds.com`

The local engine proxies only mainnet, so devnet proofs are fetched from the raw upstream REST
(`/api/*`, different shape than `/v1/*`), with both an `Authorization: Bearer <JWT>` and an
`X-Api-Token` header.

| Endpoint | Used for |
|---|---|
| `GET /api/scores/stat-validation?fixtureId=&seq=&statKey=` | **live V1 Merkle proof fetched at settle time** — Outcomes settle from a proof pulled live from devnet, not a recorded file (`chain.ts` `liveDevnetProof()`) |
| `GET /api/fixtures/snapshot?startEpochDay=` | devnet fixture discovery (`scripts/get-devnet-token.mjs`) |
| `GET /api/scores/snapshot/{fixtureId}` | full ordered score history for a fixture |

> V2/V3 live-devnet proofs are not yet confirmed (the raw devnet multi-stat/multiproof shape was not
> exercised this session), so Combos/Batch use recorded fixtures on devnet too — the same proven
> mechanism they use on localnet. See `BLOCKED.md` §5. Nothing is claimed that the code doesn't do.

---

## How resolution works, and why it is deterministic

1. A market fixes its predicate at creation: `(fixture_id, stat_key, period, threshold, comparison,
   combine_op, kind)`. The predicate lives on-chain, in the market account — the caller can never
   supply it.
2. To settle, anyone submits a TxLINE Merkle proof for the relevant stat(s). `resolve_*` binds the
   proof to the market's fixture and leg-0 stat, then CPIs the oracle.
3. The oracle recomputes the Merkle path from the proof and checks it against the root in the
   `daily_scores_roots` PDA. **If the recomputed root doesn't match the anchored root, the CPI
   reverts** — settlement cannot proceed. If it matches, the oracle returns the predicate's boolean.
4. The program writes `market.outcome = <returned bool>`, `resolved = true`, and winners claim
   pro-rata.

It is deterministic because the outcome is a **pure function of (the market's fixed predicate, the
TxLINE-anchored Merkle root)** — both of which are on-chain and immutable. There is no admin key that
can set an outcome, no vote, no timing window in which a human decides. Two people running the same
proof against the same anchored root get the same result, byte for byte. The `resolve_*` instructions
are permissionless and retriable precisely because the proof — not the caller — is the authority.

---

## Trust & safety

Local validator + devnet only. **No code path signs or submits a mainnet transaction or spends real
funds.** On-chain reads and CPIs go to the TxLINE oracle (the mainnet program and its anchored PDA are
*cloned* into the local validator, so verification is against the real anchored root; devnet V1 runs
against the live devnet oracle). Money is a simulated SPL test token, labeled `SIMULATED MONEY` and
`USDC · devnet/local test token` on every balance and vault surface — never real USDC, never the TxL
credit token (data-authorization only).

**Reference addresses**

- Escrow program: `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` (same id on localnet **and** devnet)
- Mainnet TxLINE oracle (cloned into localnet): `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`
- `daily_scores_roots` PDA (cloned into localnet): `6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE`
- Devnet TxLINE oracle: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Devnet "USDC (Devnet Test)" mint: `BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171`
- Demo fixture: `18241006` (England 1–2 Argentina, semifinal)

---

## Run it locally

Prerequisites: the TxLINE engine reachable at `ENGINE_URL` (default `http://localhost:3001`,
`curl .../health → {"ok":true}`), plus `solana`, `anchor`, `pnpm`.

```bash
pnpm install

# 1. Local validator cloning the REAL TxLINE oracle + the anchored daily-scores PDA
cd onchain
solana-test-validator --reset --quiet --ledger test-ledger \
  --rpc-port 8999 --faucet-port 9902 --gossip-port 8790 --dynamic-port-range 9020-9120 \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA \
  --clone 6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE &
solana airdrop 60 --url http://127.0.0.1:8999
anchor build
solana program deploy target/deploy/pulseplay_escrow.so \
  --program-id target/deploy/pulseplay_escrow-keypair.json --url http://127.0.0.1:8999

# 2. Prove settlement on-chain (15 checks against the real cloned oracle)
ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts

# 3. Unit tests: pricing (15) + keeper engine (34)
cd .. && pnpm --filter @pulseplay/pricing test && pnpm --filter @pulseplay/keeper test

# 4. Keeper API (:4190) + storefront (:4100)
pnpm --filter @pulseplay/keeper start        # http://localhost:4190/api/health
pnpm --filter @pulseplay/web dev             # http://localhost:4100
```

Run against devnet instead with `CLUSTER=devnet` (see `STATUS-FOR-MIKAIL.md` → "Run it"); on devnet,
Outcomes (V1) settle from a Merkle proof fetched **live** from `txline-dev.txodds.com` at the moment
you click Settle.

**More detail:** `docs/TXLINE-INTEGRATION.md` (endpoints + our API feedback), `docs/BUILD-STATUS.md`
(full acceptance criteria), `docs/DEMO-PLAN.md` (beat-by-beat demo), `BLOCKED.md` (what is honestly
still open).
