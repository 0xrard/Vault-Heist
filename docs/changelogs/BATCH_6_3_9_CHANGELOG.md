# Batch 6.3.9 — Match List Hygiene: Stale Unfinished Matches Auto-Hide

**Date:** 23 November 2026
**Type:** Frontend-only, display-layer change (one new read helper, one list filter, one explanatory note). No contract changes, no arena changes. Post-freeze batch: issued under the freeze rule (new batch number + changelog + re-verification) and re-frozen on completion.
**Trigger:** A product call during the 6.3.8 freeze session: the lobby match list accumulates unfinished matches forever. The rule: an unfinished match older than 30 minutes disappears from the list automatically; the history should contain only matches that were fully played (3 rounds, Finished).

## The rule, exactly as implemented

- **Finished matches (state 2)** are always listed, permanently.
- **Unfinished matches (state 0 waiting / state 1 in progress)** are listed only while they are at most **30 minutes old**, measured from the timestamp of the block that created the match (`MatchCreated`). Older than that, they are hidden automatically at list load.
- If a match's creation anchor is beyond the public RPC's log reach, the match is necessarily far older than 30 minutes and is hidden as well. (Side effect, accepted: during an RPC outage an anchor lookup can also fail for a fresh match, hiding it for that one load; the next successful load restores it.)
- The arena, session restore, and Resume flows are untouched. A player inside a match that crosses the 30-minute mark mid-play is not affected in any way.

## Honesty boundary

Nothing is — or can be — deleted onchain: the contract has no delete function and its records are immutable. "Auto-delete" here is an automatic **display filter** in the lobby, computed from chain data at load, so every browser shows the same list. A hidden match still exists, still holds its state, and can still be entered at any time through the lobby's **Resume Match by ID** box. The list carries a short note saying exactly this, so players are not misled.

## Changes

- `frontend/src/lib/contracts.ts`: new `fetchMatchCreatedAt(contract, matchId)` — returns the Unix timestamp of the match's creation block via the existing validated anchor lookup (`findMatchCreatedBlock`, Batch 6 cache included); null when the anchor cannot be determined.
- `frontend/src/components/Lobby.tsx`: `hideStaleUnfinished()` applied to the fetched list inside `loadMyMatches()` (finished kept unconditionally; unfinished checked in parallel); explanatory note rendered under the "Your Matches" header.

## Verification

- `npx tsc --noEmit` — exit 0. `npm run build` — exit 0.
- Locked-file MD5s unchanged (contracts, fhe.ts, ABIs, .env).
- Filter behavior pre-verified against live chain data for the QA wallet before shipping (see the delivery note): stale unfinished matches (#11, #12, #16, #18) resolve to hidden; finished matches (#13, #17) resolve to kept.
- Live re-test on the production deployment: pending at freeze time (list contents after push).
