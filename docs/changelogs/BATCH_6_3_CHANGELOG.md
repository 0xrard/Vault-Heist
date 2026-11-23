# Batch 6.3 — Persistent Transaction Recovery

Scope: frontend only. No contract changes, no ABI changes, no gameplay changes, no UI redesign. This batch adds localStorage persistence underneath the Batch 6.2 hash-first gate; the gate logic itself is unchanged.

## Why

Batch 6.2 kept the unconfirmed-transaction record (`unconfirmedTx`) only in React state + a ref. A page refresh or browser crash while a commit/Scout transaction was still pending destroyed the record, the post-reload verification fell back to a bare event scan, the pending transaction had no event yet, and the UI could conclude "not done" and reopen the controls — the Batch 6.1 duplicate-transaction window, reopened by a reload.

## Files changed

| File | Change |
| --- | --- |
| `frontend/src/lib/pendingTxStorage.ts` | NEW. Persistence module for unconfirmed-tx records. |
| `frontend/src/components/GameArena.tsx` | `UnconfirmedTx` is now the full persisted record type; per-kind ref mirror; store/clear single door extended to storage; full-identity capture at the ambiguity paths; one-time hydration awaited by both verification functions before the hash gate. |
| `BATCH_6_3_CHANGELOG.md` | This file. |

No other files were modified.

## What changed, per item

### 1. `pendingTxStorage.ts` — identity-bound persistence

- Record: `{ kind, hash, nonce, matchId, round, sender, chainId, contractAddress, savedAt }`. Only public transaction metadata; never keys, signatures, or credentials.
- Key: `vaultheist:pendingtx:{chainId}:{contractAddress}:{matchId}:{round}:{sender}:{kind}` (addresses lowercased).
- `savePendingTx` refuses records without a complete, validatable identity (positive integer chainId, well-formed sender address); such records live only in session memory (exact Batch 6.2 behavior).
- `loadPendingTx` validates EVERY identity field inside the stored JSON against the requesting context (kind, hash format, integer nonce, matchId, round, sender, chainId, contractAddress). Any mismatch returns null and leaves the stored entry untouched — another wallet's, match's, or round's record is never read for this arena and never deleted by this arena.
- `clearPendingTx` removes exactly one context key and is only called from GameArena's sanctioned clear path (see item 2).
- All storage access is wrapped in try/catch: if localStorage is unavailable (private mode, quota), behavior degrades silently to Batch 6.2 in-memory semantics.

### 2. GameArena — one door for state, ref, and storage

- `UnconfirmedTx` now aliases the full `PendingTxRecord`. The ref mirror became per-kind (`unconfirmedTxByKindRef = { commit, scout }`) so a commit record and a Scout record are independent slots, exactly matching their independent storage keys; the panel state still displays a single record (the latest stored, or the hydrated one).
- `storeUnconfirmedTx` writes ref + localStorage + panel state together; `clearUnconfirmedTx` clears all three together. Deletion of the persisted record therefore happens only through the clear paths the Batch 6.2 gate already sanctions (receipt status 0; scan-strict with a matching event found; conclusive replacement branch). Blocked, inconclusive, not-found-in-strict-mode, and RPC-error outcomes never call the clear path, so the record survives them in storage too.
- `captureUnconfirmedTx` builds the full record at the Batch 6.1 ambiguity paths: sender and chainId are read from the signer/provider at capture time. If that read fails, the record carries an incomplete identity, the session gate still works from hash + nonce, and `savePendingTx` declines to persist it (degradation to 6.2).
- `ensurePendingTxHydrated()` runs once per arena instance (App remounts GameArena per `${matchId}-${round}`, so the context is always fresh). It loads both kinds for the current (chain, contract, matchId, round, wallet) context into the per-kind ref and seeds the panel state. Both `checkCommitStatus` and `restoreScoutStatus` await it before `consultTxHashGate` is consulted, so after a reload the record is already in the ref before any event conclusion can be taken — the same ordering as a live session. A record already stored in-session is fresher than storage and is not overwritten by hydration.
- The Batch 6.2 gate (`consultTxHashGate`: scan / scan-strict / blocked, receipt-first, nonce-aware replacement branch) is byte-for-byte the same logic; it now simply reads records that may have come from hydration instead of only from this session.

## Regression risks (honest assessment)

- **Stricter corner inherited and amplified from 6.2:** if the stored transaction was dropped and its nonce is later consumed by an *unrelated* transaction from the same wallet, the strict scan's conclusive not-found keeps the status `unknown` for that round, and — unlike 6.2, where a refresh dropped the in-memory record — the persisted record now survives refreshes too, so that one round of that one match stays locked in the UI until the gate can resolve it. This follows the batch's own rule (delete only on conclusive resolution) and is bounded to a single (match, round, wallet, kind) context; other matches and rounds are unaffected. Accepted as the conservative side of the trade-off; flagged here for the record.
- **Panel display nuance:** if both kinds are unconfirmed at once, both gates apply independently, but the panel displays one record (the most recently stored/hydrated). The hidden record's gate still locks its own controls.
- **Hydration cost:** one `signer.getAddress()` + one `getNetwork()` before the first verification of each arena mount. Failure is caught and degrades to 6.2 behavior; with RPC fully down, the Batch 6 scan-failure paths still land on `unknown`, so controls stay locked even if hydration itself could not run.
- **Storage footprint:** at most one small JSON per (context, kind); records for contexts never revisited stay stored but inert, because keying + full identity validation mean they can only ever load for that exact context.
- **Private-mode browsers:** localStorage unavailable → the refresh hole remains in that environment by necessity; in-session protection (6.1/6.2) is unaffected.

## Acceptance criteria (the Batch 6.3 list) — by construction

| # | Scenario | Result | Deciding path |
| --- | --- | --- | --- |
| A | Commit tx pending, page refreshed | LOCK IN stays locked after reload | Hydration loads the commit record into the ref before the first check (both checks await `ensurePendingTxHydrated`); gate returns `blocked` while no receipt exists, the event scan never runs, `commitStatus` stays `unknown`, and LOCK IN enables only in `verified-uncommitted` |
| B | Scout tx pending, page refreshed | Scout stays locked after reload | Same path via `restoreScoutStatus`; Scout enables only in `verified-unused` |
| C | Receipt status 1 appears in a later session | Status resolves, record deleted | Gate returns `scan-strict`; matching event found resolves to the verified state and `clearUnconfirmedTx` deletes the persisted record |
| D | Receipt status 0 in a later session | Failure confirmed, record deleted, true status set | Gate returns `clearRecord`; the clear path deletes storage; normal event verification then sets the true status |
| E | RPC down at reload | Statuses stay `unknown`, record persists, controls locked; retry after recovery resolves | Nothing deletes the record on RPC error (gate catch → `blocked`; scan failures → `unknown` per Batch 6); once RPC recovers, hydration + gate resolve normally |
| F | Wallet switched after reload | Other wallet's record has no effect | Storage key contains the sender and `loadPendingTx` validates the stored sender against the connected wallet; a different wallet loads nothing |
| G | Match/round moved on | Stale record has no effect | Key + identity validation bind a record to one (matchId, round); the new arena's context never matches it |

No live pending-transaction or RPC-failure simulation was run for this table; each row is satisfied by the code path named, and the live versions remain manual QA (send tx, leave pending, refresh, confirm controls stay locked; two-wallet PvP; Solo 3 rounds).

## Verification (executed fresh on the final tree)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` (frontend) | Exit 0 |
| `npm run build` (frontend) | Exit 0 (only the pre-existing >500 kB FHE WASM chunk warning) |
| `npx hardhat test` (project root) | 13 passing, 0 failing |
| Grep: persistence write/read/delete with all identity fields | Present in `lib/pendingTxStorage.ts` (save/load/clear, full-field validation on load) |
| Grep: hydration awaited before first verification | `ensurePendingTxHydrated()` awaited inside both `checkCommitStatus` and `restoreScoutStatus` |
| Grep: storage deletion paths | Only via `clearUnconfirmedTx` → `clearPendingTx`; no ad-hoc `removeItem` for this record anywhere |

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

- The ref mirror became per-kind rather than a single record (6.2 kept one record for both kinds). Reason: persisted records are inherently per-kind (independent storage keys), and a single-slot mirror would have let a Scout record evict a commit record from the ref while its storage entry survived, desynchronizing the three stores this batch exists to keep together. Panel behavior (one displayed record) is unchanged.

## Addendum — storage-unavailable warning (Batch 6.3 review)

Raised in review: when localStorage is unavailable, persistence silently degraded to Batch 6.2 in-memory behavior, so the UI could appear refresh-protected when it was not. Fix, same batch, no scope change:

- `pendingTxStorage.ts` exports `isPendingTxStorageAvailable()`: a real write/read-back/remove cycle on the dedicated key `vaultheist:pendingtx:__probe__` inside try/catch, true only if the full cycle succeeds; the result is cached at module level and the probe key is always removed. `savePendingTx`'s silent catch remains as a backstop; the UI is driven by the probe, not by save failures.
- `GameArena.tsx` computes the probe once per arena mount and, when storage is unavailable, renders an amber warning at the top of the arena (after the phase indicator, before the Syndicate bar), visible before any submission: "Browser storage is unavailable, so transaction recovery after a refresh is OFF in this browser. Do not refresh while a transaction is confirming."
- Deliberate decision: submissions are NOT hard-locked when storage is unavailable. The in-session gates (6.1/6.2) already lock the affected actions while a transaction's status is unsafe, and a refresh itself cannot be locked by any UI; the defect being fixed was the silent implication of protection. A hard pre-submit lock remains available as a follow-up if wanted.
- Verification after the addendum: `npx tsc --noEmit` exit 0, `npm run build` exit 0, `npx hardhat test` 13 passing / 0 failing (fresh runs), locked-file MD5s unchanged. The warning's appearance in a genuinely storage-blocked browser (e.g. private mode) is manually verifiable only and joins the live QA list.
