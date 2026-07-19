# TxLINE integration — endpoints used & API feedback

## TxLINE data used as a live/primary input

**REST (`@txline/client-sdk` → `http://localhost:3001/v1`)**
| Endpoint | Where we use it |
|---|---|
| `GET /v1/corpus` | health / corpus size banner |
| `GET /v1/fixtures?status=live\|upcoming\|played` | storefront fixtures, segmented live/upcoming/finished |
| `GET /v1/fixtures/{id}` | match header (teams, final score) |
| `GET /v1/fixtures/{id}/state?ts=` | **replay keyframes** — real match clock + score at each sample |
| `GET /v1/fixtures/{id}/odds?market=1X2_PARTICIPANT_RESULT` | **de-margined win-prob** line + fair market pricing |
| `GET /v1/fixtures/{id}/odds?market=OVERUNDER_PARTICIPANT_GOALS&…` | de-margined fair price for goal markets |
| `GET /v1/validation/scores?fixtureId=&seq=&statKeys=&verify=1` | **proof receipt**: on-chain root, epoch day, PDA, verified verdict |

**On-chain (`@txline/verify` + `txoracle-cpi`)**
- `statLeaf(stat)` / `describeStatKey(key)` — leaf hash + human labels for the proof receipt.
- The oracle **CPI**: `validate_stat` (V1), `validate_stat_v2` (V2 indexed strategy — fed by the LIVE
  `/v1` multi-stat proof, `statKeys=1,2,3`), and `validate_stat_v3` (V3 multiproof) from our
  `pulseplay_escrow` program — settlement + fail-closed guarantee, all three generations.
- `daily_scores_roots` PDA (`6d9bJ2Et…`) — the single read-only account each CPI reads.

**Differentiators we lean on:** de-margined `Pct` = true probability (fair pricing is free data);
`validate_stat_v3` multiproof settles a whole multi-leg ticket in ONE CPI; **value=0 is a provable
sentinel** so occurrence markets settle both sides; the full tick corpus makes the replay a real weapon.

## API feedback (our experience building against it tonight)

1. **Single- vs multi-stat validation response shape is inconsistent.** `GET /v1/validation/scores` with
   one `statKey` returns singular `statToProve` / `statProof`; with several it returns plural
   `statsToProve[]` / `statProofs[]`. We branch on `Array.isArray(statsToProve)`. A consistent (always
   plural) shape would remove a footgun.
2. **No V3 on `/v1`.** Multiproofs (`stat-validation-v3`) are upstream-only, so the V3 combo/batch demos
   run off recorded fixtures + a local validator. A `/v1` V3 proxy would let the whole flow be live.
3. **CPI crate ships V1 + V3 but not V2.** `cpi_validate_stat_v2` doesn't exist in `txoracle-cpi` even
   though the V2 discriminator + `encodeValidateStatV2Data` are in the TS SDK. We added a thin local
   `cpi_validate_stat_v2` adapter (V2 = V3 minus the multiproof, per the SDK's own docstring) — trivial,
   but a shipped crate helper would save every consumer the reverse-engineering. Separately, Anchor's JS
   coder caps instruction data at 1000 bytes, which limits a full-membership-path V2 ticket to ~3 legs.
4. **PDA timestamp gotcha.** The `daily_scores_roots` seed / `ts` must come from
   `summary.updateStats.minTimestamp`, **not** `proof.ts` and not `Date.now()`. The builders handle it,
   but it cost time to confirm; worth flagging loudly in the docs.
5. **`Pct` typing differs by route.** Raw ticks give `Pct` as a **string[]** (`"27.420"`); downsampled
   series give numeric `pctClose`. Minor, but a mixed-type surprise.
6. **Off-match windows read as errors but aren't.** `status=live` returns `[]` and streams report
   `recordsSeen:0` — healthy, but easy to misread as a failure. A short "no live fixtures right now"
   signal would help.
7. **Anchor `CpiContext::new` takes a `Pubkey`, not an `AccountInfo`,** in the pinned `anchor-lang 1.1.2`
   used by the crate — the opposite of upstream Anchor, which broke our first compile until we matched the
   reference program. Worth a line in the crate README.
8. **`verify=1` calls mainnet RPC** and can be slow/rate-limited; we cache validation responses per stat
   for the receipt view.
9. **`GET /v1/fixtures/{id}/state?ts=` can return a non-match-state administrative tick even mid-match,
   not just at stream end.** The nearest-seq-to-ts lookup sometimes lands on a raw `"comment"` or
   `"action_discarded"` event — `statusId: null` → `statusLabel: "?"`, and the `clock` field is
   sometimes entirely absent even though the match clock is genuinely still running (confirmed live on
   the demo fixture: seq 114/225/680, mid-H1 and mid-H2). A consumer that classifies phase/clock purely
   off the single sample will render a fabricated glitch (we originally read the `"?"` as an unknown
   phase and defaulted to "stoppage," and a missing clock field as `?? 0`, i.e. a false clock reset to
   00:00). Fix: treat `statusLabel === "?"` as "no new information" and hold the last known
   phase/clock/status text rather than trust the sample at face value — see `computeMatchPhase()`'s
   `fallback` param and `assembleKeyframes()` in `apps/keeper/src/engine.ts`.
10. **A fixture's very last `timeline.phases` entry's `wallEnd` can itself be a `"disconnected"` stream
    marker, one ms after the real final match-state event**, not the real FINAL event. Querying
    `state?ts=` at exactly that `wallEnd` returns the disconnect marker (`statusLabel: "?"`, no clock);
    querying `wallEnd - 1` returns the real FINAL state cleanly. Worth flagging since `wallEnd` is
    otherwise the natural "end of the fixture" anchor per the SDK's own docstring.
