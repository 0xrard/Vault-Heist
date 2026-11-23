# Batch 6.3.1 — Hydration Fail-Closed Patch

Scope: frontend only. No contract changes, no ABI changes, no gameplay changes, no new features. This patch closes the two fail-open paths found in Nino's Batch 6.3 audit: a failed hydration was indistinguishable from a successful one, and an actual per-record save failure was invisible. The Batch 6.2 hash gate logic is unchanged.

## Why

1. **Hydration failed open (P0).** `ensurePendingTxHydrated(): Promise<void>` swallowed every failure in a try/catch and resolved as if successful. If `signer.getAddress()` or `readProvider.getNetwork()` threw transiently after a reload, both verification functions proceeded to the hash gate with an empty ref, the gate saw "no record", and a bare event scan could reopen LOCK IN / Scout over a transaction that was in fact still pending — the exact window Batch 6.3 existed to close. Worse, the settled (failed) promise stayed cached in `pendingTxHydrationRef`, so no retry for the life of that arena instance ever re-ran hydration.
2. **Save failures were invisible (P1).** `savePendingTx` returned void and swallowed `setItem` failures, so an actual save failure after a successful probe (quota filled mid-session, or a capture whose identity read failed and whose record was therefore declined) never reached the UI.

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/lib/pendingTxStorage.ts` | `savePendingTx` returns boolean; new tri-state loader `loadPendingTxResult`; `loadPendingTx` refactored into a behavior-preserving wrapper over it. |
| `frontend/src/components/GameArena.tsx` | Hydration returns an explicit per-kind result and fails closed in both checks; failed hydration is no longer cached; per-transaction persistence warning state + panel note driven by the actual save result. |
| `BATCH_6_3_1_CHANGELOG.md` | This file. |

No other files were modified.

## What changed, per item

### P0 — Hydration fails closed (GameArena)

- New types: `HydrationResult = { ok: true } | { ok: false; reason: "identity-unavailable" | "storage-unavailable" }` and `HydrationOutcome = { commit: HydrationResult; scout: HydrationResult }`. `ensurePendingTxHydrated()` now returns `Promise<HydrationOutcome>`.
- Identity read (`signer.getAddress()` / `readProvider.getNetwork()`) throwing returns `{ ok: false, reason: "identity-unavailable" }` for both kinds.
- The per-kind load uses the new tri-state loader (below): a storage read that itself throws yields `{ ok: false, reason: "storage-unavailable" }` for that kind; a successful read with no entry ("absent") or with a valid entry ("found") is `ok: true` — conclusively no persisted record for that context, or the record loaded into the ref.
- **Only a fully successful outcome stays cached.** A `.then` handler registered on the hydration promise before any caller's continuation clears `pendingTxHydrationRef` when either kind failed, so the next check or retry re-runs hydration from scratch. Callers of the failed run still receive the failed outcome and fail closed on it.
- Both checks branch on the outcome immediately after awaiting hydration and before the hash gate:
  - `restoreScoutStatus`: if the scout ref slot is empty and `hydration.scout` is not ok → `setScoutStatus("unknown")` and return. No gate consultation, no event scan.
  - `checkCommitStatus`: if the commit ref slot is empty and `hydration.commit` is not ok → `setCommitStatus("unknown")` and return. LOCK IN stays locked; the existing RETRY STATUS CHECK affordance re-runs the check, which re-runs hydration.
  - **In-session exemption:** a kind that already holds a record in its ref slot (captured this session, fresher than storage) is marked `ok: true` by hydration itself and proceeds to the gate from the in-memory record regardless of the storage read.
- The Batch 6.1 sequence guards still cover every await; the fail-closed writes happen only under `isLatest()`.

### P0 support — tri-state load (pendingTxStorage)

- `loadPendingTxResult(...)` returns `{ status: "found", record } | { status: "absent" } | { status: "error" }`. Only a throw from `localStorage.getItem` itself is `"error"`. A missing entry, an identity mismatch, or unparseable JSON is `"absent"`: the read succeeded, and the entry is conclusively not a valid record for this context (it is left untouched in storage, as before).
- `loadPendingTx(...)` keeps its exact previous public behavior (record or null) as a wrapper over the tri-state loader, for any other callers.

### P1 — Actual save result surfaces (pendingTxStorage + GameArena)

- `savePendingTx` returns `boolean`: `true` only when `setItem` actually succeeded; `false` when the identity is incomplete (save declined) or the write threw.
- `storeUnconfirmedTx` consumes the result into a new per-kind state `txPersistenceWarning`: a failed save sets the flag for that record's kind; a successful save clears it. `clearUnconfirmedTx` clears the flag through the same sanctioned clear path that removes the record.
- The unconfirmedTx panel renders an additional bold amber note when the displayed record's kind is flagged: "This transaction's recovery record could not be saved in this browser. Do not refresh until its status is confirmed." This is distinct from the addendum's probe-based standing warning; both may be visible at once.
- The capture path is covered by construction: `captureUnconfirmedTx` identity-read failure produces an incomplete-identity record, `savePendingTx` declines it and returns `false`, and the same warning appears — while the in-session gate keeps working from hash + nonce, exactly as in 6.3.

## Regression risks (honest assessment)

- **Fail-closed is the safe direction, but it can hold controls locked until a retry succeeds.** If a player's RPC is flaky at arena mount, commit/Scout sit at `unknown` until a retry's hydration succeeds. That is the intended trade (the alternative was reopening controls over a possibly-pending transaction), and both kinds keep their existing retry affordances; the rest of the game is unaffected.
- **Cache-clearing on partial failure re-runs loads for the healthy kind too.** Loads are idempotent reads keyed to one context; a kind that already holds a ref record is skipped. The cost is a few extra localStorage reads on retry, nothing else.
- **Microtask ordering assumption:** the cache-clearing `.then` is registered inside `ensurePendingTxHydrated` before callers attach their `await` continuations, so the ref is cleared before any subsequent check starts, while current callers still receive the failed outcome. This is standard promise ordering, verified by code reading, not by an instrumented runtime test.
- **Corrupt-entry classification:** an unparseable or identity-mismatched entry is treated as "absent" (hydration ok) rather than "error". Rationale: the storage read itself succeeded; a tampered or foreign entry is not evidence of a pending transaction for this context, and treating it as a storage failure would lock the arena over data that can never resolve. The entry is still never deleted by this arena.
- **Warning granularity:** the persistence warning is tracked per kind but rendered for the record the panel currently displays; if both kinds were unconfirmed and only the non-displayed kind failed to save, its note appears when that record becomes the displayed one. Both records' gates behave identically regardless of the note.

## Acceptance criteria (Nino's Batch 6.3.1 list) — by construction

| # | Scenario | Result | Deciding path |
| --- | --- | --- | --- |
| 1 | Commit pending → refresh | LOCK IN stays locked (unchanged from 6.3) | Hydration loads the persisted commit record; gate `blocked` while no receipt; LOCK IN enables only in `verified-uncommitted` |
| 2 | Scout pending → refresh | Scout stays locked (unchanged) | Same path via `restoreScoutStatus`; Scout enables only in `verified-unused` |
| 3 | Hydration transiently fails (identity or storage read) | BOTH controls stay locked at `unknown`; no bare event scan | Outcome is `ok: false` for the affected kind(s); both checks branch on it before the gate and return at `unknown` (GameArena lines ~404 / ~551, before the gate calls at ~414 / ~559) |
| 4 | RPC recovers → retry | Hydration re-runs, hash gate works, status resolves | Failed outcomes clear `pendingTxHydrationRef` on settle; the retry buttons re-run the checks, which re-run hydration |
| 5 | Probe succeeds but the actual record save fails | Per-transaction persistence warning appears | `savePendingTx` returns `false` → `storeUnconfirmedTx` sets `txPersistenceWarning[kind]` → panel note renders for that record |
| 6 | Different wallet | Previous wallet's record is not read (unchanged) | Storage key + full identity validation in the loader bind records to (sender, chain, contract, match, round) |
| 7 | Different match/round | Unaffected (unchanged) | Same keying/validation; App remounts the arena per `${matchId}-${round}` |
| 8 | Receipt success/failure | Record still resolves and clears correctly (unchanged) | Gate outcomes unchanged from 6.2; clears flow through `clearUnconfirmedTx`, which now also clears the persistence warning flag |

No live hydration-failure, pending-transaction, or RPC-failure simulation was run for this table; each row is satisfied by the code path named. The live versions (including a forced hydration failure and a forced save failure) remain Nino's manual QA.

## Verification (executed fresh on the final tree)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (frontend) | Exit 0 |
| `npm run build` (frontend) | Exit 0 (only the pre-existing >500 kB FHE WASM chunk warning) |
| `npx hardhat test` (project root) | 13 passing, 0 failing |
| Grep (a): explicit hydration result type; failed hydration not cached | `HydrationResult` / `HydrationOutcome` types present; failure reasons `identity-unavailable` / `storage-unavailable` produced; cache-clearing write `pendingTxHydrationRef.current = null` present in the settle handler |
| Grep (b): both checks branch on hydration before gate/scan | `!hydration.scout.ok` branch at GameArena ~404 precedes the scout gate call (~414); `!hydration.commit.ok` branch at ~551 precedes the commit gate call (~559) |
| Grep (c): savePendingTx boolean, consumed by storeUnconfirmedTx | `export function savePendingTx(...): boolean` in pendingTxStorage.ts; `const saved = savePendingTx(rec)` in GameArena, feeding `txPersistenceWarning` |

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

- The tri-state distinction is implemented as a new exported loader (`loadPendingTxResult`) used by hydration, with `loadPendingTx` kept as a wrapper — the cleaner of the two shapes the brief allowed, since it leaves every other caller's behavior byte-identical.
- Within the tri-state, only a `getItem` throw counts as `"error"`; corrupt or foreign entries count as `"absent"`. Rationale recorded under Regression risks.
