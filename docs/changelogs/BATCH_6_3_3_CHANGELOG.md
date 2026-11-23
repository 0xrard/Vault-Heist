# Batch 6.3.3 — Empty-String Record Correction (Final Hardening Patch)

A one-line correction from the Batch 6.3.2 audit. No changes to
architecture, state machine, gameplay, contracts, or ABI. This is the final patch in
the 6.x recovery hardening series; after this, the boundary for technical changes
is set and the work moves to final campaign QA.

## Files changed

| File | Change |
| --- | --- |
| frontend/src/lib/pendingTxStorage.ts | Line 141: `if (!raw)` becomes `if (raw === null)` in `loadPendingTxResult()` |
| BATCH_6_3_3_CHANGELOG.md | New (this document) |

GameArena.tsx is unchanged in this batch.

## Rationale

`localStorage.getItem()` has two results with different meanings:

- `null`: the key genuinely does not exist, so the `absent` classification is correct.
- `""`: the key EXISTS but its value is an empty string, i.e. a record that exists but
  is not valid.

The old condition `if (!raw)` treated both as `absent`, so
a transaction key with empty contents (corruption or data tampering) slipped
past the Batch 6.3.2 fail-closed protection: hydration was considered successful, the event
scan was allowed to run, and controls could potentially open while the original transaction
was still pending.

With `if (raw === null)`:

- `null` → `absent` (unchanged).
- `""` → proceeds to `JSON.parse("")`, throws SyntaxError → `invalid` →
  hydration fails closed + recovery warning (the existing 6.3.2 path).
- Other corrupt JSON → `invalid` (unchanged).
- Valid JSON, identity mismatch → `invalid` (unchanged).

## Regression risk

Minimal. The only behavior that changes is the classification of an empty
string: from `absent` to `invalid`. No write path
stores an empty string (`savePendingTx` always writes a complete JSON record
), so an empty value can only arise from corruption or external
interference — exactly the case that must fail closed.

## Acceptance

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Key does not exist (`null`) | `absent`, onchain verification proceeds as before | The `raw === null` condition, line 141 |
| 2 | Key exists, value is an empty string (`""`) | `invalid`, fail-closed + recovery warning | `""` does not pass the null check, enters `JSON.parse`; its deciding primitive was executed directly: `JSON.parse("")` throws SyntaxError (verified with node in this patch session), caught by the 6.3.2 parse path which returns `invalid` |
| 3 | Key exists, corrupt JSON | `invalid` (unchanged) | The 6.3.2 parse path |
| 4 | Key exists, valid JSON, identity mismatch | `invalid` (unchanged) | The 6.3.2 validation path |
| 5 | Key exists, valid record | `found` (unchanged) | The 6.3.2 validation path |

Live simulation (pending transaction + refresh, injected corrupt record,
storage failure) remains on the manual QA list and is not claimed
verified here.

## Verification (run in this patch session)

- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0 (only the pre-existing FHE WASM chunk
  size warning).
- Contracts: fresh `npx hardhat test` run, 13 passing, 0 failing.
- Regression primitive: `JSON.parse("")` confirmed to throw SyntaxError.
- Locked files identical before and after (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`
