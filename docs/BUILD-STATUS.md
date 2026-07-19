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

## Acceptance criteria

**Phase 0 — devnet baseline (timeboxed ~45-60min)** — **DONE in ~22min, all green, plus a bonus find**
- [x] P0.1 `apps/keeper/scripts/get-devnet-token.mjs` (moved from the brief's example `onchain/scripts/`
  path — bare ESM imports need to resolve against a workspace member's node_modules; documented in the
  file header) dry-runs the subscribe→activate flow against devnet; real run only after a clean dry-run  **PASS**
- [x] P0.2 Outcome: **SUCCEEDED** — devnet apiToken obtained (`apps/keeper/.cache/devnet-token.json`,
  gitignored), subscribe tx confirmed on-chain, 0-cost free tier. **Bonus:** fixture 18241006 (the demo
  semifinal) is live on devnet with matching data — pulled a real V1 proof, saved at
  `onchain/fixtures/devnet/devnet-scores-proof-18241006-seq875-key1.json`. Full writeup in
  `docs/TXLINE-INTEGRATION.md` → "Devnet" section.  **PASS**
- [x] P0.3 `anchor build -- --features devnet` succeeded; deployed to devnet at the STABLE program id
  `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` (authority = deploy wallet
  `5nBA87pXc63mM2i2uFfyMKa3uwRagg499xecGhpKjCyJ`) — note: `anchor build` auto-generates a FRESH
  `target/deploy/*-keypair.json` when `target/` doesn't exist yet (gitignored), so the first deploy
  attempt landed on the wrong ephemeral id (`7HdX8Xb…`); caught it, copied the canonical checked-in
  keypair (`programs/pulseplay-escrow/pulseplay_escrow-keypair.json`) into `target/deploy/` and
  redeployed correctly, then closed the stray program to reclaim rent. `[programs.devnet]` added to
  `onchain/Anchor.toml`.  **PASS**
- [x] P0.4 `apps/keeper/src/config.ts` rewritten: cluster/rpcUrl/programId/oracleProgram/
  dailyScoresRootsPda/walletKeypairPath all env-driven via a `CLUSTER_PRESETS` table (localnet preset
  values byte-identical to the old hardcoded defaults — verified no regression); `chain.ts` reads
  `CONFIG.walletKeypairPath` instead of a hardcoded `~/.config/solana/id.json`, and the
  `daily_scores_roots` PDA lookup is now a lazy function (was a module-level `new PublicKey("")` that
  would have crashed boot under the devnet preset, which has no single fixed PDA — devnet's PDA is
  per-epoch-day, computed at proof time, not fixed). Verified: `CLUSTER=devnet
  SOLANA_RPC_URL=https://api.devnet.solana.com` boots and `/api/health` → `chain:true, cluster:devnet,
  oracleProgram:6pW64gN1…`; localnet default re-verified unchanged (`chain:true, cluster:localnet`).  **PASS**

**Phase 1 — USDC devnet wagering token (branch `nightshift/usdc-escrow`, prove on localnet first)** — **DONE**
- [x] P1.1 devnet SPL token minted: classic Token program, 6 decimals, mint `BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171`,
  mint authority = deploy wallet. No on-chain Metaplex metadata (deliberately skipped to save time —
  Phantom will show it as an unnamed SPL balance; our own UI is the source of truth for the label). **PASS**
- [x] P1.2 `CONFIG.wagerMintLabel` = `"USDC · devnet test token"` (devnet) / `"USDC · local test token"`
  (localnet), threaded through `SettleResult`/receipt so every surface reading it labels correctly —
  full UI wiring happens in Phase 3 where the balances actually render. **PASS**
- [x] P1.3 `pulseplay_escrow` rewritten: vault is an ATA owned by the MARKET pda itself (no separate
  vault PDA/bump — simpler than the old design). `anchor-spl 1.1.2` added (matches the pinned
  `anchor-lang 1.1.2` — this repo's Anchor is a real post-1.0 release, not the familiar 0.3x line).
  `create_market`/`deposit`/`claim`/`refund` use `anchor_spl::token::transfer` CPIs. `Market` gains a
  fixed `mint` field re-checked (`address = market.mint @ WrongMint`) on every later instruction.
  Behavior identical otherwise. **PASS**
- [x] P1.4 `onchain/tests/pulseplay-escrow.ts` rewritten for the SPL vault — all 12 prior checks pass
  + 3 new (mint setup + 2 wrong-mint-rejection checks) = **15/15**. TDD: wrote the failing test first,
  watched it fail for real reasons (mint-authority mix-up, then a genuine `AccountNotInitialized`
  vs `WrongMint` ordering nuance — fixed by pre-creating the attacker's alternate-mint ATA so the
  `WrongMint` check is what actually fires), then fixed the code until green. **PASS**
- [x] P1.5 redeployed to devnet at the SAME stable program id. Verified in two tiers:
  (a) `apps/keeper/scripts/verify-devnet-escrow.mjs` — create_market → deposit (real devnet USDC-test
  token) → cancel → refund, fully on real devnet, 9/9 checks, real tx signatures.
  (b) **`apps/keeper/scripts/verify-devnet-live-resolve.mjs` — a full LIVE settlement**: fetches a REAL
  V1 proof straight from `txline-dev.txodds.com` for the real demo fixture (18241006) at settle time,
  runs `resolve_outcome` as a genuine `validate_stat` CPI against the live devnet TxLINE oracle, and
  claims — 8/8 checks, on-chain outcome matches the live proof. This was expected to be gated (see
  BLOCKED.md history) — it is NOT. Wired into the actual product too: `chain.ts`'s `settleMarket()`
  now tries a live devnet proof for V1 markets before falling back to the recorded fixture; verified
  end-to-end through the real keeper HTTP API (`CLUSTER=devnet … POST /api/settle/eng-score` → 200,
  real resolve tx, ~6s). V2/V3 stay on recorded fixtures on devnet too (not yet confirmed live). **PASS**
- [x] P1.6 `POST /api/faucet {wallet, tokens?, sol?}` — mints test USDC to any wallet's ATA (mint
  authority, no rate limit) + sends a little gas SOL as a direct transfer from the deploy wallet
  (sidesteps the public devnet airdrop's hard rate limit — confirmed 429s otherwise). Verified live. **PASS**
- [x] P1.7 keeper fully updated: `config.ts` gets a `wagerMint`/`mintAuthorityKeypairPath` cluster
  preset; `chain.ts`'s `settleMarket()` funds demo bettors via the SPL token, builds the new
  mint/vault/ATA account lists for every instruction, and uses a direct-transfer `fundGas()` instead
  of the rate-limited airdrop RPC when `CLUSTER=devnet`. `SettleResult` gained `potBaseUnits`/`mint`/
  `mintDecimals`/`mintLabel`/`vault` (replacing the SOL-only `potLamports`); the one web usage site
  (`ProofReceiptView.tsx`) updated to match. **PASS**
- [x] P1.8 merged — see "Branch note" below (main is checked out in the sibling worktree, so the
  actual `main` ref merge is a step for the parent session/Mikail; this worktree's own integration
  branch has it merged and is the state everything after Phase 1 builds on). **PASS**

_Branch note: `nightshift/usdc-escrow` branched off this worktree's own branch
(`worktree-agent-a7f8aedd349925f2f`), NOT off the repo's shared `main` — `main` is checked out in the
sibling parent-directory worktree (`/Users/mikail/Desktop/PulsePlay/pulseplay-markets`), and git
refuses to force-update a branch checked out in another worktree. `nightshift/usdc-escrow` was merged
back into `worktree-agent-a7f8aedd349925f2f` once Phase 1 was fully green; merging that into the
repo's real `main` is a one-command step from the parent checkout (`git merge
worktree-agent-a7f8aedd349925f2f`) — not run from here to avoid touching a directory this session
doesn't own._

**Phase 2 — fixture picker / navigation** — **DONE**
- [x] P2.1 `GET /api/catalog?fixtureId=` — omitted defaults to the demo fixture exactly as before
  (verified: default call and `?fixtureId=X` both return correct, distinct catalogs). `/api/catalog/:id`
  (already fixture-scoped) kept as-is; `/api/fixtures/:id/replay` was already `:id`-scoped, no change
  needed. `catalog.ts`'s `buildCatalog()` generalized to price ANY fixture with real de-margined odds
  (TxLINE stat keys 1/2/5/7/8 are the universal soccer schema, not demo-specific) — but `settleable` is
  only ever true for `CONFIG.demoFixtureId`, since the recorded Merkle proof fixtures only exist for
  that one match. Never claims a "Settle" action it can't back with a real proof. **PASS**
- [x] P2.2 fixtures list rows are real `<button>`s; clicking one calls `onSelectFixture`, which
  re-fetches the catalog for that fixture and re-renders the hero/markets/ticket around it (ticket +
  settlements cleared on switch — a stale settlement from fixture A must never show under fixture B).
  Non-demo fixtures get an honest "priced only · pick the demo semifinal to settle" banner instead of
  the Replay CTA. Verified in a real headless browser (Playwright): clicked "Jordan v Algeria", saw
  real de-margined prices + the priced-only banner + a confirmation toast; clicked back to "England v
  Argentina", the Replay CTA and settle flow returned. 0 console errors. Screenshots at
  `/tmp/p2-02-after-click.png` (this session's scratch dir, not committed).  **PASS**
- [x] P2.3 flag coverage extended (used spare time while the Phase 4 sub-agent ran): all 20 original
  `TEAM_CODES` entries now have real SVGs (added Italy, Belgium, Mexico, Senegal, Colombia, Japan,
  United States, Uruguay, New Zealand, India — previously coded but falling back to a monogram), plus
  10 new team codes + flags for teams that showed up repeatedly in the fixtures list (Austria,
  Switzerland, Poland, Canada, Qatar, Scotland, Australia, Saudi Arabia, Sweden, Denmark) — 30 real
  flags total. Verified visually (Playwright screenshot, 0 console errors). Remaining monogram
  fallbacks (Jordan, Algeria, Haiti, Liechtenstein, Gibraltar, Cape Verde, …) are lower-frequency
  teams — reads fine, left as-is.  **PASS**
- [x] P2.4 category tabs now show a genuine plain-language one-liner above the technical blurb (e.g.
  Outcomes: "One question, one answer — e.g. 'will they score?'"; Combos: "Bundle a few outcomes from
  the SAME match — all legs settle together, in one transaction."; Batch: "Bigger tickets, including
  calculated markets like a corner-count difference."). MarketCard's existing "How it settles"
  expandable plain-language note kept as-is (already good). **PASS**

**Phase 3 — wallet connect + real ticket submission + visible settlement**
- [x] P3.1 Phantom wallet-connect via `window.phantom.solana` (same detection pattern proven in the
  sibling `battlefield` project tonight — read for reference only, never modified), implemented in
  `apps/web/src/wallet/WalletContext.tsx` + `WalletWidget.tsx` (no `@solana/wallet-adapter` — one
  wallet, kept the dependency graph light). `@solana/web3.js` + `@solana/spl-token` added to
  `apps/web/package.json`. `/api/health` gained `rpcUrl`/`explorerCluster` so the client can build a
  `Connection` and real explorer links without hardcoding cluster assumptions. **PASS**
- [x] P3.2 TicketBuilder's "Submit ticket" button is real: for each leg, the KEEPER builds (but never
  signs) a `create_market`-if-needed + `deposit` transaction — `apps/keeper/src/chain.ts`
  `buildDepositTransaction()` — returned base64 for the CLIENT to sign with Phantom
  (`WalletContext.signAndSend()`) and submit itself. A connected wallet gets its OWN market instance
  (authority = the wallet's own pubkey, PDA derived accordingly) — deliberately separate from
  `settleMarket()`'s self-contained fake-bettor demo markets (different authority => different PDA,
  no collision); see the design note below. Verified twice: a raw-Node scratch script simulating
  Phantom (mint+deposit+2nd-deposit-skips-create, vault balance asserted on-chain), then a full
  Playwright browser run with a MOCKED Phantom provider bridged to a real Node ed25519 signer (the
  browser's own `VersionedTransaction.message` bytes signed for real, written into `tx.signatures[0]`)
  — connect → fund → pick a market → submit → real confirmed signature with a working explorer link,
  0 console errors. **PASS**
- [x] P3.3 `POST /api/faucet {wallet, tokens?, sol?}` (built in Phase 1, wired into the UI now): mints
  test USDC to the wallet's ATA (mint authority, no rate limit) + sends gas SOL as a direct transfer
  from a funded wallet (sidesteps the public devnet airdrop's hard rate limit). "Fund my wallet" button
  in the wallet panel; verified live. **PASS**
- [x] P3.4 settlement visualization — **DONE**, two halves:
  (a) **Demo settle step-by-step**: `SettleResult` gained a `steps: SettleStep[]` array (Create →
  Deposit YES → Deposit NO → Resolve [the oracle CPI] → Claim), each with a plain-language description
  and its own real tx signature/explorer link, plus `liveProof: boolean`. `ReplayTheater.tsx`'s
  `SettlementSteps` renders this as an expandable per-market timeline (collapsed by default — headline
  stays "vault 3.00 USDC → 0", expands to the full 5-step CPI lifecycle) instead of one opaque tx link.
  (b) **Wallet-connected resolve + claim**: new `chain.ts` `resolveWalletMarket()` resolves a connected
  wallet's OWN market (from Phase 3.2's ticket submission) — permissionless on-chain (no signer beyond
  the fee payer; the proof is the authority), so the keeper pays gas. `POST
  /api/wallet/:wallet/market/:marketId/resolve`. Claiming still needs the wallet's own signature
  (`buildClaimTransaction`, already built). `ReplayTheater.tsx`'s new `WalletSettlementPanel` ("Your
  tickets") shows each of the wallet's own markets with Resolve → Claim buttons, live vault balance,
  and the wallet's own topbar balance visibly changing after claim.
  **Real bug found + fixed while verifying (b), not caught by earlier standalone tests**: the on-chain
  `market` PDA is seeded only by `(authority, fixtureId, statKey, period)` — NOT
  comparison/threshold/combineOp/kind. Several catalog entries deliberately share a (statKey, period)
  with a different predicate (e.g. "England to score" and "England exactly 1 goal" are both
  statKey=1/period=5). `settleMarket()`'s demo flow never collided (fresh random authority per call),
  but a single connected WALLET is the SAME authority across every catalog entry it bets on — so two
  different catalog markets could silently resolve to the same on-chain account. Fixed with
  `marketMatchesCatalogEntry()`: `walletMarketStatus()` now only reports `exists:true` when the
  on-chain predicate actually matches the requested catalog entry (so "Your tickets" never shows a
  phantom ticket for an entry you never bet on), and `buildDepositTransaction()` throws a clear error
  instead of silently depositing into a mismatched market. Deliberately NOT fixed by changing the
  on-chain PDA seeds (would need a program rebuild + full re-verification across localnet AND devnet
  this late in the session) — a defensive product-layer guard is the safer call given the time budget;
  documented here rather than silently working around it.
  Verified end-to-end (Playwright, mocked-Phantom-bridged-to-a-real-Node-signer, same pattern as
  Phase 3.2): connect → fund → submit "England to score" → fast-forward to full time → "Your tickets"
  shows exactly that one market (collision guard confirmed working) → Resolve (permissionless,
  confirmed real tx) → Claim (real wallet-signed tx) → topbar balance updates, panel shows "resolved
  YES · vault 100.00 USDC · claimed" with a working explorer link, toast confirmation. 0 console errors.
  Also verified the demo step-by-step timeline separately (12× fast-forward → Settle full-time markets
  → expand → all 5 steps with distinct real tx links visible). **PASS**

_Design note: a connected wallet's ticket creates its OWN market instance, not the one
`settleMarket()`'s "Settle full-time markets" button uses. Both are real, honest, on-chain — they're
just two different (by design) market PDAs for the same catalog entry, since `create_market`'s PDA is
seeded by `authority`, and the demo-settle flow deliberately uses a fresh throwaway authority per run
so repeated demo settles never collide. P3.4 closes the loop: the wallet's own market now gets
resolved + claimed too, so a real wallet balance visibly moves, not just the demo mechanics._

**Phase 4 — replay chart overhaul** — **DONE, all green** (built on a concurrent sub-agent worktree,
merged in and independently re-verified: tests + typecheck re-run clean post-merge)
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


**Phase 5 — demo script + docs** — **DONE**
- [x] P5.1 `docs/DEMO-PLAN.md` written: 7 beats (pick match → ticket across all 3 categories → connect
  wallet → fund → submit → replay to full time → settle V1/V2/V3 with step-by-step expansion → resolve/
  claim your own ticket → proof receipt → sentinel-zero close), every beat actually run this session
  (not aspirational), an explicit fallback per beat, a "90 seconds only" cut-down, and a devnet
  addendum. **PASS**
- [x] P5.2 `STATUS-FOR-MIKAIL.md` fully rewritten: a direct table mapping each of Mikail's specific
  complaints to what's now true, verified end-to-end / real-vs-simulated / honest-rough-edges / run-it
  / demo-script sections in the file's own established structure. `docs/BUILD-STATUS.md` (this file)
  kept current phase-by-phase throughout, not just at the end. **PASS**
- [x] P5.3 `BLOCKED.md` final pass: added §5 (V2/V3 live devnet resolve not attempted — V1 only, by
  timebox choice, with an exact command to pick it up) and §6 (the market-PDA-collision finding from
  Phase 3.4, resolved with a documented product-layer guard rather than a risky late on-chain change).
  Matches the existing file's tone/rigor (what was tried, why, how to unblock). **PASS**
- Fresh end-to-end verification for the record: one continuous Playwright run through every beat in
  `docs/DEMO-PLAN.md` (pick fixture → 3 categories → connect/fund/submit → replay to full time at 12× →
  settle all → expand step-by-step → resolve/claim own ticket → proof receipt), 0 console errors, plus a
  390px mobile pass (no horizontal overflow). 13 fresh screenshots in `docs/screenshots/` replace the
  stale pre-Night-2 set (which was missing the wallet UI and the multi-series chart entirely).

## PASS/PENDING table (Night 2)
_ALL PHASES DONE: 0, 1, 2, 3, 4, 5. Full regression clean as of the final commit: pricing 15/15, onchain
escrow 15/15, keeper engine unit tests 34/34, both apps typecheck clean (pre-existing bn.js +
server.ts `unknown` errors only — present before this session, not introduced by it), full Playwright
journey 0 console errors including a 390px mobile pass. See `STATUS-FOR-MIKAIL.md` for the
handoff-level summary and `BLOCKED.md` for the two genuinely-still-open items (§5, §6)._
