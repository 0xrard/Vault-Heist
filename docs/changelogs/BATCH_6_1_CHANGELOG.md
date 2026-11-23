# Vault Heist — Batch 6.1 Changelog: Final Reliability Patch

Date: 2026-11-21. Scope: frontend only. No smart contract changes, no
ABI changes, no redeployment. Batch 6.1 is the closing patch from the
owner's review of Batch 6 ("conditionally accepted"): Batch 6 fixed the
event filter and both sync gates, but the review found that the Scout
budget could still desync from the contract while Scout status was
unverified, that a broadcast-but-unconfirmed transaction could restore
the pre-submit UI state and invite a duplicate transaction, and that
the two Batch 6 verification functions had no staleness guard. This
patch closes those three gaps and nothing else; no features were added.
The Batch 4–6 design principles are preserved throughout: the
blockchain is the source of truth, localStorage is cache only, an
inconclusive result is never treated as "not done", and no fix works by
removing or bypassing verification.

## 1. Files changed

| File | Change |
| --- | --- |
| `frontend/src/components/GameArena.tsx` | **P0.** The budget cap is now conservative while Scout status is unverified: `scoutBudgetUncertain = scoutStatus === "syncing" \|\| scoutStatus === "unknown"`, and `maxBudget = scoutUsed \|\| scoutBudgetUncertain ? BASE_BUDGET - 1 : BASE_BUDGET`. Only `verified-unused` unlocks the full 10. A HUD note ("Scout status is unverified. A conservative 9-agent budget is applied until synchronization completes.") is shown when the cap is due to uncertainty rather than a known Scout use, and the phase indicator now compares `total` against the effective `maxBudget` instead of a hard-coded 10. **P1 (transaction ambiguity).** `handleSubmit` and `handleScout` now capture the transaction object in an inner try/catch around send + `tx.wait()`: a failure before a hash exists is rethrown to the existing outer catch unchanged, while a failure after the hash exists forces the respective status to `unknown`, stores the hash in a new `unconfirmedTx` state, and renders it as a Sepolia Etherscan link in a new status panel that tells the player not to resend and to use the retry status check. A conclusive verification of the same kind clears the stored hash. **P1 (async safety).** `checkCommitStatus` and `restoreScoutStatus` each take a sequence number from their own ref counter (`commitCheckSeq` / `scoutCheckSeq`) on every invocation and check `isLatest()` after every `await`; only the latest invocation may write state, and each mount effect's cleanup increments its counter so changing match/round or unmounting invalidates in-flight checks. |
| `BATCH_6_1_CHANGELOG.md` | This file (new). |

No other files were created or modified. In particular, `VaultCard.tsx`
needed no change: its "Retry check" button renders only in the
`unknown` gate state, and starting a check moves the gate to `syncing`,
so the button unmounts for the duration of the check; the commit
panel's RETRY STATUS CHECK behaves the same way (the panel renders
only in `unknown`, a retry moves the status to `checking`). Retry
therefore cannot be double-fired from the UI, and the sequence guards
cover any residual overlap. The following locked files are
byte-identical before and after (see section 5):
`contracts/VaultHeist.sol`, `contracts/HeistLootToken.sol`,
`frontend/.env`, `frontend/src/lib/fhe.ts`,
`frontend/src/abi/VaultHeist.json`, `frontend/src/abi/HeistLootToken.json`.

## 2. Reason for each change

- **Conservative budget (P0).** The contract computes
  `maxBudgetPlain = scouted ? BASE_CREW - 1 : BASE_CREW`
  (`VaultHeist.sol:190`), and `_validateBudget` (lines 241–243) zeroes
  ALL bids via `FHE.select` when the submitted total exceeds the cap,
  while the transaction itself still succeeds. Before this patch the UI
  cap depended only on locally known Scout use, so with Scout status
  `syncing` or `unknown` and an empty cache (for example after the
  player cleared site data) the UI offered 10 agents while the contract
  cap was already 9: a 4+3+3 allocation would have been silently zeroed
  onchain and the player would have lost the round without any error.
  The conservative cap trades at most one temporarily unavailable agent
  against the loss of an entire round's allocation.
- **Transaction receipt ambiguity (P1).** Both handlers previously ran
  send + `tx.wait()` inside a single try/catch, so a transaction that
  was broadcast (and possibly already mined) but whose receipt could
  not be read fell into the generic error path and left the pre-submit
  status in place: LOCK IN or the Scout buttons could re-enable and
  invite a duplicate transaction. The handlers now distinguish the two
  failure classes by whether a transaction hash exists. Pre-hash
  failures (wallet rejection such as ACTION_REJECTED / 4001, or a send
  error) keep the previous behavior exactly. Post-hash failures force
  the status machine into `unknown`, which keeps the controls locked,
  surfaces the existing event-based retry, and shows the hash as an
  Etherscan link. Nothing is ever auto-resubmitted; the
  `AllocationCommitted` / `VaultScouted` event scan decides the real
  status, including the mined-but-reverted case, which a conclusive
  not-found resolves back to `verified-uncommitted` / `verified-unused`.
- **Async safety (P1).** Batch 6 deliberately removed the `cancelled`
  flag from the mount checks (safe under per-round remounting, as
  documented there), but it left one hole: two invocations of the same
  check (StrictMode double-effects in development, or a retry racing
  the mount check in production) could complete out of order, letting
  an older chain snapshot overwrite a newer result in state that gates
  whether the player may transact. The per-check sequence counters
  make stale completions no-ops, independently for the commit and
  Scout checks, and the effect cleanups invalidate in-flight checks
  when the arena instance's match or round changes.

## 3. Regression risks (honest assessment)

- **The conservative cap also applies during the brief initial
  `syncing` window of every arena mount.** A player whose Scout is
  genuinely unused sees a cap of 9 until the mount verification
  settles (normally seconds). If they lock in exactly 9 during that
  window in a round where 10 would have been allowed, they field one
  fewer agent that round. This is the accepted price of the P0 fix,
  and the HUD note explains the cap while it applies. The cap lifts to
  10 automatically when verification returns `verified-unused`; no
  action is needed from the player.
- **Phase indicator semantics shifted slightly.** Phase 1 ("ready to
  lock in") is now reached at `total === maxBudget`, so during the
  conservative window a total of 9 shows phase 1 instead of phase 2.
  This is cosmetic and consistent with the effective cap.
- **A mined-but-reverted transaction is reported as "sent but
  unconfirmed"** until the event retry runs, even though its receipt
  technically exists. The panel copy stays accurate (confirmation could
  not be established by the app), and one retry click resolves the
  status conclusively. Accepted simplification; the alternative
  (parsing revert receipts out of `tx.wait()` errors) would add a
  second, less reliable source of truth beside the event scans.
- **A hung RPC leaves a gate in `syncing` / `checking`** until the
  check settles, because the retry affordances render only in the
  `unknown` state. This is unchanged Batch 6 behavior for the mount
  checks; the sequence guards do not make it worse (a settled failure
  still lands in `unknown` with its retry), and a page refresh always
  restarts verification.
- **The unconfirmed-transaction panel persists** until a conclusive
  verification of the same kind clears it. If the player never
  retries, the panel (and the locked controls) stay as a standing
  reminder rather than timing out into a guess. Intended.
- **The hash capture assumes ethers v6 semantics**: the send call
  resolves with a transaction response (carrying `.hash`) before
  `wait()` can fail. That is the pinned ethers version's behavior and
  is what the code was written and type-checked against; a hypothetical
  future version that threw synchronously with the hash attached to the
  error object would take the pre-broadcast branch instead.

## 4. Build results (frontend)

- `npx tsc --noEmit` in `frontend/`: exit 0.
- `npm run build` in `frontend/`: exit 0. The only output of note is
  the pre-existing >500 kB chunk-size warning from the FHE WASM bundle,
  unchanged since Batch 2. (During development, the build's `tsc -b`
  step flagged a `disabled={commitStatus === "checking"}` comparison
  on the retry button as unreachable, TS2367, because the panel renders
  only in the `unknown` state; the attribute was removed as dead code
  and the final tree passes both `tsc --noEmit` and the full build.)

## 5. Test results and self-checks

- `npx hardhat test` at the project root (fresh run for this batch):
  exit 0, **13 passing, 0 failing**.
- Locked-file MD5, identical before and after this patch:
  `VaultHeist.sol` 8b924078…, `HeistLootToken.sol` ac30a967…,
  `frontend/.env` 3d3fdb9b…, `fhe.ts` b92c0c3b…,
  `VaultHeist.json` ABI 4b90e7ad…, `HeistLootToken.json` ABI 31f13e0f….
- Grep (a), conservative budget: `scoutBudgetUncertain` is computed
  from `scoutStatus === "syncing" || scoutStatus === "unknown"`
  (GameArena.tsx:289) and feeds the `maxBudget` computation (line 290).
- Grep (b), transaction ambiguity: the `unconfirmedTx` state (line 69),
  `let tx: any = null` capture plus `setUnconfirmedTx({ kind: "scout",
  hash: tx.hash })` in `handleScout` (lines 431–438) and the matching
  `kind: "commit"` path in `handleSubmit` (lines 529–537) are present,
  as are the conclusive-verification clears (lines 155, 165, 247).
- Grep (c), sequence guards: `commitCheckSeq` / `scoutCheckSeq` refs
  (lines 70–71), `isLatest()` checks after every `await` in both
  functions (lines 113–125, 192, 227–241, 255), and both effect
  cleanups incrementing their counter (lines 202, 264).
- No new em dash characters in UI strings: the two new user-visible
  strings (the conservative-budget note and the unconfirmed-transaction
  panel) contain none.

### Acceptance scenarios (owner's table)

Evidence standard: the frontend has no automated UI test harness, so
each row is satisfied **by construction in code**, with the deciding
code path named. No live-RPC failure simulation was run for this batch;
the rows that depend on real RPC behavior remain part of the owner's
manual pass (section 6).

| # | Scenario | Required outcome | How it is satisfied |
| --- | --- | --- | --- |
| 1 | Scout used onchain, cache gone, RPC fails | Max budget 9 | `findScoutOnchain` returns inconclusive (null), `restoreScoutStatus` lands in `unknown` with no cache to restore; `scoutBudgetUncertain` is true, so `maxBudget` is 9 (GameArena.tsx:289–290). By construction. |
| 2 | Scout not used, RPC fails | Conservative budget 9 | Same path: the status is `unknown` regardless of the (unknowable) onchain truth, so the cap is 9 until verification succeeds. By construction. |
| 3 | Commit tx sent, receipt times out | LOCK IN stays locked | `handleSubmit`'s inner catch sees a non-null tx, sets `commitStatus` to `unknown` and stores the hash (lines 529–541). LOCK IN renders only when not waiting/finished and is disabled unless `commitStatus === "verified-uncommitted"`; allocation controls lock via the same condition. The RETRY STATUS CHECK panel and the Etherscan hash panel both render. By construction. |
| 4 | Scout tx sent, receipt times out | Scout stays locked | `handleScout`'s inner catch sets `scoutStatus` to `unknown` and stores the hash (lines 431–442). `handleScout` refuses to run from any status but `verified-unused`, and VaultCard disables the Scout buttons unless the gate is `ready`; the `unknown` gate shows the per-card Retry check. By construction. |
| 5 | Older scan finishes after a newer one | Older result ignored | Each invocation captures `seq = ++<counter>` and re-checks `isLatest()` after every `await` before writing any state; the older invocation's writes are skipped, including its error path. By construction (lines 113–125, 192, 227–241, 255). |
| 6 | RPC recovers | Status verifies, UI returns to normal | RETRY STATUS CHECK and the per-card Retry check re-run the same named verification functions; a conclusive result restores `committed` / `verified-uncommitted` / `verified-used` / `verified-unused` and clears the stored unconfirmed hash for that kind. By construction. |
| 7 | All conditions normal | Budget returns to 10 when Scout is verified-unused | A conclusive not-found sets `verified-unused`; `scoutUsed` is false and `scoutBudgetUncertain` is false, so `maxBudget` is `BASE_BUDGET` (10) and the conservative note disappears. By construction. |

## 6. Not covered by automated verification

Still the owner's live pass, unchanged in kind from Batch 6: refresh
after commit; RPC failure during commit verification (unknown panel,
retry recovery); RPC failure during Scout verification; Scout used but
localStorage cleared (budget must now read 9 while status is unknown,
and 10 only after a conclusive not-found); Scout restored after
refresh; the unconfirmed-transaction flow under a real receipt timeout
for both commit and Scout; two-wallet PvP played to completion; Solo
mode across three rounds. None of these are claimed as verified here.
