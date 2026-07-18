# PulsePlay Markets — status for Mikail

_Overnight build, 2026-07-18. Track 1 (Prediction Markets & Settlement). Repo:
`/Users/mikail/Desktop/PulsePlay/pulseplay-markets` — local git, never pushed._

**One platform, three market categories, every one settled trustlessly on TxLINE-anchored data.**
Outcomes settle by **V1 `validate_stat`**, Combos by **V3 multiproof** (one CPI covers a same-match
ticket), Batch/derived by **V3 multiproof**. The proof IS the resolution — no committee, no dispute
window. The storefront prices everything off TxLINE's **de-margined `Pct`** (fair price is free data) and
walks the Merkle chain (leaf → subtree → daily root → on-chain PDA) in plain language for judges new to
Solana. All five build phases are green.

---

## Verified end-to-end (things I actually watched work)

- **On-chain settlement suite — 10/10 checks** against a local validator that clones the REAL TxLINE
  oracle (`9ExbZj…`) + anchored PDA (`6d9bJ2Et…`):
  YES payout + claim · **sentinel-zero "no red card" NO-side settled cryptographically** (value 0 is a
  provable absence) · tampered-V1 proof **reverts** (fail-closed) · **4-leg V3 combo in ONE CPI** ·
  **derived binary corner-difference in one CPI** · tampered-V3 reverts · **cancel/timeout + refund**.
  → `ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts` → "ALL PULSEPLAY ESCROW TESTS PASSED (10 checks)".
- **Pricing package — 15/15 unit tests.** De-margined probabilities, LMSR seeded at the fair prior
  (b=300; worst-case loss b·ln n = $208 binary / $330 1X2, matching the spec), parlay fair-vs-book
  (3 legs @6% → 84.0% of fair; full spec table reproduced), Gaussian-copula correlation.
- **Keeper/API on :4190 (real integration):** `/api/health` reports `engine:true, chain:true`;
  `/api/fixtures` segments **0 live / 8 upcoming / 109 finished** from the engine; `/api/catalog` prices
  6 markets off de-margined odds; `/api/settle/:id` runs the **real** create→deposit→resolve→claim
  on-chain and returns tx signatures; `/api/receipt/:id` returns a proof receipt whose **reconstructed
  root equals the on-chain root** (`0x8213ec7f…`).
- **Storefront e2e (Playwright headless, my own instance) — 0 console errors.** Full journey: browse →
  build a 2-leg ticket → Combos/Batch tabs → cinematic replay to full time → **settle full-time markets
  on-chain (real txs)** → proof receipt renders "Reconstructed root equals the on-chain root". Nine
  screenshots in `docs/screenshots/` (01 storefront … 08 proof receipt, 09 light theme).
- **Cinematic replay is honest:** 35 keyframes from real match state — clock 00:00 → 99:40, score
  0-0 → 1-0 → 1-2, and de-margined win-prob in sync (England → 0%, Argentina → 96% at full time).

## Real vs simulated (labeled everywhere in the UI)
- **Real:** TxLINE data + Merkle proofs (mainnet-anchored), the oracle CPI, the reconstructed-root ==
  on-chain-root check, the escrow program logic, every settle/claim transaction.
- **Simulated:** the money (native SOL on a local validator, not USDC on mainnet) and the two demo
  bettors. Badges say `LOCALNET` + `SIMULATED MONEY` on every screen.

---

## Honest rough edges
- **Localnet, not devnet.** The devnet faucet is dry (deploy wallet has 0 SOL). See `BLOCKED.md` §1 — the
  local-validator suite against the real cloned oracle is the settlement proof of record (as the engine
  brief intends). A live devnet *resolve* is separately gated on a devnet API token (403), a documented
  fast-follow.
- **V2 is expressed via V3.** The vendored CPI crate ships V1 + V3 helpers only; Combos use V3
  full-coverage (one CPI, every stat covered exactly once) which delivers the V2 "indexed ticket"
  semantics. Honest note in `BLOCKED.md` §2. Not a literal `validate_stat_v2` CPI.
- **Combo/derived outcome bool.** For >1-leg V3 markets the settlement bool is the multiproof's combined
  verdict; the WIN is that all legs verify atomically in one CPI. Single-leg V1 is the path for a fully
  controllable GT/LT/EQ predicate (same caveat the reference escrow-demo documents).
- **Replay chart is bottom-weighted early** (a 0-0 game keeps both win-probs low while draw dominates) —
  honest, but the drama is concentrated in the final third where the lines cross.
- **The local validator is memory-sensitive** under five parallel builds; it was OOM-reaped once. Restart
  command below; evidence reproduces in ~1 minute.
- **Next.js → Vite deviation.** The spec said "Next.js storefront"; I built Vite + React for overnight
  reliability (the storefront is a live client terminal; all TxLINE/chain logic lives in the keeper per
  the ports contract). Same palette, same product.

---

## Run it

```bash
cd /Users/mikail/Desktop/PulsePlay/pulseplay-markets

# 0. Engine must be up (external): curl localhost:3001/health → {"ok":true}
pnpm install

# 1. Local validator cloning the REAL oracle + anchored PDA (ports chosen to avoid the other agents)
cd onchain
solana-test-validator --reset --quiet --ledger test-ledger \
  --rpc-port 8999 --faucet-port 9902 --gossip-port 8790 --dynamic-port-range 9020-9120 \
  --url https://api.mainnet-beta.solana.com \
  --clone-upgradeable-program 9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA \
  --clone 6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE &
solana airdrop 60 --url http://127.0.0.1:8999
anchor build            # already built; produces target/deploy + target/idl
solana program deploy target/deploy/pulseplay_escrow.so \
  --program-id target/deploy/pulseplay_escrow-keypair.json --url http://127.0.0.1:8999

# 2. Prove settlement on-chain (10 checks)
ANCHOR_PROVIDER_URL=http://127.0.0.1:8999 npx tsx tests/pulseplay-escrow.ts

# 3. Pricing tests (15)
cd .. && pnpm --filter @pulseplay/pricing test

# 4. Keeper/API (:4190) and storefront (:4100)
pnpm --filter @pulseplay/keeper start        # http://localhost:4190/api/health
pnpm --filter @pulseplay/web dev             # http://localhost:4100

# 5. One-command keeper settlement of every demo market on-chain
pnpm --filter @pulseplay/keeper settle:demo
```

Program id `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` · Oracle `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`
(mainnet, cloned) · daily_scores_roots PDA `6d9bJ2EtjAFj2k3CKbe2VV8qZ5BgdBnGsYjWApxHWgtE`.

---

## Demo script (4 minutes)

1. **Open one market from each category** on the England 1–2 Argentina semifinal (Outcomes / Combos /
   Batch). Point at the fair-vs-book strip: PulsePlay pays the de-margined price; the book keeps the
   margin tax (visible on every card; the 3-leg combo pays **48.1× fair vs 38.1× book**).
2. **Hit "Watch the replay settle."** Fast-forward at 12× — clock and score stay in sync, the
   win-probability lines cross as Argentina come back. At full time, **"Settle full-time markets"** —
   the keeper fetches TxLINE proofs and settles V1, V3 combo, and V3 derived in one CPI each, on-chain.
3. **Open a proof receipt.** Walk the four steps: the stat leaf → the fixture's event-stats subtree →
   the day's anchored root (epoch day 20649) → the on-chain PDA, where **the reconstructed root equals
   the root Solana already stored.** No committee, no vote — the proof is the resolution.
4. **Close on the sentinel-zero "Red card shown" market.** It resolves **NO cryptographically**: a zero
   is provable, so an absence settles just like an occurrence. Almost nobody else will have this.

_See `docs/BUILD-STATUS.md` for the full PASS/PENDING checklist and `BLOCKED.md` for what's parked._
