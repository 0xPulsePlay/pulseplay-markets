# PulsePlay Markets — status for Mikail

_Night 2, 2026-07-19. Track 1 (Prediction Markets & Settlement). Repo:
`/Users/mikail/Desktop/PulsePlay/pulseplay-markets` — worked in a git worktree
(`.claude/worktrees/agent-a7f8aedd349925f2f`, branch `worktree-agent-a7f8aedd349925f2f`), never pushed._

This is the follow-up to your hands-on review of last night's build (`d064b84`) — devnet deployment, a
real USDC-like devnet wagering token, a real fixture picker, wallet connect with real client-signed
transactions, a richer replay chart, and this doc. Every gap you called out by name is closed:

| You said | What's now true |
|---|---|
| "I can't select any of the actual matches" | Every fixture row is clickable — scopes the whole storefront to that fixture with real de-margined pricing (Phase 2) |
| "There's no DEVNET funds" / "no way to submit that ticket" | Real Phantom wallet-connect, a "Fund my wallet" faucet, and a real client-signed `create_market`+`deposit` transaction with a confirmed signature (Phase 3) |
| "No evidence of anything that moves from a vault to a wallet... no evidence of a CPI actually happening" | An expandable step-by-step CPI lifecycle (Create → Deposit × 2 → Resolve → Claim, each a real tx link) plus a "Your tickets" panel that resolves + claims YOUR wallet's own market and visibly moves its balance (Phase 3.4) |
| Confusing replay chart | Four real labeled series (not one), shaded match-phase bands (pre-match/1st half/HT/2nd half/stoppage/full time) from the fixture's real timeline (Phase 4) |
| (implicit ask) devnet + a real USDC-like token | Deployed to devnet, a real "USDC (Devnet Test)" SPL token backs every stake — never real USDC, labeled everywhere (Phase 0/1) |

---

## Verified end-to-end (things actually watched work this session)

- **Devnet**: `pulseplay_escrow` deployed to devnet at the stable program id
  `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` (same id as localnet). The devnet TxLINE
  subscribe→activate token flow (previously blocked — faucet dry) **succeeded**: real apiToken obtained,
  cached locally. **Bonus, not just unblocked**: the demo semifinal fixture (18241006) is live on
  devnet too — a **genuinely live devnet settlement** works (fetch a real proof from
  `txline-dev.txodds.com` at settle time, real `validate_stat` CPI against the live devnet oracle,
  real claim) — this was expected to stay gated behind an API token wall; it isn't.
- **USDC-like devnet token**: a real classic-SPL-Token mint, `BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171`,
  6 decimals, minted by the deploy wallet. Every stake/vault/payout moves in this token now (not native
  SOL). Labeled `"USDC · devnet test token"` (or `"USDC · local test token"` on localnet) everywhere it
  appears — never presented as real USDC.
- **Escrow program rewrite — 15/15 checks** (was 12/12 SOL-based; rewrote for the SPL vault + 3 new
  wrong-mint-rejection checks): vault is now an Associated Token Account owned by the market PDA itself;
  `create_market`/`deposit`/`claim`/`refund` move real SPL tokens via `anchor_spl::token` CPIs. Behavior
  (winner-take-all math, cancel/refund, fail-closed on tampered proofs) unchanged.
  `ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts` → "ALL PULSEPLAY ESCROW
  TESTS PASSED (15 checks)".
- **Real fixture picker (Phase 2)**: click any of the 110+ finished (or 7 upcoming) fixtures, the
  storefront re-prices around it with real de-margined odds. The demo semifinal is the only one marked
  `SETTLEABLE` (recorded proofs only exist for it) — never fakes a "Settle" action it can't back.
- **Wallet connect + real ticket submission (Phase 3)**: Phantom wallet-connect, a "Fund my wallet"
  faucet (mints test USDC + sends gas SOL, no rate limit), and a real client-signed deposit transaction
  — the keeper builds it, Phantom signs it, the browser submits it, a real confirmed signature shows
  with a working Solana Explorer link. Verified via a full Playwright run with a mocked Phantom bridged
  to a real ed25519 signer (not a UI-only mock — the actual transaction bytes are signed and submitted).
- **Settlement visualization (Phase 3.4)**: every settled market expands into its real 5-step CPI
  lifecycle (Create → Deposit YES → Deposit NO → Resolve [the actual oracle CPI] → Claim), each step its
  own real transaction signature. Your own connected wallet gets a separate "Your tickets" panel —
  resolve (permissionless, keeper pays gas) then claim (needs your signature) — and the topbar wallet
  balance visibly changes after claiming.
- **Cinematic replay overhaul (Phase 4)**: four real labeled series (both teams' win-prob, draw, and a
  goals line — not fabricated for markets with zero real ticks), shaded HT/2nd-half/stoppage/full-time
  bands from the fixture's real match-phase timeline, a dashed pre-match lead-in. Still never compresses
  into mush at 12× fast-forward (re-verified this session).
- **Full journey, one continuous run, 0 console errors**: pick a fixture → browse all 3 categories →
  connect a wallet → fund it → submit a real ticket → replay to full time at 12× → settle all markets
  (V1/V2/V3) → expand the step-by-step timeline → resolve + claim your own ticket → open a proof
  receipt. Also re-verified at 390px mobile width — no horizontal overflow.
- **Pricing package — still 15/15.** Untouched this session, re-confirmed after every merge.
- **Keeper engine — 34/34 new hermetic unit tests** (Phase 4's multi-series/phase-band logic), all
  driven by real recorded fixture-18241006-shaped data, no network in the tests themselves.

## Real vs simulated (labeled everywhere in the UI)

- **Real**: TxLINE data + Merkle proofs, the oracle CPI (V1/V2/V3), the escrow program logic, every
  settle/claim/resolve transaction, the client-signed deposit transactions, the devnet deployment, the
  devnet SPL token itself.
- **Simulated / test-only, always labeled**: the devnet/localnet SPL token is a devnet TEST token, never
  real USDC (label present on every balance/vault display). The keeper's own "Settle full-time markets"
  demo button still uses fresh throwaway bettor keypairs (by design — it's a self-contained mechanics
  demo, separate from your own wallet's real ticket, which gets its own market instance — see
  `docs/BUILD-STATUS.md` Phase 3.4's design note for why those are deliberately two different market
  PDAs, not a bug).

---

## Honest rough edges

- **A real, product-level bug found and fixed this session, worth knowing about**: the on-chain
  `market` PDA is seeded only by `(authority, fixtureId, statKey, period)` — not the predicate itself.
  A few catalog markets deliberately share a (statKey, period) with a different predicate (e.g.
  "England to score" and "England exactly 1 goal" are both statKey=1/period=5). The demo-settle flow
  never collided (fresh random authority every call), but a single connected WALLET is the same
  authority across everything it bets on — so two different catalog entries could silently resolve to
  the same on-chain account. Fixed with a predicate-match guard at the product layer (never shows a
  phantom "ticket" for a market you didn't actually bet on, and throws a clear error instead of
  silently depositing into the wrong market) rather than changing the on-chain PDA seeds — that would
  need a program rebuild + full re-verification across localnet AND devnet, which felt like the wrong
  risk to take this late in the session. Full writeup in `docs/BUILD-STATUS.md` Phase 3.4. Practical
  effect: **one connected wallet can only hold one open market per (statKey, period) pair at a time.**
  For the demo, that's a non-issue (you'd bet on one Outcomes market with your wallet, which is exactly
  the beat in `docs/DEMO-PLAN.md`) — just don't try to wallet-submit both "England to score" AND
  "England exactly 1 goal" from the same wallet in the same demo run.
- **V2/V3 live devnet resolve is unconfirmed.** V1 (Outcomes) settles from a proof fetched LIVE from
  devnet; Combos (V2) and Batch (V3) still use the recorded localnet fixtures even when `CLUSTER=devnet`
  — the raw devnet API's multi-stat/multiproof shape wasn't tested this session (V1 was the proven,
  time-boxed win). Not a regression, just not yet extended.
- **No on-chain token metadata for the devnet USDC mint.** Phantom will show it as an unlabeled SPL
  balance in ITS OWN wallet UI (our app's own UI always labels it correctly). Skipped Metaplex metadata
  to protect the time budget — a fast-follow if there's time before submission.
- **Flag coverage is 30 teams, not all ~110+ fixtures' worth.** Extended significantly this session
  (was 10), remaining teams fall back to a clean monogram — reads fine, not broken.
- **The local validator is memory-sensitive under five parallel hackathon builds** (same note as last
  night) — if `chain: false` ever shows in `/api/health`, restart it with the command below; the
  keeper/on-chain suites reproduce all evidence in under a minute.
- **Next.js → Vite deviation** (carried over from last night, still true): the storefront is Vite +
  React, not Next.js, for overnight reliability. Same palette, same product.

---

## Run it

```bash
cd /Users/mikail/Desktop/PulsePlay/pulseplay-markets/.claude/worktrees/agent-a7f8aedd349925f2f

# 0. Engine must be up (external): curl localhost:3001/health → {"ok":true}
pnpm install

# 1. Local validator cloning the REAL oracle + anchored PDA
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

# 2. Prove settlement on-chain (15 checks, SPL-token vault)
ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts

# 3. Pricing tests (15) + keeper engine unit tests (34)
cd .. && pnpm --filter @pulseplay/pricing test
pnpm --filter @pulseplay/keeper test

# 4. Keeper/API (:4190) and storefront (:4100) — localnet (default)
pnpm --filter @pulseplay/keeper start        # http://localhost:4190/api/health
pnpm --filter @pulseplay/web dev             # http://localhost:4100

# 4b. Or against devnet instead (needs the funded deploy wallet + cached devnet token):
CLUSTER=devnet SOLANA_RPC_URL=https://api.devnet.solana.com \
  KEEPER_WALLET_PATH=~/.config/solana/pulseplay-deploy-authority.json \
  MINT_AUTHORITY_WALLET_PATH=~/.config/solana/pulseplay-deploy-authority.json \
  pnpm --filter @pulseplay/keeper start

# 5. One-command keeper settlement of every demo market on-chain (fake-bettor demo flow)
pnpm --filter @pulseplay/keeper settle:demo

# 6. Re-chase the devnet TxLINE token if apps/keeper/.cache/devnet-token.json is missing/stale
pnpm --filter @pulseplay/keeper devnet:token -- --keypair ~/.config/solana/pulseplay-deploy-authority.json --dry-run
pnpm --filter @pulseplay/keeper devnet:token -- --keypair ~/.config/solana/pulseplay-deploy-authority.json --yes
```

To exercise a wallet in the browser: install the Phantom extension, open http://localhost:4100, click
"Connect wallet" in the topbar, then "Fund my wallet" from the wallet panel. Everything after that is
real transactions from your real (devnet-test-funded) Phantom wallet.

Program id `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` (same on localnet AND devnet) · Mainnet oracle
`9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA` (localnet clones this) · Devnet oracle
`6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J` · Devnet USDC-test mint
`BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171`.

---

## Demo script

See `docs/DEMO-PLAN.md` for the full beat-by-beat (~5 min, with a fallback for every beat). Short
version: pick a fixture → browse Outcomes/Combos/Batch → connect + fund a wallet → submit a real ticket
→ fast-forward the replay to full time → settle on-chain (V1/V2/V3, expand the step-by-step CPI
timeline) → resolve + claim your own wallet's ticket, watch its balance move → open a proof receipt and
walk the Merkle chain → close on the sentinel-zero "no red card" market resolving NO cryptographically.

_See `docs/BUILD-STATUS.md` for the full PASS/PENDING checklist (all of Phases 0-4 are PASS; Phase 5 —
this doc — is what's left) and `BLOCKED.md` for what's genuinely still open._
