# Batch 6.3.7 — Loot & Alarm Limit Range Numbers Enlarged

**Date:** 23 November 2026
**Type:** Pure visual readability fix (one file, one CSS class line). No logic changes, no contract changes.
**Trigger:** Nino's note from a QA screenshot (match #15): the range numbers on the Loot ("30–93") and Alarm Limit ("6–13") rows of the vault cards were too small and too dim to read.

## Root cause

In `VaultCard.tsx` (the `StatRow` component, sealed branch), the range was rendered as:

```
<span className="font-mono text-[10px] text-slate-600">{range}</span>
```

At 10px in slate-600 against a dark background, it looked like a dim superscript next to the label — exactly what the screenshot showed.

## Change

The only use of that pattern in the entire frontend (confirmed by grep: 1 occurrence):

- `frontend/src/components/VaultCard.tsx` line 110:
  `font-mono text-[10px] text-slate-600` → `font-mono text-sm font-semibold text-slate-300`

The numbers are now 14px semibold slate-300 — readable in line with their labels. The revealed branch (Scout results) is untouched: its value already displays large (`text-lg`) and the range is not rendered in that branch at all.

There is no functional regression risk: the change is only a presentation class on a single span element; no state, handler, or DOM structure changes (the range stays inline inside the same label span, so the row layout does not shift apart from the slightly wider number text).

## Verification (run from the local tree, 23 Nov 2026)

- `npx tsc --noEmit` in `frontend/` — exit 0.
- `npm run build` — exit 0 ("✓ built in 3.02s").
- Contracts untouched (pure frontend patch); the hardhat suite is unaffected (13 passing last verified on 6.3.6; no contract/ABI files changed).
- Locked-file MD5s — identical to baseline:
  - `contracts/VaultHeist.sol` — `8b9240785791a1dfcf87e21a925d1b71`
  - `contracts/HeistLootToken.sol` — `ac30a967b2a670c1f46c7018cfa7085e`
  - `frontend/.env` — `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - `frontend/src/lib/fhe.ts` — `b92c0c3b6cbb05a7818521692fe8a449`
  - `frontend/src/abi/VaultHeist.json` — `4b90e7ad0763543259f54cfd98803e63`
  - `frontend/src/abi/HeistLootToken.json` — `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Status

Done in the local tree. Not yet zipped and not yet deployed to production — awaiting Nino's request (zip rule: a zip is made only when requested).
