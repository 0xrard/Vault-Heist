# Vault Heist — Batch 6.2 Changelog: Pending-Transaction Gate

Date: 2026-11-21. Scope: frontend only. No smart contract changes, no
ABI changes, no UI redesign, no new features, no redeployment. Batch 6.2
is a single-issue patch from the owner's review of Batch 6.1 ("accepted
as a major improvement, but the transaction recovery system is not final
until the pending-transaction hole is closed"). Batch 6.1 correctly
forced the related status to `unknown` and stored the transaction hash
when `tx.wait()` failed after broadcast, but the retry and mount
verifications still concluded purely from event scans up to the latest
block, and a conclusive scan cleared the stored hash. A transaction that
is still pending has no event yet, so the scan could conclusively report
"not found" and reopen LOCK IN / Scout while the original transaction
could still execute later — a duplicate-transaction window. This patch
closes exactly that hole with hash-first gating, and nothing else. The
Batch 4–6.1 design principles are preserved throughout: the blockchain
is the source of truth, localStorage is cache only, an inconclusive
result is never treated as "not done", and no fix works by removing or
bypassing verification.

## 1. Files changed

| File | Change |
| --- | --- |
| `frontend/src/components/GameArena.tsx` | **Hash-first gate.** The `unconfirmedTx` record now stores the sender nonce as well (`{ kind, hash, nonce }`), captured from the transaction response in the Batch 6.1 ambiguity paths of `handleSubmit` / `handleScout`. A ref mirror (`unconfirmedTxRef`) plus single-door helpers (`storeUnconfirmedTx` / `clearUnconfirmedTx`) keep state and ref identical. A new `consultTxHashGate(kind, sender)` helper is consulted at the top of both verification flows (`checkCommitStatus`, `restoreScoutStatus`) whenever a record of that kind exists: it checks the receipt by hash first (`readProvider.getTransactionReceipt`), then the transaction itself (`getTransaction`), then nonce consumption (`getTransactionCount`) for the dropped/replaced case, and returns `scan` / `scan-strict` / `blocked` (see section 2). In `blocked` mode the event scan is not run at all and the status stays `unknown` with the record kept. In `scan-strict` mode the event scan runs but only a matching "found" result may resolve the status and clear the record; a conclusive not-found is treated as inconsistent and the status stays `unknown`. In `scan` mode (no record, or a status-0 receipt that already cleared the record) verification behaves exactly as in Batch 6/6.1. The existing `unconfirmedTx` panel copy minimally distinguishes the still-pending case ("is still pending and has not been mined yet") via a new `unconfirmedTxPending` flag set from the gate's last result. All gate awaits sit inside the Batch 6.1 sequence guards (`isLatest()` is re-checked immediately after the gate resolves, before any state write from the scan). |
| `BATCH_6_2_CHANGELOG.md` | This file (new). |

No other files were created or modified. The following locked files are
byte-identical before and after (see section 5):
`contracts/VaultHeist.sol`, `contracts/HeistLootToken.sol`,
`frontend/.env`, `frontend/src/lib/fhe.ts`,
`frontend/src/abi/VaultHeist.json`, `frontend/src/abi/HeistLootToken.json`.

## 2. Reason for each change

- **The pending-transaction hole (the only reason for this batch).**
  Event scans can only see mined transactions. Between broadcast and
  mining there is a window in which a conclusive event scan is
  guaranteed to say "not found" even though the action is about to
  happen onchain. Batch 6.1's recovery path treated that conclusive
  not-found as proof the ambiguous transaction never landed, cleared
  the hash, and restored `verified-uncommitted` / `verified-unused`,
  reopening the very controls the ambiguity handling had locked. The
  only witness that can distinguish "pending" from "failed" in that
  window is the transaction itself, addressed by its hash — so the
  hash is now consulted before any event conclusion is allowed to
  reopen controls or clear the record.
- **Nonce stored at capture time.** If the provider no longer knows
  the hash (dropped from the mempool, or replaced by a wallet speed-up
  under the same nonce), the receipt and transaction lookups both come
  back empty and cannot decide the case. The sender's nonce can:
  `getTransactionCount(sender)` (mined count) greater than the stored
  nonce proves some transaction with that nonce was mined. That is the
  replacement branch: the conclusive event result then decides, but in
  strict mode, because a mined replacement of the same action should
  have produced the event — if it did not, something is inconsistent
  and the UI must not guess. If the nonce is not consumed and the hash
  is simply unknown, failure is never assumed; the gate stays blocked.
- **Ref mirror for the record.** The verification functions run from
  mount-effect closures and retry buttons; reading the record from a
  ref guarantees the gate always sees the record as captured in this
  session, never a stale render closure.
- **Gate returns decisions, callers write state.** `consultTxHashGate`
  performs only provider reads and returns `{ gate, pending,
  clearRecord }`. The callers apply `clearRecord` and the pending flag
  only after their Batch 6.1 `isLatest()` check, so the new awaits are
  covered by the same sequence guards as the event scans, and retry
  buttons keep their structural cannot-double-fire property (the
  panels that contain them unmount as soon as a check starts).

Decision flow as implemented (per kind, when a record exists):

| Hash evidence | Gate | Verification behaviour |
| --- | --- | --- |
| Receipt exists, `status === 1` | `scan-strict` | Event scan runs. Found (my commit this round / my Scout this round) → verified state, record cleared. Inconclusive, or conclusive not-found → stays `unknown`, record kept. |
| Receipt exists, `status === 0` | `scan` (+ `clearRecord`) | The action definitively failed; record cleared, then the normal Batch 6/6.1 event verification establishes the true status. |
| No receipt, `getTransaction` returns the tx | `blocked` (pending) | Stays `unknown`, record kept, event scan not run, panel copy says the transaction is still pending. |
| No receipt, tx not found, nonce consumed by a mined tx | `scan-strict` | Replacement branch: conclusive event result decides, strictly (not-found stays `unknown`). |
| No receipt, tx not found, nonce not consumed | `blocked` | Stays `unknown`, record kept; failure is never assumed. |
| Any RPC error during the hash checks | `blocked` | Stays `unknown`, record kept. |
| No record of this kind | `scan` | Exactly the Batch 6/6.1 pure event-scan behaviour. |

## 3. Regression risks (honest assessment)

- **Extra RPC calls per verification while a record exists.** Each
  retry/mount check for the affected kind now costs one
  `getTransactionReceipt`, plus `getTransaction` and possibly
  `getTransactionCount` when no receipt exists. This only happens while
  an unconfirmed-transaction record exists (an abnormal state), and the
  reads go through the same public Sepolia RPC as all other reads. A
  failing RPC degrades the gate to `blocked` (locked), never to open.
- **A permanently pending or dropped transaction keeps the controls
  locked until it resolves.** That is the intended trade-off of this
  batch (the same philosophy as the Batch 6.1 conservative budget): the
  player can keep playing the rest of the game, can watch the hash on
  Etherscan from the panel, and can retry; what they cannot do is send
  a second transaction on top of an unresolved one. If a wallet-side
  replacement with the same nonce is mined, the nonce branch plus the
  event scan resolve the state on the next retry. If the transaction
  is dropped and its nonce is later consumed by an unrelated
  transaction, the strict event scan decides; a conclusive not-found
  then keeps the status `unknown` rather than reopening, and recovery
  is a page refresh (the record is in-memory session state) — noted as
  a known conservative corner, accepted over reopening unsafely.
- **`getTransactionCount` semantics.** The gate uses the default
  ("latest", mined) transaction count. A replacement that is itself
  still pending does not consume the nonce in this count, so the gate
  stays `blocked` until it mines — correct, because the original
  action may still land via the replacement.
- **Receipt `status` values other than 0/1** (for example a null
  status on very old receipts) are treated as `blocked`, not as
  success or failure. Sepolia receipts carry 0/1; the conservative
  branch exists so an unexpected shape can never reopen controls.
- **The record remains single-slot and in-memory**, as in Batch 6.1:
  one ambiguous transaction at a time (the UI state machine already
  prevents sending a second action while one is unresolved), and a
  page refresh discards the record, after which the plain Batch 6
  event-scan recovery governs. This matches the reviewed scenario;
  persisting the record across refreshes was out of scope.
- **Panel pending flag is last-known state.** `unconfirmedTxPending`
  reflects the most recent gate consultation, not a live subscription;
  it can lag one retry behind reality. It only changes panel wording,
  never a control's enabled state.

## 4. Build results (frontend)

- `npx tsc --noEmit` in `frontend/` — exit 0.
- `npm run build` in `frontend/` — exit 0 (only the pre-existing
  >500 kB chunk-size warning from the FHE WASM bundle, unchanged from
  earlier batches).

## 5. Test results and self-checks

- `npx hardhat test` at the project root, fresh run after this patch:
  **13 passing, 0 failing.**
- Self-check grep (a): `readProvider.getTransactionReceipt` is called
  inside `consultTxHashGate`, and `consultTxHashGate` is consulted in
  both verification paths — `restoreScoutStatus` (kind `"scout"`) and
  `checkCommitStatus` (kind `"commit"`) — before the respective event
  scans. Before this patch there was no `getTransactionReceipt` /
  `getTransaction` call anywhere in the frontend.
- Self-check grep (b): the stored record type is
  `{ kind, hash, nonce }` and both capture sites store it:
  `storeUnconfirmedTx({ kind: "scout", hash: tx.hash, nonce: tx.nonce })`
  and `storeUnconfirmedTx({ kind: "commit", hash: tx.hash, nonce: tx.nonce })`.
- Self-check grep (c): every clear of the record goes through
  `clearUnconfirmedTx`. The clear sites are: (i) the gate's
  `clearRecord`, which only fires on a status-0 receipt; (ii) the
  event-found branches, where the event is consistent with the
  receipt; (iii) the Scout conclusive not-found branch, which is now
  conditioned on `gateRes.gate !== "scan-strict"` and is unreachable
  while a receipt is outstanding (pending → `blocked`, scan never
  runs; success → `scan-strict`, branch excluded; failure → record
  already cleared by the gate). For commit, the clear happens only
  after a conclusive scan and after the `scan-strict && !res.mine`
  early return. No code path clears the record on a bare event-scan
  not-found while a receipt is outstanding.
- Locked files, MD5 before → after (identical):
  `contracts/VaultHeist.sol` `8b9240785791a1dfcf87e21a925d1b71`,
  `contracts/HeistLootToken.sol` `ac30a967b2a670c1f46c7018cfa7085e`,
  `frontend/.env` `3d3fdb9b2b89541503ef2b6c3095a1aa`,
  `frontend/src/lib/fhe.ts` `b92c0c3b6cbb05a7818521692fe8a449`,
  `frontend/src/abi/VaultHeist.json` `4b90e7ad0763543259f54cfd98803e63`,
  `frontend/src/abi/HeistLootToken.json` `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`.

### Acceptance criteria (owner's table) — by-construction evidence

No live RPC-failure or pending-transaction simulation was run for this
table; each row is satisfied by the code paths named, and the live
versions remain on the owner's manual test list (section 6).

| # | Criterion | Evidence (code path) |
| --- | --- | --- |
| A | Commit hash present, no receipt yet → LOCK IN stays locked | `checkCommitStatus` consults `consultTxHashGate("commit", me)` before `findRoundCommits`. No receipt + tx known → `blocked` → `setCommitStatus("unknown")` and early return; the scan never runs. LOCK IN's disabled condition requires `commitStatus === "verified-uncommitted"`, and VaultCard's `locked` prop does too. |
| B | Scout hash present, no receipt yet → Scout stays locked | `restoreScoutStatus` consults `consultTxHashGate("scout", wallet)` before `findScoutOnchain`; `blocked` substitutes `chain = null`, which lands in the `unknown` tail: `setScoutStatus("unknown")`, cache and record kept. `handleScout` refuses to run unless `scoutStatus === "verified-unused"`, and VaultCard's gate shows `unknown` (buttons disabled, Retry check offered). |
| C | Receipt success → event verification; not treated as failed merely because the event is not yet visible | Receipt `status === 1` → `scan-strict`. Commit: conclusive scan with `!res.mine` early-returns to `unknown` with the record kept (the clearing line is after that return). Scout: the conclusive not-found branch is conditioned on `gateRes.gate !== "scan-strict"`, so strict not-found falls into the `unknown` tail; cache is not cleared either. Only a matching found event resolves and clears. |
| D | Receipt `status = 0` → status recoverable after the failure is confirmed | Gate returns `clearRecord` only for `status === 0`; the caller clears the record, then the unmodified Batch 6/6.1 event verification runs (expected conclusive not-found → `verified-uncommitted` / `verified-unused`; a found event, if some other action landed, resolves to the verified state instead). |
| E | Tx still pending after several retries → stays `unknown`, no automatic new transaction | Every retry re-enters the same gate; while the tx is pending the gate returns `blocked` on every pass, the status never leaves `unknown`, and no code path in the patch (or the handlers it guards) submits a transaction: `handleSubmit` requires `verified-uncommitted`, `handleScout` requires `verified-unused`, and neither is reachable from `unknown`. |
| F | Once the tx status is definitively confirmed → UI recovers according to the onchain status | The next retry after mining re-consults the hash: status 1 + consistent event → `committed` / `verified-used` with the record and pending flag cleared; status 0 + event verification → `verified-uncommitted` / `verified-unused`. Recovery is driven entirely by the receipt plus the event record, i.e. by the onchain status. |

## 6. Not covered by automated verification

The frontend has no automated UI tests, and no live simulation of a
pending transaction, a receipt timeout, or a wallet replacement was run
for this patch; the acceptance rows above are proven by construction
and code-path inspection only. Still on the owner's manual list:
retrying while a real commit/Scout transaction is genuinely pending
(controls must stay locked and the panel must switch to the pending
wording), a real receipt timeout on commit and on Scout, a wallet
speed-up/replacement of an unconfirmed transaction, RPC recovery
returning the UI to normal, the two-wallet PvP match to completion,
and the three-round Solo match. TypeScript, the production build, and
the 13/13 Hardhat suite were re-run fresh for this patch (section 4–5).
