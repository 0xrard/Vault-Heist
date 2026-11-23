# Batch 6.3.15 — Disclaimer Pinned to the Bottom (Frontend Layout Only)

**Date:** 23 November 2026
**Type:** Two class changes in `frontend/src/App.tsx`. Layout only — no logic, no content, no other component touched. Post-freeze batch under the freeze rule, re-frozen on completion.
**Trigger:** After deploying 6.3.14, the lobby showed the problem: with Your Matches collapsed the page is short, and the "not audited / endorsed by Zama" disclaimer floated up directly under the card, leaving a void beneath it. The ruling: the disclaimer stays at the bottom; it must not ride up.

## Change

- The app root is now a full-height flex column: `flex min-h-screen flex-col` (was `min-h-screen` only).
- The footer carries `mt-auto`, which pushes it to the bottom of the viewport whenever the page content is shorter than the screen, and lets it follow the content naturally on longer pages (arena, expanded history).

## Verification

- `npx tsc --noEmit` — exit 0. `npm run build` — exit 0. `npx hardhat test` — 13 passing, 0 failing (contracts untouched; run for the freeze record).
- Locked-file MD5s unchanged.
- Live check after deploy: on the lobby with Your Matches collapsed, the disclaimer sits at the very bottom edge of the screen; in the arena it sits after the content as before.
