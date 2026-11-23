# Batch 6.3.2 — Invalid-Record Fail-Closed

Scope: frontend only. No contract changes, no ABI changes, no gameplay changes. This is the final hardening Nino recommended in his Batch 6.3.1 review (accepted batch; this item was P1, recommended, not a blocker). It distinguishes a persisted record that EXISTS but cannot be trusted from one that is genuinely absent, and aligns the standing storage warning copy with the fail-closed behavior. The Batch 6.2 hash gate and the 6.3.1 fail-closed hydration design are unchanged.

## Why

Batch 6.3.1's tri-state loader (`found` / `absent` / `error`) classified a present-but-unusable entry as `absent`: if the entry under the context key had corrupt JSON, or parsed but failed any identity/format validation, the load fell through to `absent`, hydration concluded "conclusively no record", and verification proceeded to the event scan. For a transaction-recovery system, "no entry" and "an entry exists but cannot be trusted" are different facts. The second one is not evidence that no transaction is pending, so treating it as absence could reopen controls on top of an unverifiable record. Additionally, the standing storage-unavailable warning (6.3 addendum) still described the pre-6.3.1 behavior ("recovery after a refresh is OFF... do not refresh"), understating that with storage reads failing, fail-closed hydration now keeps verification-dependent actions locked.

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/lib/pendingTxStorage.ts` | `PendingTxLoadResult` gains a fourth status, `invalid`; parse failure and validation failure of an existing entry now return `invalid` instead of `absent`. |
| `frontend/src/components/GameArena.tsx` | Hydration maps `invalid` to a new fail-closed reason, `invalid-record`; new per-kind `hydrationWarning` state + amber recovery note in the arena; standing storage-unavailable warning copy revised to match fail-closed behavior. |
| `BATCH_6_3_2_CHANGELOG.md` | This file. |

No other files were modified.

## What changed, per item

### 1. `invalid` status (pendingTxStorage)

- `loadPendingTxResult` classification is now:
  - `getItem` returns null → `absent` (unchanged).
  - `getItem` throws → `error` (unchanged).
  - An entry EXISTS but `JSON.parse` throws → `invalid` (was `absent`).
  - An entry EXISTS, parses, but fails ANY identity/format validation (kind, hash format, nonce, matchId, round, sender, chainId, contractAddress, savedAt) → `invalid` (was `absent`).
  - An entry exists and validates → `found` (unchanged).
- The lookup is by the exact context key, so `invalid` can only trigger for this context's own entry. The loader never deletes or rewrites the entry; an invalid entry is left untouched in storage, exactly as before.
- `loadPendingTx` (the public wrapper) is behavior-compatible for other callers: `found` → record; `absent` / `error` / `invalid` → null. Its only in-tree caller relationship is unchanged (the hydration path uses `loadPendingTxResult` directly).

### 2. Hydration fails closed on `invalid` (GameArena)

- `HydrationResult` failure reasons are now `"identity-unavailable" | "storage-unavailable" | "invalid-record"`. In `ensurePendingTxHydrated`, a kind whose load returns `invalid` gets `{ ok: false, reason: "invalid-record" }`.
- Consequences are identical to the other hydration failures: in `restoreScoutStatus` and `checkCommitStatus`, an empty ref slot plus a not-ok hydration for that kind sets/keeps the status at `unknown` and returns before the hash gate is consulted and before any event scan runs. The 6.3.1 settle handler already clears the cached hydration promise on any not-ok outcome, so a retry genuinely re-attempts hydration (and re-reads the entry).
- New per-kind state `hydrationWarning = { commit, scout }`: a check that fails closed with reason `invalid-record` sets its kind's flag; a subsequent check whose hydration for that kind is `ok` clears it. One amber note renders in the arena (directly under the standing storage warning, same styling) when either flag is set:

  > "A saved transaction recovery record could not be validated, so actions stay locked for safety until it can be verified."

### 3. Standing warning copy aligned (GameArena)

- The storage-unavailable warning no longer claims merely that refresh recovery is off. New copy:

  > "Browser storage is unavailable in this browser. Transaction status cannot be verified safely, so actions that need verification stay locked, and refreshing while a transaction is confirming is unsafe."

- Same placement (top of the arena, before any submission) and same amber styling. The comment above it was updated to state that the locking comes from the fail-closed hydration path, not from the warning element itself.

## Regression risks (honest assessment)

- **Permanently locked kind within a match/round context:** a genuinely corrupt entry (e.g. storage corruption, a hand-edited value, or a future format change writing an incompatible shape under the same key) now keeps that kind at `unknown` for that (chain, contract, match, round, wallet) context until the entry becomes valid again or the context changes. This is the intended fail-closed trade-off Nino specified; it is bounded to one round of one match for one wallet, and the recovery note tells the player why. There is still no code path that deletes an invalid entry, by design (the loader's hands-off rule from 6.3 is preserved).
- **Retry cost:** an invalid entry makes every retry re-run hydration and re-read storage before failing closed again. This is one localStorage read per kind per check, negligible, and it is what allows recovery if the entry is repaired or replaced by a fresh valid save.
- **Warning overlap:** in a browser where storage reads throw, the standing warning (revised copy) shows; the invalid-record note cannot trigger in that same browser because reads never reach the parse/validation stage (they return `error`). The two notes are therefore effectively mutually exclusive in practice, and both may never show together except in mixed failure modes (probe passes, later reads succeed but entry is corrupt → only the invalid note; probe result is cached from mount).
- **No behavior change on the happy paths:** `absent`, `found`, and `error` handling, the hash gate, the state machines, the conservative budget, and all Batch 1–6.3.1 features are untouched. The wrapper `loadPendingTx` returns identical results for every input as before this batch (invalid previously surfaced as null via `absent`; it still surfaces as null).

## Acceptance criteria (Nino's Batch 6.3.2 list) — by construction

| # | Scenario | Result | Deciding path |
| --- | --- | --- | --- |
| 1 | No entry under the context key | `absent`; verification proceeds onchain as before | `getItem` returns null → `{ status: "absent" }` → hydration `ok: true` for that kind → gate/scan run exactly as in 6.3.1 |
| 2 | Entry exists, corrupt JSON | `invalid` → fail-closed + recovery warning | `JSON.parse` throw is caught separately and returns `{ status: "invalid" }` (pendingTxStorage.ts, parse branch) → hydration maps it to `{ ok: false, reason: "invalid-record" }` → check sets `unknown`, returns before gate/scan, and sets the kind's `hydrationWarning` flag → amber note renders |
| 3 | Entry exists, identity mismatch | `invalid` → same fail-closed + warning | Full identity validation runs after a successful parse; any field failing falls through to `return { status: "invalid" }` → same hydration/check/warning path as row 2 |
| 4 | Entry exists and valid | `found`; 6.3 behavior unchanged | Validation passes → `{ status: "found", record }` → hydration loads it into the per-kind ref → hash gate decides, as in 6.3 |
| 5 | `getItem` throws | `error`; 6.3.1 fail-closed unchanged | The `getItem` try/catch is untouched and still returns `{ status: "error" }` → hydration reason `storage-unavailable` → same fail-closed branch |
| 6 | Standing warning copy vs behavior | Copy matches fail-closed behavior | Standing warning now reads "...Transaction status cannot be verified safely, so actions that need verification stay locked, and refreshing while a transaction is confirming is unsafe." (GameArena render, verified by grep; the old "recovery after a refresh is OFF / Do not refresh" copy is gone) |

No live simulation (corrupt-entry injection, storage-blocked browser, pending transaction + refresh) was run for this table; each row is satisfied by the code path named, and the live versions remain Nino's final QA list.

## Verification (executed fresh on the final tree)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (frontend) | Exit 0 |
| `npm run build` (frontend) | Exit 0 (only the pre-existing >500 kB FHE WASM chunk warning) |
| `npx hardhat test` (project root) | 13 passing, 0 failing |
| Grep (a): four-status type + both `invalid` returns | `PendingTxLoadResult` includes `{ status: "invalid" }`; parse-failure branch returns it (pendingTxStorage.ts:150) and the validation fall-through returns it (pendingTxStorage.ts:184) |
| Grep (b): hydration maps `invalid` | `outcome[kind] = { ok: false, reason: "invalid-record" }` in `ensurePendingTxHydrated`; reason present in the `HydrationResult` union; both checks test `hydration.<kind>.reason === "invalid-record"` |
| Grep (c): recovery warning render | Note renders under `(hydrationWarning.commit \|\| hydrationWarning.scout)` with the exact copy above (GameArena.tsx:1039–1043) |

## Locked files (MD5, identical before/after)

| File | MD5 |
| --- | --- |
| `contracts/VaultHeist.sol` | `8b9240785791a1dfcf87e21a925d1b71` |
| `contracts/HeistLootToken.sol` | `ac30a967b2a670c1f46c7018cfa7085e` |
| `frontend/.env` | `3d3fdb9b2b89541503ef2b6c3095a1aa` |
| `frontend/src/lib/fhe.ts` | `b92c0c3b6cbb05a7818521692fe8a449` |
| `frontend/src/abi/VaultHeist.json` | `4b90e7ad0763543259f54cfd98803e63` |
| `frontend/src/abi/HeistLootToken.json` | `31f13e0ff2b88fb3d2e9b76d9ffc3b4b` |

## Deviations

- The recovery warning state is per-kind (`{ commit, scout }`, mirroring `txPersistenceWarning`) rather than a single boolean, so a kind whose hydration later succeeds clears only its own flag and cannot hide the other kind's still-active invalid state. The rendered note is still a single element, as specified.
- Within the loader, the parse step was split into its own try/catch so a parse throw returns `invalid` directly instead of sharing the validation fall-through. Same outcomes, clearer deciding paths for audit.
