# Vault Heist — Batch 5 Changelog: Final Visual & Audio Polish

Date: 2026-11-21. Scope: frontend only. No smart contract changes, no
redeployment, no ABI changes. Batch 5 is the final presentation pass:
CLASSIFIED / SEALED vault values, a cinematic round-resolution overlay,
confirmation-timed SFX, Syndicate AI streak dialogue, and
prefers-reduced-motion support. All Batch 4 reliability flows (commit
recovery, anchored Scout verification, Scout sync gate) are untouched in
behavior.

## 1. Files changed

| File | Change |
| --- | --- |
| `frontend/src/components/VaultCard.tsx` | Encrypted stat rows now show a rotated **CLASSIFIED / SEALED** security stamp instead of the truncated hex handle; the full hex handle remains available as a `title` tooltip on the stamp. Card header badge changed from "FHE ENCRYPTED" to "SEALED". Slider drag now plays a very soft tick on integer change. `ScrambleValue` honors reduced motion. Removed the now-unused `truncateHandle` helper and `Lock` import. |
| `frontend/src/components/CinematicReveal.tsx` | **New.** Cinematic reveal overlay (large VaultDoor per vault A → B → C, red flash + overlay shake + large ALARM TRIPPED stamp on alarm, gold open + SECURED on safe, closing summary card with round deltas and running totals), plus the consume-once cross-remount hand-off helpers (`stashPendingReveal` / `consumePendingReveal`). |
| `frontend/src/components/GameArena.tsx` | SFX timing rework (click on press, confirmations after transaction success). Captures each resolution in `resolutionRef`; triggers the cinematic overlay only from the live submit path and stashes it for the remounted next-round arena instance. Mount effect consumes a stashed reveal. Syndicate streak milestone dialogue at match end (streak 3 / 5 / 10). Renders the overlay. |
| `frontend/src/lib/sfx.ts` | Added `playClick()` (soft interaction click) and `playSliderTick()` (very soft slider tick). `playLock` / `playSonar` are now confirmation sounds (call sites moved); comments updated. |
| `frontend/src/lib/usePrefersReducedMotion.ts` | **New.** Central `matchMedia("(prefers-reduced-motion: reduce)")` hook with change listener. |
| `frontend/src/index.css` | Added `.cine-flash` keyframes for the overlay alarm flash, and a `@media (prefers-reduced-motion: reduce)` block disabling all Batch 2/5 keyframe animations (laser, siren, shake, stamp, score-fly, agent-pop, scanline, alarm pulse, cine-flash, rise-in) and removing door panel/wheel transitions so door state changes are instant. |
| `BATCH_5_CHANGELOG.md` | This file (new). |

No other files were created or modified. In particular, the following
locked files are byte-identical before and after (see section 5):
`contracts/VaultHeist.sol`, `contracts/HeistLootToken.sol`, `frontend/.env`,
`frontend/src/lib/fhe.ts`, `frontend/src/abi/VaultHeist.json`,
`frontend/src/abi/HeistLootToken.json`. `App.tsx` and
`RoundHistory.tsx` were not modified.

## 2. Reason for each change

- **CLASSIFIED / SEALED display (`VaultCard.tsx`).** The encrypted loot and
  alarm rows showed a truncated ciphertext handle (`0x69a8…0200`) under an
  "FHE ENCRYPTED" badge, which reads like a developer dashboard. The
  primary display is now a rotated rose security stamp, "CLASSIFIED /
  SEALED"; the full hex handle survives only as a tooltip (`title`
  attribute) so technical judges can still inspect it. Scouted/decrypted
  values still render as numbers exactly as before, including the Batch 2
  cipher scramble.
- **Cinematic reveal overlay (`CinematicReveal.tsx`, `GameArena.tsx`).**
  Batch 2's dramatic reveal lives inside the small RoundHistory rows; the
  audit asked for a main moment. When a round resolves through the live
  submit flow, a full-screen overlay now focuses one vault at a time
  (~0.95 s each): the large VaultDoor opens gold for a safe vault, or a
  red flash, a whole-overlay shake, and a large ALARM TRIPPED stamp for an
  alarmed one. It closes with a summary card (this round's score change
  for both sides, running totals), auto-dismisses at ~4 s total, and
  dismisses early on any click. It is purely presentational over the data
  `collectResolution` already decrypted: no new decryption, no new
  transaction, and it never gates state sync, TxProgress, or recovery.
  Trigger discipline: only `handleSubmit`'s successful resolution path
  fires it. `handleRefresh` (manual recovery fetch), App's polling
  resume, and history backfill never do.
- **Cross-remount hand-off (`CinematicReveal.tsx` helpers).** App keys
  `GameArena` by `${matchId}-${currentRound}`, so the arena unmounts and
  remounts in the same commit that resolves rounds 1–2; overlay state set
  on the dying instance would never paint. `handleSubmit` therefore also
  stashes the reveal data in a module-level, consume-once slot (20-second
  freshness window); the next round's arena instance consumes it on mount
  and plays the overlay. On the final round the key does not change (the
  match is Finished), so the overlay plays from the submitting instance's
  local state, above the match summary modal (overlay z-60 vs modal
  z-50), and dismisses into it. A page refresh wipes module memory, so a
  resumed match can never replay an overlay.
- **SFX timing (`sfx.ts`, `GameArena.tsx`, `VaultCard.tsx`).** Interaction
  and confirmation sounds are now separated. Previously `playLock` fired
  before encryption and wallet approval, and `playSonar` fired before the
  Scout transaction succeeded, so a rejected transaction still sounded
  successful. Now: `playClick` (soft) marks the button press in both
  handlers; `playLock` plays only after `submitAllocation`'s
  `tx.wait()` resolves; `playSonar` plays only after the Scout
  transaction's `tx.wait()` resolves; `playReveal` still plays at actual
  Scout decryption success. The allocation slider gained a very soft tick
  (`playSliderTick`, gain 0.012) fired only when the integer value
  actually changes during a drag. The Batch 2 plus/minus button ticks are
  unchanged.
- **Syndicate streak dialogue (`GameArena.tsx`).** When a finished Solo
  match was won by the player, the arena now checks `streakStorage` for
  the win streak that ends at this match's own recorded entry. If it is
  exactly 3, 5, or 10, the generic victory line is replaced by a
  milestone reaction (3: grudging, 5: rattled, 10: alarmed). The streak
  is computed ending at this matchId, so the number is the streak this
  match produced, and recording dedupe per matchId (Batch 3) means the
  result can only ever be recorded once.
- **Reduced motion (`usePrefersReducedMotion.ts`, `index.css`,
  `VaultCard.tsx`, `CinematicReveal.tsx`).** With
  `prefers-reduced-motion: reduce`: the cipher scramble renders the final
  value instantly; the cinematic overlay skips straight to its summary
  card (no sequence, shake, or flash) and dismisses sooner; all Batch 2/5
  keyframe animations are disabled and vault door transitions are removed
  (door state changes become instant) via one centralized `@media` block.

## 3. Regression risks (honest assessment)

- **Overlay trigger depends on the remount hand-off (`GameArena.tsx`,
  `CinematicReveal.tsx`).** If a future change alters App's arena keying
  or the submit flow, the overlay could double-play (local state plus
  hand-off) or not play. The consume-once slot and the 20-second
  freshness window bound the failure mode to a cosmetic replay at worst;
  no game state reads the slot. The final-round path intentionally relies
  on the key NOT changing when a match finishes; if `currentRound` ever
  advanced past 3 on finish, the local-state overlay would be lost and
  (because of the `round < 3` stash gate) not handed off either. That
  combination cannot occur with the current contract (matches end at
  round 3), but it is the overlay's most fragile assumption.
- **Overlay covers the screen for up to ~4 s (`CinematicReveal.tsx`).**
  It is click-dismissible and auto-dismisses, and all state sync continues
  underneath, but a player who wants to act immediately must tap once to
  skip. On the final round it intentionally sits above the match summary
  modal for its duration, then dismisses into it.
- **Overlay plays no sounds.** RoundHistory's per-vault siren/chime
  (Batch 2) still fire on their own timers when the record lands, so the
  audio story of a resolution is unchanged and never doubled. The two
  reveals (overlay over the arena, animated row in the history below)
  run concurrently by design; RoundHistory remains the permanent record.
- **SFX confirmation timing (`GameArena.tsx`).** `playLock` now also
  marks the moment the PvP "waiting for opponent" phase begins (the
  commit is onchain at that point, which is the event being confirmed).
  If `tx.wait()` succeeds but resolution collection then fails, the
  player hears the lock confirmation and lands in the pre-existing
  recovery panel; that is accurate (the commit did succeed) but worth
  knowing. Rejected transactions now produce only the soft press click.
- **Slider tick frequency (`VaultCard.tsx`).** The tick fires once per
  integer step crossed per change event, at very low gain. A fast drag
  across all 10 steps produces up to 10 soft ticks; deliberate, and the
  Batch 4 locked state still disables the slider entirely after commit.
- **Streak dialogue reads storage in the finished effect
  (`GameArena.tsx`).** The milestone line is derived from localStorage
  results; if a result was recorded by a different browser/profile it is
  simply absent and the generic line shows. The generic victory line is
  set synchronously first and the milestone (when hit) replaces it a tick
  later inside the same effect; behind the summary modal this swap is
  not visible in practice. Resuming an old finished match whose win
  produced a 3/5/10 streak shows that match's milestone line again,
  which is intended: the line is tied to the match, not to the session.
- **CLASSIFIED stamp tooltip (`VaultCard.tsx`).** The `title` tooltip is
  browser-native: it needs a hover (desktop) and is effectively
  undiscoverable on touch devices. The hex handle is therefore a
  desktop-judge detail now; nothing in gameplay depended on it.
- **Reduced-motion coverage.** The `@media` block kills animations by
  class name; any future animation class added without being listed
  there will still animate for reduced-motion users. The two JS-gated
  behaviors (scramble, overlay sequence) consult the hook directly and
  cannot drift that way.

## 4. Build results (frontend)

- `npx tsc --noEmit` — **exit 0**, no errors.
- `npm run build` (`tsc -b && vite build`) — **exit 0**, built
  successfully. The only warning is the pre-existing "chunks larger than
  500 kB" notice from the FHE WASM bundle, unrelated to Batch 5.

## 5. Test results and self-checks

- `npx hardhat test` (project root) — **exit 0: 13 passing, 0 failing**
  (~5 s). Breakdown: 3 cLOOT reward tests (`ClootRewards.test.js`), 5
  mock FHEVM tests (`VaultHeist.test.js`), 5 FHEVM tests
  (`VaultHeist.test.ts`). Contracts were not modified, so this confirms
  the baseline suite is intact.
- Locked-file MD5 confirmation (identical before and after Batch 5):
  - `contracts/VaultHeist.sol` — `8b9240785791a1dfcf87e21a925d1b71`
  - `contracts/HeistLootToken.sol` — `ac30a967b2a670c1f46c7018cfa7085e`
  - `frontend/.env` — `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - `frontend/src/lib/fhe.ts` — `b92c0c3b6cbb05a7818521692fe8a449`
  - `frontend/src/abi/VaultHeist.json` — `4b90e7ad0763543259f54cfd98803e63`
  - `frontend/src/abi/HeistLootToken.json` — `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`
- No new user-visible UI string in this batch contains an em dash
  (checked in `CinematicReveal.tsx`, `VaultCard.tsx`, `GameArena.tsx`,
  `sfx.ts`).

## 6. Not covered by automated verification

The frontend has no automated UI test suite. The following need a
live Sepolia session and are NOT verified by this batch: overlay pacing
and feel (per-vault ~0.95 s, ~4 s total, tap-to-skip) on desktop and on
mobile; CLASSIFIED stamp readability and tooltip behavior; slider
tick subtlety during a real drag; confirmation sounds landing exactly on
transaction success vs rejection in MetaMask; streak milestone lines
appearing at exactly 3 / 5 / 10 consecutive wins; reduced-motion behavior
with the OS setting enabled on his device (scramble instant, overlay
straight to summary, doors instant).
