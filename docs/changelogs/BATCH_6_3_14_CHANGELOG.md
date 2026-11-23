# Batch 6.3.14 — Collapsible Your Matches (Frontend Display Only)

**Date:** 23 November 2026
**Type:** One component changed (`frontend/src/components/Lobby.tsx`). Display behavior only — no list logic, no data flow, no contract or config changes. Post-freeze batch under the freeze rule, re-frozen on completion.
**Trigger:** Nino, looking at the live lobby: the Your Matches history could work like the PvP Mode section — openable and closable — so the lobby stays focused on starting a game.

## Change

- The **Your Matches** header is now a toggle button using the exact PvP Mode pattern (label + ▲/▼, same hover styling). It shows the match count once loaded, e.g. "Your Matches (8)", so the history's presence stays visible while closed.
- **Closed by default**, like PvP Mode. The auto-hide note, the match list, and the pagination render only while open.
- The win-streak badge and the **Refresh** button stay in the header row, visible in both states; Refresh still reloads the list (its icon spins while loading) whether the section is open or closed.
- Untouched: the 6.3.9 staleness filter, the 60-match enumeration, pagination (4 per page), Resume / View Result, and every other lobby element. The README's "Good to know" description of the list remains accurate as written.

## Verification

- `npx tsc --noEmit` — exit 0. `npm run build` — exit 0. `npx hardhat test` — 13 passing, 0 failing (contracts untouched; run for the freeze record).
- Locked-file MD5s unchanged.
- Live check after Nino's deploy: the lobby should open with Your Matches collapsed (count visible), expand on click with the full list and pagination, and collapse again.
