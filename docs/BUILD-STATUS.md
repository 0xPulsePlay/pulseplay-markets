# PulsePlay Markets — Build Status

Compaction-proof memory + orchestrator window. Acceptance criteria authored up front; never weakened.
PASS = watched it work. PENDING = not yet. BLOCKED = see `BLOCKED.md`.

_Last updated: 2026-07-18 — **ALL 5 PHASES GREEN.** Escrow **12/12** (V1+V2+V3 all settle on-chain) ·
pricing 15/15 · e2e 0 errors. Only devnet deploy (P2.8) is parked (faucet dry — see BLOCKED.md);
localnet is the proof of record. Every cut-line item landed, including the V3 batch stretch._

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
- [x] P1.1 pnpm monorepo resolves (apps/web, apps/keeper, packages/pricing, onchain)  **PASS**
- [x] P1.2 `@txline/client-sdk` + `@txline/verify` installed from vendored tarballs  **PASS**
- [x] P1.3 engine client wired; keeper serves `/api/fixtures` (0 live / 8 upcoming / 109 finished)  **PASS**
- [ ] P1.4 fixtures segmented list RENDERS in the web UI (Phase 4)  PENDING

## Phase 2 — Anchor escrow program `pulseplay_escrow`
- [x] P2.1 program builds (`anchor build`) — 7 instructions, id 2YbfXEyo…jvGin  **PASS**
- [x] P2.2 local-validator suite green: V1 YES payout + claim  **PASS**
- [x] P2.3 V1 NO payout — sentinel-zero "no red card" resolves NO-side cryptographically  **PASS**
- [x] P2.4 tampered-proof revert (fail-closed) — market stays unresolved  **PASS**
- [x] P2.5 V2 Combo (validate_stat_v2 indexed strategy) settles a 3-leg ticket in ONE CPI + V3 multi-leg batch (4 legs, one CPI)  **PASS**
- [x] P2.6 derived binary market (corner difference) settles in one CPI  **PASS**
- [x] P2.7 cancel/timeout + refund path tested (both sides made whole)  **PASS**
- [~] P2.8 deploy to devnet — **BLOCKED** (faucet dry, wallet 0 SOL); localnet-only is the proof of record per engine brief. See BLOCKED.md §1.

_Evidence: `ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts` → "ALL
PULSEPLAY ESCROW TESTS PASSED (10 checks)". Validator clones real oracle 9Exb… + PDA 6d9bJ2Et…._

## Phase 3 — Pricing package + keeper
- [x] P3.1 de-margined probabilities from engine odds (`Pct` field, no recompute)  **PASS** (15/15 tests)
- [x] P3.2 LMSR quoting seeded at fair prior (b=300); bounded-loss table  **PASS**
- [x] P3.3 parlay fair-vs-book comparison (∏ 1/(1+m); 3 legs @6% → 84.0%)  **PASS**
- [x] P3.4 keeper: /api/settle runs create→deposit→resolve→claim on-chain + writes proof receipt  **PASS**

_Evidence: keeper on :4190 — /api/health {engine:true, chain:true}; /api/settle/eng-score → YES with
receipt root match (computed == on-chain 0x8213ec7f…); /api/parlay 3-leg @6% → fair $673 vs book $565
(84.0% ratio). Replay: 35 keyframes, clock 00:00→99:40, score+win-prob in sync._

## Phase 4 — Storefront UI (showpiece)  — Vite + React (see note on Next.js deviation)
- [x] P4.1 PulsePlay palette (Ultraviolet Rolling Signal) applied — tokens loaded, hard rules honored  **PASS**
- [x] P4.2 three-category storefront (Outcomes/Combos/Batch tabs, real fair-vs-book pricing)  **PASS**
- [x] P4.3 ticket builder with live fair pricing (parlay fair-vs-book, correlation-adjusted)  **PASS**
- [x] P4.4 PROOF RECEIPT view (leaf → subtree → daily root → PDA, real hashes, plain language)  **PASS**
- [x] P4.5 devnet/localnet + simulated-money badges everywhere  **PASS**
- [x] P4.6 simulated-live replay (cinematic 1×/4×/12×, match-clock, score + win-prob in sync)  **PASS**

## Phase 5 — End-to-end verification
- [x] P5.1 Playwright headless journey: browse → build ticket → replay → keeper settles ON-CHAIN → receipt  **PASS** (0 console errors)
- [x] P5.2 key states screenshotted into docs/screenshots/ (9 shots)  **PASS**
- [x] P1.4 fixtures segmented list renders in the UI  **PASS**

_Evidence: `node journey.mjs` — storefront (4 markets) → 2-leg ticket → combos/batch → replay to full
time → settle full-time markets on-chain (real txs) → proof receipt "Reconstructed root equals the
on-chain root". 0 console/page errors. Screenshots 01–09 in docs/screenshots/._

---

## Round-2 fixes (post independent-verification)
- [x] **V2 landed coherently** — Combos settle via a real `validate_stat_v2` CPI; program+keeper+catalog
  shipped together (running product matches the docs). Escrow suite re-confirmed **12/12**.  **PASS**
- [x] **Proof-receipt honesty** — never fabricate a green "EQUALS". Absent a real engine verdict (both
  roots), the receipt shows an **unverified/unavailable** state (warning), and a genuine mismatch shows
  red "would be rejected". Happy path still shows the real match.  **PASS**
- [x] **Mobile topbar overflow @390px** — no horizontal scroll (verified scrollWidth==clientWidth==390);
  badges wrap to their own row, TXLINE-settled hidden on mobile (reality labels kept).  **PASS**
- [x] **Removed topbar backdrop blur** (GUIDE §5 bans glass/blur) — `backdrop-filter: none` verified.  **PASS**
- [x] **Hero scoreline wraps cleanly** on narrow mobile; added `body { overflow-x: hidden }` safety.  **PASS**

_Evidence: mobile.mjs (390px, 0 errors, no overflow, blur none) + desktop journey (0 errors, receipt
green match preserved). Screenshots 10-mobile-storefront, 11-mobile-replay added._

## Cut-line (protect in this order if time compresses)
1. V1+V2 escrow settling e2e on localnet with tests  ← highest
2. Storefront with proof receipt on the replay
3. LMSR pricing
4. devnet deploy
5. V3 batch (stretch — the most impressive 30s if it lands)

## Notes / decisions
- **All three generations settle on-chain: Outcomes→V1, Combos→V2, Batch→V3** — the submission's core
  narrative ("keeper settles V1, V2, V3 in three transactions"). The vendored `txoracle-cpi` crate ships
  V1 + V3 helpers only, so `cpi_validate_stat_v2` is a thin LOCAL adapter in the program (V2 = V3 minus
  the shared multiproof; disc d0d7c2d6…, wire-format locked against the recorded golden fixture). V2
  consumes the LIVE `/v1` multi-stat proof (each leg carries its own membership path) — no recorded
  fixture needed. Combo capped at 3 legs by Anchor's JS coder 1000-byte instruction buffer (SDK limit).
- Program keypair (stable): `onchain/programs/pulseplay-escrow/pulseplay_escrow-keypair.json`
  → program id `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin`.
- V3 proofs are NOT served by local `/v1`; the V3 settlement demo uses recorded fixtures in
  `onchain/fixtures/` + local validator (per engine brief §7.4 / §11).

---

# Night 2 — devnet + USDC + demo-navigability (2026-07-19)

Mikail's hands-on review of `d064b84` found the build technically correct but not demo-navigable.
Brief: devnet deploy, a real devnet USDC-like SPL token for escrow, a real fixture picker, wallet
connect + on-chain ticket submission, a richer replay chart, and a judge-ready demo script.
Acceptance criteria authored up front (2026-07-19 08:5x UTC) — PASS/PENDING table below, never weakened.

_Branch note (this worktree, `worktree-agent-a07b1191953fcbb5f`): branched off `main` at `d064b84`,
**before** Phase 0/1 (devnet deploy, SPL-token escrow) landed on the sibling worktree
(`worktree-agent-a7f8aedd349925f2f`) and before this Night-2 section was authored there. This worktree
was scoped ONLY to **Phase 4 — replay chart overhaul** (see task boundaries) and does not contain
Phase 0/1/2/3/5 work — those checkboxes below are carried over unweakened from the sibling worktree's
authored criteria for completeness, but reflect ITS state, not this branch's. Phase 4 is this branch's
own verified work, marked below with this worktree's own evidence. Reconciling both worktrees onto a
single `main` is an orchestration step outside this session's scope._

## Acceptance criteria

**Phase 0 — devnet baseline** — see sibling worktree `worktree-agent-a7f8aedd349925f2f` (not in this branch)

**Phase 1 — USDC devnet wagering token** — see sibling worktree `worktree-agent-a7f8aedd349925f2f` (not in this branch)

**Phase 2 — fixture picker / navigation** — owned by a concurrent sibling agent, not this worktree
- [ ] P2.1 `GET /api/catalog` (+ replay) accepts `fixtureId` query param, defaults preserved
- [ ] P2.2 fixtures list is genuinely clickable — picking a fixture scopes the storefront to it
- [ ] P2.3 flag coverage noted (lower priority; extend only if time allows)
- [ ] P2.4 copy/clarity pass on Storefront + MarketCard — plain-language one-liner per category

**Phase 3 — wallet connect + real ticket submission + visible settlement** — not this worktree
- [ ] P3.1 Phantom wallet-connect (`window.phantom.solana`), `@solana/web3.js` + SPL token client deps added to web
- [ ] P3.2 TicketBuilder gets a real terminal action: connected wallet signs+submits a client-side deposit tx into the market vault, cluster-aware, shows confirmed signature
- [ ] P3.3 "Fund my wallet" faucet action (devnet SOL for gas + devnet USDC for stakes)
- [ ] P3.4 settlement visualization: vault YES/NO balances, wallet balance before/after, step-by-step CPI lifecycle indicator, every signature a real explorer link

**Phase 4 — replay chart overhaul** — **this worktree's work, DONE, all green**
- [x] P4.1 `buildReplay()` pulls odds ticks for markets actually relevant to the catalog, not just 1X2  **PASS**
- [x] P4.2 each market its own labeled line/series with a legend  **PASS**
- [x] P4.3 visual HT/2H/ET/stoppage bands + separated pre-match segment  **PASS**
- [x] P4.4 no regression on cinematic continuous rendering at fast-forward (explicitly tested)  **PASS**

_Evidence (apps/keeper/src/engine.ts, apps/keeper/test/engine.test.ts, apps/web/src/views/ReplayTheater.tsx):_
- _P4.1: `buildReplay()` now pulls `1X2_PARTICIPANT_RESULT` (win-prob) + `OVERUNDER_PARTICIPANT_GOALS`
  over/line=0.5 (the exact line `catalog.ts`'s "England to score" reuses). Verified via
  `GET /v1/fixtures/18241006/markets` that these are the ONLY two markets with real ticks the catalog
  actually prices off for this fixture (BOTH_TEAMS_TO_SCORE / DOUBLE_CHANCE / HANDICAP_RESULT /
  CORRECT_SCORE / OVERUNDER_PARTICIPANT_CORNERS / ASIAN_HANDICAP all returned 0 series rows) — nothing
  fabricated for markets with zero ticks; `eng-exact-1`/`red-card` stay deliberately unplotted (they're
  "modeled" pricing, not live series, in the catalog itself)._
- _P4.2: `ReplayData.seriesDefs` (4 entries: England win / Draw / Argentina win / Over 0.5 match goals)
  each render as their own labeled `<path>` + legend chip with a live % readout, using the existing
  PulsePlay graph palette (`--pp-graph-*` tokens). Verified live via `/api/fixtures/18241006/replay` and
  Playwright screenshot (legend text: "ENGLAND WIN 0% · DRAW 3% · ARGENTINA WIN 96% · OVER 0.5 MATCH
  GOALS 52%" at full time)._
- _P4.3: `buildPhaseBands()` derives Pre-match/1st Half/Half-time/2nd Half/Stoppage/Full-Time bands
  straight from the fixture's real `timeline.phases` wall-clock boundaries (not from keyframe survival,
  which stays robust under dedup). Live-verified bands for fixture 18241006: pre-match 0→5%, H1 5→35%,
  stoppage 35→37%, HT 37→47%, H2 47→77%, stoppage 77→87%, full-time 87→100% — H1 stoppage (~2:53) and H2
  stoppage (~11:11, since this match ran deep into added time) render as distinctly different widths, as
  they should. Pre-match renders as a dashed, muted lead-in (bridged into the solid live line at
  kickoff) — "label reality everywhere": it visually reads as "not live yet," not fabricated data._
- _P4.4: Playwright-verified at 12× — screenshots at ~21/43/65/86/100% progress during a live 12× run
  all show crisp, fully-legible 4-series lines with no compression/mush; progress advances linearly
  (~500ms per ~21% step, matching BASE_MS=30000/12=2500ms total), confirming the RAF/interpolate() path
  is unchanged and the match-clock display stays honest through stoppage ("100:25 · Stoppage" shown
  mid-run). 0 console/page errors across the full journey (load → scrub 0/50/100% → 12× playback →
  full-time). Also verified no mobile horizontal overflow at 390px with the new 4-item legend
  (scrollWidth === clientWidth === 390)._
- _Unit tests: 37/37 green (`pnpm --filter @pulseplay/keeper test`) — `computeMatchPhase`,
  `buildPhaseBands`, `makeTMap`, `build1x2Series`, `buildLineSeries`, `nearestValue`, and
  `assembleKeyframes` (the network-free multi-series + phase composition seam), all driven by
  fixture-18241006-shaped recorded data (real timeline.phases + real clock/statusLabel readings pulled
  live during development). Two real live-data bugs were found and fixed while runtime-verifying against
  the actual engine (not caught by the hand-authored hermetic fixtures, since those fixtures were
  necessarily "idealized"): (1) the engine's nearest-seq-to-ts state lookup sometimes lands on a
  non-match-state administrative tick (statusLabel `"?"`, clock sometimes entirely absent) even
  mid-match — was rendering as a fabricated "stoppage" blip and a momentary 00:00 clock reset;
  `computeMatchPhase()` now takes a `fallback` param and `assembleKeyframes()` carries forward the last
  known phase/clock instead. (2) the very last sample, queried exactly at the FINAL phase's `wallEnd`,
  lands on a bare stream "disconnected" marker one ms after the real FINAL state — fixed by querying
  `endTs - 1` for that one sample while still recording it at the true `endTs` so `t` stays exactly 1.
  Both are logged with root cause + fix in `docs/TXLINE-INTEGRATION.md`'s API-feedback list._

**Phase 5 — demo script + docs** — not this worktree
- [ ] P5.1 `docs/DEMO-PLAN.md` — beat-by-beat ≤5min walkthrough with a fallback per beat
- [ ] P5.2 `STATUS-FOR-MIKAIL.md` + `docs/BUILD-STATUS.md` reflect actual final state
- [ ] P5.3 final `BLOCKED.md` pass, honest and matching existing rigor

## PASS/PENDING table (Night 2)
_Phase 4 is fully green in this worktree (`worktree-agent-a07b1191953fcbb5f`), evidence above. Phases
0/1/2/3/5 are scoped to other worktrees/sessions — see the branch note above._
