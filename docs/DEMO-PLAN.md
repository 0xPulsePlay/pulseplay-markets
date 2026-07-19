# PulsePlay Markets — demo plan

A beat-by-beat walkthrough, spoken time ≤5 minutes. Every beat below has actually been run end-to-end
this session (Playwright-verified, real on-chain transactions) — this is not aspirational. Run commands
are in `STATUS-FOR-MIKAIL.md` → "Run it". Program id, oracle, mint addresses are all real and pinned
below so you never have to look them up mid-demo.

**Before you start**: have the local validator + keeper (:4190) + web app (:4100) running (see
"Run it"), and — if you want the devnet beats — the deploy wallet funded and `apps/keeper/.cache/
devnet-token.json` present (already obtained this session; see `docs/TXLINE-INTEGRATION.md` →
"Devnet"). The localnet path alone is a complete, self-contained demo if devnet is flaky on the day.

---

## Beat 1 — Pick a match (30s)

**Say**: "PulsePlay prices and settles World Cup markets from real TxLINE data. Here's the fixtures
list — every one of these is a real match with real odds." *Scroll to Fixtures, click a non-demo
fixture (e.g. "Jordan v Algeria").* "Real de-margined pricing for this fixture too — but see this
banner? Settlement proofs are only recorded for one match tonight, so anything else is honestly
labeled priced-only." *Click back to "England v Argentina" (marked `SETTLEABLE`).*

**Show**: the fixture list is genuinely clickable (Phase 2) — this was the #1 gap in the last review
("I can't select any of the actual matches").

**Fallback**: if fixture-switching feels slow (cold cache on a fixture with a lot of odds history),
narrate through it — "real data takes a beat to price" is an honest, not embarrassing, line. Don't
re-click repeatedly; wait it out once.

---

## Beat 2 — Build a ticket across all three categories (45s)

**Say**: "Three market categories, three different settlement generations." *Click Outcomes tab (default),
pick "England to score" YES.* "One question, one claim — settles via a single V1 `validate_stat` CPI."
*Click Combos tab.* "A same-match parlay — three legs, one indexed-strategy CPI, V2." *Click Batch tab.*
"And derived markets — corner difference, a calculated stat, V3 multiproof." *Don't need to add the
combo/batch legs to the ticket — just showing the tabs is enough; the demo settle later (Beat 6) settles
one of each generation regardless of what's in your personal ticket.*

**Show**: the plain-language one-liner under each tab ("One question, one answer…", "Bundle a few
outcomes…") — direct response to "a lot of verbose things I'm not sure what they mean."

---

## Beat 3 — Connect a wallet, fund it, submit a real ticket (60s)

**Say**: "Now the part that was missing last time — an actual wallet, submitting an actual transaction."
*Click "Connect wallet" (top right). If Phantom isn't installed in the demo browser, this is the one
beat that needs a real extension — see fallback.* *Click the wallet button → "Fund my wallet."* "That
just minted devnet test-USDC to my wallet and sent a little gas SOL — no rate limit, we control the
mint." *Go back to Markets, pick an Outcomes market YES, click "Submit ticket."*

**Show**: the per-leg progress state (spinner → "market created + deposited" with a real, clickable
tx signature) inside the Ticket panel. This is a REAL client-signed `create_market` + `deposit`
transaction, submitted by the connected wallet — the exact gap Mikail called out: *"I have no idea how
to submit that ticket."*

**Fallback**: Phantom not installed / no time to install → narrate it live using the Node scratch
scripts instead (`apps/keeper/scripts/verify-devnet-escrow.mjs` shows the identical flow against real
devnet, full transaction signatures printed to the terminal) — say "here's the same flow from the
command line, same instructions, same program." Never fabricate a browser click that didn't happen.

---

## Beat 4 — Fast-forward the replay to full time (45s)

**Say**: "This is a real World Cup semifinal — England 1, Argentina 2 — replayed from TxLINE's full tick
corpus, not synthesized." *Click Replay. Click 12×.* "Four real series, not one — win probability for
both teams, the draw, and the goals line, each labeled. Shaded regions are the actual match phases —
first half, half-time, second half, stoppage, full time — from the fixture's real timeline, not a
guess." *Let it run to FULL TIME (about 2.5s at 12×).*

**Show**: the chart stays crisp and legible even at 12× — never compresses into mush. This was
Mikail's own prior praise for the replay; make sure it still holds (it does, re-verified this session).

**Fallback**: if it visibly stutters (extremely low likelihood, verified clean), just say "watch how the
phase bands and four series all move in lockstep with the score" and let the visual speak — the chart
itself is the evidence, no need to defend it verbally.

---

## Beat 5 — Settle on-chain: V1, V2, V3, all three generations (75s)

**Say**: "At full time, the keeper fetches real TxLINE proofs and settles every market — one CPI per
generation." *Click "Settle full-time markets."* Wait ~5-10s. *Click any settled chip to expand its
step-by-step timeline.* "Create, deposit both sides, resolve — that's the actual oracle CPI verifying
the proof — then claim. Five real transactions, five real signatures, all on Solana Explorer." *Click
one signature link.*

**Show**: the generation chips on each market (V1/V2/V3) plus the expandable step list — direct
response to *"There is no evidence of anything that moves from a vault to a wallet... no evidence of a
CPI actually happening."* There now is.

**Then, your own ticket**: *scroll to "Your tickets" (only visible with a wallet connected + a
submitted ticket from Beat 3).* "And here's MY wallet's own market — separate from the keeper's demo
bettors, this one I actually deposited into." *Click Resolve, then Claim.* "That's a real signature
from MY wallet, and watch the balance in the top-right change." *Point at the topbar balance.*

**Fallback**: if a resolve/claim tx is slow on a loaded local validator, that's expected under
five-hackathon-parallel-load — say so plainly ("local validator's busy tonight") rather than waiting
in silence. Never claim a transaction succeeded before its signature actually appears.

---

## Beat 6 — Walk the proof receipt (45s)

**Say**: "Here's what 'the proof is the resolution' actually means." *Click "proof receipt" on any
settled market.* "Four steps: the single stat gets hashed into a leaf. That leaf folds into this
fixture's event-stats subtree — proves it belongs to THIS match. That subtree folds into the day's
anchored root. And THAT root — reconstructed from nothing but this proof, client-side — equals the
root Solana already has stored on-chain, in the daily_scores_roots PDA." *Point at the match/green
check.* "No committee. No dispute window. No oracle admin key that could lie. The math IS the
settlement."

**Fallback**: if the engine's live mainnet-RPC verify call is slow/unavailable when you click through,
the receipt honestly shows "unverified" rather than faking a green check — say exactly that: "we never
fabricate a match — if the engine can't confirm live, it says so." This is itself a selling point
(trust products should never lie about verification state), not a bug to hide.

---

## Beat 7 — Close on the sentinel-zero market (30s)

**Say**: "Last thing — the cleverest bit. This market: 'Red card shown?' It settled NO. Not because
nobody checked — because the proof for 'zero red cards' is EQUALLY as verifiable as a proof for 'one
red card.' A value of zero is provable, not just an absence of data. So even 'nothing happened' markets
settle cryptographically, both sides, symmetric trust. Almost nobody else builds this."

**Show**: the "Red card shown" market's `settlementNote` ("Sentinel-zero: value 0 is a PROVABLE
absence...") and, if time allows, its proof receipt.

**Fallback**: none needed — this is pure narration over an already-settled market from Beat 5, no live
action required, lowest-risk closing beat.

---

## Reference — real addresses/programs used in this demo

- Escrow program: `2YbfXEyo18qDvSFhB67fxzPm73q3PxV4rRCeD29jvGin` (same id on localnet AND devnet)
- Mainnet TxLINE oracle (localnet clones this): `9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA`
- Devnet TxLINE oracle: `6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J`
- Devnet "USDC (Devnet Test)" mint: `BPqAwt3dbUCQmbfeTmu8S4RPGedovb2zcd9DZ9Khd171` — **never real
  USDC**, every UI surface labels it "devnet test token"
- Demo fixture: `18241006` (England 1–2 Argentina, World Cup semifinal)

## If you only have 90 seconds

Beats 4 → 5 → 6, in that order: fast-forward to full time, settle (show the step-by-step timeline for
ONE market), open its proof receipt. That's the whole trust story — real replay, real on-chain
settlement, real cryptographic proof — without needing the wallet-connect setup.

## If devnet is part of the demo

Everything above runs identically on devnet (`CLUSTER=devnet` — see "Run it" in
`STATUS-FOR-MIKAIL.md`), with one bonus: Outcomes markets (V1) settle from a proof fetched LIVE from
`txline-dev.txodds.com` at the moment you click Settle — not a recorded file. Worth saying explicitly:
"this isn't a canned devnet demo — it's live-fetching a real Merkle proof from TxLINE's devnet API
right now." Combos/Batch (V2/V3) still use recorded fixtures on devnet (not yet confirmed live — see
`BLOCKED.md`), so don't claim otherwise if asked.
