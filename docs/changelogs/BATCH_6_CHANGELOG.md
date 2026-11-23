# Vault Heist — Batch 6 Changelog: Reliability Hardening & Final Consistency

Date: 2026-11-21. Scope: frontend only. No smart contract changes, no
redeployment, no ABI changes. Batch 6 comes from the owner's audit of the
Batch 5 zip. It fixes a broken Ethers v6 event filter that silently
disabled Scout verification, replaces the two Batch 4 boolean sync gates
(which settled to "ready" on every outcome, including RPC failure) with
explicit state machines in which an inconclusive scan is its own state
and never reads as "not done", caches the verified MatchCreated anchor
block, and corrects three documentation accuracy issues. The Batch 4
verification design is preserved throughout: the blockchain is the
source of truth, localStorage is cache only, and no fix works by
removing or bypassing verification.

## 1. Files changed

| File | Change |
| --- | --- |
| `frontend/src/lib/scoutStorage.ts` | **P0-1.** `findScoutOnchain` now calls `filters.VaultScouted(matchId, walletAddress)` (the two indexed parameters) instead of the three-argument form `(matchId, null, walletAddress)`. Three-way result semantics (found / conclusive not-found / inconclusive-null) unchanged. |
| `frontend/src/lib/contracts.ts` | **P1-4.** `findMatchCreatedBlock` now consults a localStorage anchor cache (key: chainId + contract address + matchId) before scanning. A cached block is trusted only after a one-block `MatchCreated` validation query at exactly that block returns the event; a successful-but-empty validation discards the cache and falls through to the full backward scan; a failed validation query returns null (inconclusive). Fresh scan results are written to the cache. Chunk size (45,000) and the 48-chunk cap are unchanged. |
| `frontend/src/components/GameArena.tsx` | **P0-2.** Commit recovery is now a four-state machine (`checking` / `verified-uncommitted` / `committed` / `unknown`) via a named `checkCommitStatus()` that the mount effect and the new RETRY STATUS CHECK button both call. LOCK IN and allocation controls are enabled only in `verified-uncommitted`. Inconclusive scans land in `unknown`: controls stay locked and an amber panel offers the retry. The in-session unresolved submit path also records `committed`. **P0-3.** Scout restore is now a named `restoreScoutStatus()` setting an explicit status (`syncing` / `verified-unused` / `verified-used` / `unknown`); the old `finally { setScoutSyncReady(true) }` is gone. `handleScout` only runs from `verified-unused`; a successful in-session Scout transaction sets `verified-used`. VaultCard receives a `scoutGate` prop plus the retry callback; the `locked` prop now keys off the commit state machine. |
| `frontend/src/components/VaultCard.tsx` | **P0-3.** The boolean `scoutSyncing` prop is replaced by `scoutGate` (`"syncing"` / `"ready"` / `"unknown"`) plus `onRetryScoutSync`. Scout buttons are enabled only when the gate is `"ready"`. In the `unknown` state each card shows a short note ("Scout status could not be verified onchain. Scout stays paused until the check succeeds.") with a compact "Retry check" button. |
| `frontend/src/components/Lobby.tsx` | **P1-6.** The hero copy no longer claims "only round results are ever revealed". It now states that a Scout reveals one stat privately to the scouting wallet only, that alarm status and scores become public when the round resolves, and that transaction metadata remains visible onchain. |
| `README.md` | **P1-5a.** The confidentiality claim now reads that vault parameters, player allocations, and bot moves "remain encrypted from the public and the opponent", and that "Scout allows a player to selectively decrypt one vault statistic through FHE access control". **P1-5b.** Project Structure now lists `CinematicReveal` among the components and `usePrefersReducedMotion.ts` among the lib files. **P1-7.** The Match #1 paragraph now links the Sepolia Etherscan transaction that proves it (see section 2). |
| `BATCH_6_CHANGELOG.md` | This file (new). |

No other files were created or modified. In particular, the following
locked files are byte-identical before and after (see section 5):
`contracts/VaultHeist.sol`, `contracts/HeistLootToken.sol`, `frontend/.env`,
`frontend/src/lib/fhe.ts`, `frontend/src/abi/VaultHeist.json`,
`frontend/src/abi/HeistLootToken.json`. Temporary scripts used for the
Match #1 transaction hunt were deleted after use.

## 2. Reason for each change

- **VaultScouted filter (`scoutStorage.ts`).** In Ethers v6, filter
  arguments map positionally to the event's INDEXED parameters only.
  `VaultScouted` declares `matchId` (indexed), `round` (not indexed),
  `player` (indexed), `vaultIdx` (not indexed), `isAlarm` (not indexed),
  so the correct filter is `filters.VaultScouted(matchId, walletAddress)`.
  The Batch 4 code passed three arguments with a `null` placeholder for
  `round`; Ethers rejects that arity, the exception was swallowed by the
  function's `catch`, and `findScoutOnchain` returned null (inconclusive)
  on every call. Scout verification therefore never produced a conclusive
  result: restored values were always cache fallbacks, and conclusive
  cache clearing could never happen. Round filtering continues to happen
  on the returned logs' `args`, as before.
- **Commit four-state machine (`GameArena.tsx`).** Batch 4 held the
  allocation controls behind a boolean that a `finally` block set to true
  on every outcome, so when the `AllocationCommitted` scan failed or was
  inconclusive, a player who had already committed saw LOCK IN enabled
  again after a refresh and could send a second, reverting transaction.
  Now only a conclusive scan can reach `verified-uncommitted` (controls
  enabled) or `committed` (existing locked panel and resolution flow,
  unchanged). `unknown` keeps everything locked and offers
  RETRY STATUS CHECK, which re-runs the same verification.
- **Scout three-state gate (`GameArena.tsx`, `VaultCard.tsx`).** The same
  boolean flaw existed on the Scout side: the gate opened even when
  verification failed, so with an empty localStorage a used Scout looked
  unused and the next Scout transaction would revert. Now Scout is
  enabled only from `verified-unused`. In `unknown`, Scout buttons stay
  disabled with a note and a per-card "Retry check" button, while
  allocation and LOCK IN remain fully playable, so an RPC outage degrades
  one optional action instead of the match. Cache semantics are
  unchanged: only a conclusive not-found clears the cache; an
  inconclusive result never deletes it and never marks Scout unused
  (a cached value still displays as a view-only fallback in `unknown`).
- **Anchor cache (`contracts.ts`).** Every arena mount rescanned
  backwards from the chain head to find `MatchCreated`. The verified
  anchor block is now persisted per (chainId, contract, matchId) and
  revalidated on reuse with a single-block query whose filter is already
  bound to the matchId topic, so a poisoned or stale entry can only cause
  a discard-and-rescan, never a wrong anchor. The 45,000-block chunk size
  and the 48-chunk inconclusive cap are untouched, since public RPC
  `eth_getLogs` limits vary.
- **Documentation accuracy (`README.md`, `Lobby.tsx`).** The old copy
  overstated confidentiality twice: the README implied nothing is ever
  decrypted mid-round (Scout is exactly a selective, ACL-gated
  decryption), and the Lobby claimed only round results are ever revealed
  (Scout results are revealed privately to the entitled player, and
  transaction metadata is public by design). Both now describe the actual
  model. Project Structure also lagged Batch 5 by two files.
- **Match #1 proof link (`README.md`).** The README asserted Match #1
  completed with `RewardsMinted` but gave judges no way to check. The
  transaction was located on Sepolia via the public RPC by scanning
  `RewardsMinted` logs around the known finish time and verified before
  linking: tx
  `0x91958806cad839da7e813eef38acb67911b1358f4427c0a5cb4b3ac4837ae67a`
  (block 12177326, 2026-11-20 20:07:12 UTC, i.e. 03:07 WIB) emits
  `RewardsMinted` for matchId 1, contains `RoundResolved` for round 3 of
  the same match, and contains the cLOOT `ConfidentialTransfer` mint from
  the zero address to player 1 in the same transaction; Etherscan shows
  the transaction as successful. The minted amount itself is an encrypted
  handle (ERC-7984), so the 21,400 figure cannot be read from logs; that
  is inherent to the confidential token, and every publicly checkable
  fact matches.

## 3. Regression risks (honest assessment)

- **State-machine wiring (`GameArena.tsx`).** The two verification flows
  were restructured from effect-embedded code into named functions.
  Behavior on the conclusive paths is intentionally identical to Batch 4
  (same cache branches, same locked panel, same resolution flow), but the
  restructure itself is the largest change surface in this batch. The
  mount effects no longer carry a `cancelled` flag: the arena is remounted
  by App on every round change, so a stale async completion can only write
  to an unmounted instance, but this was verified by reasoning and build,
  not by an instrumented runtime test.
- **Deliberate behavior change: `unknown` locks Scout and LOCK IN.**
  Under a persistently failing RPC, a player who has NOT committed now
  cannot lock in until the retry succeeds, and cannot Scout. This is the
  audit's requested trade (a blocked action over a reverting transaction),
  and allocation planning remains possible, but it is a real availability
  cost if the public RPC degrades during judging. The retry buttons are
  the mitigation.
- **Scout retry after cache fallback.** If the first restore was
  inconclusive and displayed a cached value, a retry that returns a
  conclusive not-found now also clears the displayed `scouted` /
  `pendingScout` state (the cache entry is deleted in the same branch).
  That is the chain-truth outcome, but a judge could see a restored value
  disappear after pressing retry if their cache was stale.
- **Anchor cache (`contracts.ts`).** New localStorage surface. Risks are
  bounded by design: keys are scoped per chain, contract, and match;
  values are validated against the chain before use; storage failures are
  swallowed and fall back to scanning. A validation query that fails at
  the RPC returns inconclusive (null) even if the cache was correct,
  which can push the arena into the `unknown` states more often on a
  flaky RPC than a blind cache hit would. Accepted: trusting an
  unvalidated cache would violate the batch's core rule.
- **VaultCard prop change.** `scoutSyncing` was removed; GameArena is the
  only consumer and was updated in the same change. TypeScript confirms
  no other call site exists.
- **Copy changes.** README and Lobby wording only; no layout or logic
  impact. The new Lobby paragraph is one line longer.

## 4. Build results (frontend)

- `npx tsc --noEmit` — exit 0, no errors.
- `npm run build` — exit 0. Only the pre-existing warning about the
  >500 kB main chunk (FHE WASM bundle), unchanged from earlier batches.

## 5. Test results and self-checks

- `npx hardhat test` at the project root — exit 0, **13 passing, 0
  failing** (5 mock-FHEVM VaultHeist, 5 FHEVM VaultHeist, 3 cLOOT reward
  tests). Contracts were not modified, so this confirms no accidental
  contract or test drift.
- **Event-filter audit** (every `filters.*` call site in `frontend/src`,
  checked against the indexed fields in `frontend/src/abi/VaultHeist.json`;
  `queryFilter` is only invoked inside the `contracts.ts` helpers):

  | Call site | Event indexed fields | Verdict |
  | --- | --- | --- |
  | `contracts.ts` `filters.MatchCreated(matchId)` | matchId, player1 | Legal: trailing indexed params omitted act as wildcards |
  | `contracts.ts` `filters.AllocationCommitted(matchId)` | matchId, player | Legal: player wildcarded; logs narrowed by round/player from `args` |
  | `scoutStorage.ts` `filters.VaultScouted(matchId, walletAddress)` | matchId, player | **Fixed in this batch** (was a three-argument call with a null for the non-indexed `round`) |

  `PlayerJoined` and `RoundResolved` are never queried through filters in
  the frontend. Note: the deployed contract also emits `RewardsMinted`
  (declared in `VaultHeist.sol`), which the curated frontend ABI subset
  does not include; it is not queried by the app and was only used by the
  one-off RPC hunt for the README proof link.
- **Self-check greps.** (a) `filters.VaultScouted(matchId, walletAddress)`
  present at `scoutStorage.ts`; the three-argument form is gone. (b) No
  `finally` block touches the verification gates: the verification
  functions contain no `finally` at all, and the four remaining `finally`
  blocks in `GameArena.tsx` are in the action handlers (`handleScout`,
  `handleRetryDecrypt`, `handleSubmit`, `handleRefresh`) and only reset
  `busy` / `step` / `submitStage`. No references to the removed
  `scoutSyncReady`, `commitChecked`, or `scoutSyncing` identifiers remain.
  (c) The `unknown` states and retry affordances exist: RETRY STATUS CHECK
  panel in `GameArena.tsx`, per-card unknown note with "Retry check" in
  `VaultCard.tsx`.
- **Locked files.** MD5 identical before and after for all six:
  `contracts/VaultHeist.sol` `8b924078…`, `contracts/HeistLootToken.sol`
  `ac30a967…`, `frontend/.env` `3d3fdb9b…`, `frontend/src/lib/fhe.ts`
  `b92c0c3b…`, `frontend/src/abi/VaultHeist.json` `4b90e7ad…`,
  `frontend/src/abi/HeistLootToken.json` `31f13e0f…`.
- **Em dashes.** No new em dashes in UI strings; the only em dash in the
  edited component files is a pre-existing Indonesian code comment.

## 6. Not covered by automated verification

The frontend has no automated UI tests, so the following remain manual
regression items for the owner's live pass and are NOT verified by this
batch: refresh after commit; RPC failure during commit verification
(unknown panel + retry); RPC failure during Scout verification (unknown
gate + retry); Scout already used with localStorage cleared; Scout
restored after refresh (now expected to verify conclusively for the
first time, thanks to the filter fix); a two-wallet PvP match played to
completion; a full three-round Solo match. Build, type-check, contract
tests, the filter audit, and the on-chain Match #1 verification above
are the automated evidence for this batch.
