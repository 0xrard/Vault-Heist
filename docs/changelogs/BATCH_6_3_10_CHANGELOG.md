# Batch 6.3.10 — Repo Hygiene Before Submission (Dead Files Only)

**Date:** 23 November 2026
**Type:** Deletion of provably dead files + one README clarification. No code behavior changes. Post-freeze batch under the freeze rule (new batch number + changelog + re-verification), re-frozen on completion.
**Trigger:** A repo-cleanliness review of the 6.3.9 freeze archive raised three notes: (1) apparent .js/.ts duplicates in `scripts/` and `test/`, (2) unused Vite template assets, (3) the size of `GameArena.tsx`. Each note was verified against the tree and a live test run before acting — one note turned out to be partly wrong, and acting on it blindly would have deleted live test coverage.

## Findings and actions

### 1a. `scripts/deploy.js` — DELETED (true duplicate)

`diff` against `scripts/deploy.ts` shows the two files are functionally identical; the only differences are CommonJS → ESM syntax and string concatenation → template literals. The README's deploy section already names `scripts/deploy.ts` as the entry point. The .js file was a stale pre-TypeScript-migration copy.

### 1b. The `test/*.js` files — KEPT (the note's assumption was wrong)

Running `npx hardhat test` and reading the test names proves all three files are live, complementary suites whose tests sum to the project's 13:

- `test/VaultHeist.test.ts` — 5 scenario tests (Matches A–E).
- `test/VaultHeist.test.js` — 5 numbered gameplay validations (Solo flow, Scout ACL, overflow, post-Scout budget, 3-round resolution).
- `test/ClootRewards.test.js` — 3 tests, and the ONLY coverage of cLOOT reward minting and balance confidentiality.

Deleting them would have cut the suite from 13 tests to 5 and removed the reward-token coverage entirely. Instead, the README's testing section now names all three files and what each covers, which resolves the reviewer's underlying concern (which files are active) at zero risk. Two scenarios (overflow bids) appear in both VaultHeist suites via different flows; consolidating them was deliberately not done — Preserve Working Systems.

### 2. Vite template assets — DELETED (confirmed unreferenced)

`frontend/src/assets/react.svg`, `vite.svg`, and `hero.png`: a reference search across `frontend/index.html`, `frontend/src/index.css`, and all of `frontend/src` returns zero usages. They were template leftovers, never imported by the UI. Deleted, along with the now-empty `assets/` directory.

### 3. `GameArena.tsx` (64,897 bytes) — NO ACTION, by design

Confirmed the size. Not refactored: the file carries the Batch 4–6.3 fail-closed verification architecture that passed the full live QA campaign, and the freeze principle is Preserve Working Systems. The pitch video script shows gameplay and Etherscan only — no source files appear on screen.

## Verification

- `npx hardhat test` after deletion — **13 passing, 0 failing** (identical to before; nothing live was removed).
- `npx tsc --noEmit` — exit 0. `npm run build` — exit 0 (the deleted assets were never in the bundle).
- Locked-file MD5s unchanged (contracts, fhe.ts, ABIs, .env).
