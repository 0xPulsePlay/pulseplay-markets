# PulsePlay Markets — Build Status

Compaction-proof memory + orchestrator window. Acceptance criteria authored up front; never weakened.
PASS = watched it work. PENDING = not yet. BLOCKED = see `BLOCKED.md`.

_Last updated: 2026-07-18 (Phase 2 GREEN on localnet — 10/10 settlement checks pass)_

## The product in one line
One platform, three market categories, all settled trustlessly on TxLINE-anchored data:
**Outcomes** (single stat, V1 `validate_stat`) · **Combos** (same-match multi-leg, V3 multiproof, one CPI) ·
**Batch** (mega-tickets / derived markets, V3 multiproof). Sentinel-zero lets occurrence markets ("no red
card") settle the NO side cryptographically.

## Ports
- Web (Next.js): **4100**
- Keeper/API: **4190**
- Engine (external, already running): http://localhost:3001

---

## Phase 1 — Scaffold + data spine
- [ ] P1.1 pnpm monorepo resolves (apps/web, apps/keeper, packages/pricing, onchain)
- [ ] P1.2 `@txline/client-sdk` + `@txline/verify` installed from vendored tarballs
- [ ] P1.3 engine client wired; `/v1/fixtures` + `/v1/corpus` reachable from app code
- [ ] P1.4 fixtures segmented live / upcoming / finished; list renders (styling can come later)

## Phase 2 — Anchor escrow program `pulseplay_escrow`
- [x] P2.1 program builds (`anchor build`) — 7 instructions, id 2YbfXEyo…jvGin  **PASS**
- [x] P2.2 local-validator suite green: V1 YES payout + claim  **PASS**
- [x] P2.3 V1 NO payout — sentinel-zero "no red card" resolves NO-side cryptographically  **PASS**
- [x] P2.4 tampered-proof revert (fail-closed) — market stays unresolved  **PASS**
- [x] P2.5 V3 multi-leg batch settles 4 legs in ONE CPI  **PASS**
- [x] P2.6 derived binary market (corner difference) settles in one CPI  **PASS**
- [x] P2.7 cancel/timeout + refund path tested (both sides made whole)  **PASS**
- [ ] P2.8 deploy to devnet if wallet funded; else localnet-only + BLOCKED entry  PENDING

_Evidence: `ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts` → "ALL
PULSEPLAY ESCROW TESTS PASSED (10 checks)". Validator clones real oracle 9Exb… + PDA 6d9bJ2Et…._

## Phase 3 — Pricing package + keeper
- [ ] P3.1 de-margined probabilities from engine odds (`Pct` field, no recompute)
- [ ] P3.2 LMSR quoting seeded at fair prior (b=300); bounded-loss table
- [ ] P3.3 parlay fair-vs-book comparison (∏ 1/(1+m) math)
- [ ] P3.4 keeper loop: watch fixture stream → on game_finalised fetch validation payloads → settle → receipt record

## Phase 4 — Storefront UI (showpiece)
- [ ] P4.1 PulsePlay palette (Ultraviolet Rolling Signal) applied
- [ ] P4.2 three-category storefront
- [ ] P4.3 ticket builder with live fair pricing
- [ ] P4.4 PROOF RECEIPT view (leaf → subtree → daily root → on-chain PDA, plain language)
- [ ] P4.5 devnet / simulated-money badges everywhere
- [ ] P4.6 simulated-live replay mode (cinematic, match-clock, score in sync)

## Phase 5 — End-to-end verification
- [ ] P5.1 Playwright headless journey: browse → build ticket → deposit → replay → keeper settles → receipt
- [ ] P5.2 key states screenshotted into docs/screenshots/

---

## Cut-line (protect in this order if time compresses)
1. V1+V2 escrow settling e2e on localnet with tests  ← highest
2. Storefront with proof receipt on the replay
3. LMSR pricing
4. devnet deploy
5. V3 batch (stretch — the most impressive 30s if it lands)

## Notes / decisions
- CPI crate + verify SDK ship **V1 + V3** helpers only (no V2 helper). The three product categories map:
  Outcomes→V1, Combos→V3 full-coverage (one CPI covers every requested stat exactly once = the "indexed"
  semantics a same-match ticket needs), Batch→V3 multiproof/derived. V2-helper gap logged in BLOCKED.md.
- Program keypair (stable): `onchain/programs/pulseplay-escrow/pulseplay_escrow-keypair.json`
  → program id `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin`.
- V3 proofs are NOT served by local `/v1`; the V3 settlement demo uses recorded fixtures in
  `onchain/fixtures/` + local validator (per engine brief §7.4 / §11).
