# Vault Heist — Batch 4 Changelog: Gameplay Reliability & Recovery

Date: 2026-11-21. Scope: frontend only. No smart contract changes, no
redeployment, no ABI changes. Batch 4 fixes three verified P0 reliability
problems (commit state lost on refresh, Scout verification that could delete
valid cache entries, and a Scout race on arena load), plus two riders
(RoundHistory animation key, documentation/scope consolidation).

## 1. Files changed

| File | Change |
| --- | --- |
| `frontend/src/lib/contracts.ts` | Added anchored event-scan helpers (`findMatchCreatedBlock`, `scanEventLogs`, `findRoundCommits`, `LOG_CHUNK_BLOCKS`) and a required `matchId` field on `RoundRecord`. |
| `frontend/src/lib/scoutStorage.ts` | Rewrote `findScoutOnchain` to scan from the `MatchCreated` block forward in chunks; `{ found: false }` is now conclusive only after the full anchored range was scanned. Removed the shrinking-window early-exit logic. |
| `frontend/src/components/GameArena.tsx` | Mount-time commit recovery (P0-A), Scout sync gate wiring (P0-C), reworked locked-orders status panel (`ORDERS LOCKED` / `WAITING FOR OPPONENT` / both-committed), `matchId` added to the resolved-round record. |
| `frontend/src/components/VaultCard.tsx` | New optional `scoutSyncing` prop: Scout buttons stay disabled (with a "Checking Scout status onchain…" hint) while the onchain Scout status is being verified. |
| `frontend/src/App.tsx` | Threaded `matchId` into all four `RoundRecord` constructions (resume history x2, backfill x2). |
| `frontend/src/components/RoundHistory.tsx` | `recordKey` now includes `matchId`, so the reveal animation is tracked per match instead of per identical round/alarms/score combination. |
| `frontend/src/components/Lobby.tsx` | Headline claim replaced: "Nobody sees your moves." becomes "Your strategy stays yours." with the subline "Your crew allocations and vault secrets stay encrypted. …" |
| `README.md` (project root) | New "Project Scope & Deployment" section; "Mainnet Economy Roadmap" content removed; audit section retitled "Security & Privacy Trade-offs"; Game Rules terminology updated (Agent Budget / Agents); Judge Quick-Start updated to current button names (Start Solo vs Syndicate AI, Scout Loot / Scout Alarm (-1 Agent), LOCK IN & START HEIST); Project Structure now lists the newer frontend components and lib files and all three test files. |
| `frontend/README.md` | Replaced the default Vite template with a short real frontend README (what it is, setup, `.env` variables, scripts). |
| `BATCH_4_CHANGELOG.md` | This file (new). |

No other files were created. In particular, the following locked files are
byte-identical before and after (see section 5):
`contracts/VaultHeist.sol`, `contracts/HeistLootToken.sol`, `frontend/.env`,
`frontend/src/lib/fhe.ts`, `frontend/src/abi/VaultHeist.json`,
`frontend/src/abi/HeistLootToken.json`.

## 2. Reason for each change

- **P0-A — PvP commit-state recovery (`contracts.ts`, `GameArena.tsx`).**
  `waitingOpp` initialized to `false` on every mount and `AllocationCommitted`
  was never queried, so after a browser refresh a player who had already
  committed saw the LOCK IN button again and could attempt a second
  allocation that the contract would revert. On arena mount the frontend now
  scans `AllocationCommitted` events for the current round (anchored at the
  `MatchCreated` block). If the connected wallet already committed, the arena
  restores the locked state: allocation controls (slider, plus/minus, LOCK IN)
  are disabled and the existing status panel shows **ORDERS LOCKED**, plus
  **WAITING FOR OPPONENT** when the opponent's commit event is absent, or a
  "both crews have committed, results still syncing" message when it is
  present. If both players committed but the round result has not been
  collected yet, the pre-existing recovery flow takes over unchanged: the
  panel's "Check Resolution" / "Fetch Round Results" button
  (`collectResolution`) and App's 20-second auto-sync polling. No parallel
  resolution system was built. The same mount guard runs in Solo mode.
  Allocation controls are also held until the mount check settles
  (`commitChecked`), closing the race where a fast click could beat the
  recovery scan; an inconclusive scan never locks anything.
- **P0-B — Scout event verification rework (`scoutStorage.ts`).**
  The old search used shrinking trailing windows (45k / 10k / 2k blocks) and
  returned "not found" as soon as one query succeeded empty, never paging to
  older blocks, while the cache TTL is 14 days. A valid cache entry could be
  deleted, Scout looked unused, and a second Scout transaction would revert
  onchain. The scan is now anchored at the match's `MatchCreated` block and
  walks forward to the latest block in 45,000-block chunks. The result is
  three-way: found / conclusively not found (full anchored range scanned) /
  inconclusive (`null`: anchor not found or any chunk failed). The existing
  GameArena restore logic already maps these correctly: only a conclusive
  not-found may clear the cache; inconclusive falls back to the cache and
  never marks Scout unused.
- **P0-C — Scout sync gate (`GameArena.tsx`, `VaultCard.tsx`).**
  The Scout restore runs asynchronously on mount, so the Scout buttons were
  briefly enabled before verification finished and a fast player could Scout
  twice (second transaction reverts). Scout buttons now stay disabled from
  mount until the restore settles with any outcome (restored value,
  conclusive unused, or inconclusive). On inconclusive the buttons re-enable:
  an RPC failure must not brick the game. `handleScout` also guards on the
  same flag.
- **Rider 1 — `recordKey` includes `matchId` (`contracts.ts`, `App.tsx`,
  `GameArena.tsx`, `RoundHistory.tsx`).** The session animation key was
  `round|alarms|scores`, so two different matches producing the same
  combination would skip the reveal animation in the second match.
  `RoundRecord` now carries `matchId`, threaded through every construction
  site, and the key is `matchId|round|alarms|scores`.
- **Rider 2 — Documentation and claims (`README.md`, `frontend/README.md`,
  `Lobby.tsx`).** Project decision: Vault Heist will not go to mainnet. The
  README no longer presents a mainnet economy/deployment roadmap; instead a
  "Project Scope & Deployment" section states the game was built for the Zama
  Developer Program campaign, is deployed on Ethereum Sepolia, has no
  mainnet deployment planned, that cLOOT is non-monetary testnet reputation,
  and that the known privacy trade-offs are documented. The ACL table, the
  cLOOT non-monetary section, and the known-limitations list are kept (they
  are still true); the two mentions of the Payday Agent project as a reason
  to defer contract work were removed. The Lobby headline no longer claims
  "Nobody sees your moves." (public transactions still expose metadata);
  it now reads "Your crew allocations and vault secrets stay encrypted. Your
  strategy stays yours." The frontend README was still the default Vite
  template and now describes the actual app.

## 3. Regression risks (honest assessment)

- **Extra RPC load and latency on arena mount (`contracts.ts`,
  `GameArena.tsx`).** Mount now performs a backward `MatchCreated` search
  plus forward event scans for both commits and Scout verification against a
  public RPC. For recent matches this is a handful of `eth_getLogs` calls;
  the anchor search is capped at 48 chunks (~2.16M blocks). Worst case, a
  slow or rate-limited RPC delays `commitChecked` / `scoutSyncReady`, so
  LOCK IN and Scout stay disabled longer than before. If a request hangs
  indefinitely, the gate stays closed for that mount (round change or resume
  remounts and retries). This is a deliberate safety-over-speed trade: an
  inconclusive scan never produces a wrong lock or a wrong cache deletion.
- **Stale opponent status (`GameArena.tsx`).** `oppCommitted` is a
  mount-time snapshot. If the opponent commits after the scan, the panel can
  keep saying WAITING FOR OPPONENT until the player clicks "Check
  Resolution", the round resolves, or App's 20-second auto-sync remounts the
  arena. Cosmetic only; no state can be corrupted by it.
- **Recovered locked state depends on the pre-existing recovery UX.** If
  `collectResolution` keeps failing (relayer down), a recovered player sits
  in the locked panel with the manual fetch button, exactly like the
  pre-Batch 4 post-submit failure path. No new failure mode, but the panel
  is now reachable via refresh as well as via submit.
- **Solo mode note.** The onchain bot never emits `AllocationCommitted` and
  resolves in the same transaction as the player's commit, so the
  recovered-locked state should never trigger in Solo. The guard runs anyway;
  if it ever did trigger (e.g. a stale `matchInfo` reaching the arena), the
  panel's "Fetch Round Results" button resolves it.
- **Scout verification is slower and more often inconclusive
  (`scoutStorage.ts`).** Scanning from `MatchCreated` costs more RPC calls
  than the old trailing window for old matches, and on a flaky RPC the
  result will more often be inconclusive (cache fallback, the pre-Batch 1
  behavior) instead of a definitive answer. A genuinely stale cache entry
  now survives longer; it is still bounded by the 14-day TTL, the 20-entry
  retention cap, and pruning when the match finishes.
- **`RoundRecord.matchId` is a required field.** All construction sites were
  updated (GameArena resolution, App resume x2, App backfill x2); TypeScript
  would fail the build on any missed site, and `tsc --noEmit` passes, so
  coverage is complete. The in-memory `animatedKeys` set now keys per match,
  so the reveal animation replays once per match instead of once per
  identical record across matches (intended).
- **`VaultCard` `scoutSyncing` prop** is optional with a `false` default and
  VaultCard is only used by GameArena; no other call site is affected.
- **Documentation changes** carry no runtime risk. One judgment call: the
  intro line still names the "Zama Developer Program Mainnet Season 5"
  because that is the campaign's official name; the new Scope section makes
  the actual deployment status (Sepolia only, no mainnet planned)
  unambiguous.

## 4. Build results (frontend)

- `npx tsc --noEmit` — **exit 0**, no errors.
- `npm run build` (`tsc -b && vite build`) — **exit 0**, built successfully.
  The only warning is the pre-existing "chunks larger than 500 kB" notice
  from the FHE WASM bundle, unrelated to Batch 4.

## 5. Test results and self-checks

- `npx hardhat test` (project root) — **exit 0: 13 passing, 0 failing**
  (~6s). Breakdown: 3 cLOOT reward tests (`ClootRewards.test.js`), 5 mock
  FHEVM tests (`VaultHeist.test.js`), 5 FHEVM tests (`VaultHeist.test.ts`).
  Contracts were not modified, so this confirms the baseline suite is intact.
- Self-check grep 1 — `AllocationCommitted` is now queried in frontend code:
  `frontend/src/lib/contracts.ts` uses `contract.filters.AllocationCommitted(matchId)`
  inside `findRoundCommits`, called from `GameArena.tsx` on mount. PASS.
- Self-check grep 2 — the literal window array `[45000, 10000, 2000]` no
  longer exists in `frontend/src/lib/scoutStorage.ts` (grep: no match).
  PASS.
- Self-check grep 3 — `recordKey` in `RoundHistory.tsx` returns
  `` `${r.matchId}|${r.round}|...` ``. PASS.
- Locked-file MD5 confirmation (identical before and after Batch 4):
  - `contracts/VaultHeist.sol` — `8b9240785791a1dfcf87e21a925d1b71`
  - `contracts/HeistLootToken.sol` — `ac30a967b2a670c1f46c7018cfa7085e`
  - `frontend/.env` — `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - `frontend/src/lib/fhe.ts` — `b92c0c3b6cbb05a7818521692fe8a449`
  - `frontend/src/abi/VaultHeist.json` — `4b90e7ad0763543259f54cfd98803e63`
  - `frontend/src/abi/HeistLootToken.json` — `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## 6. Not covered by automated verification

The frontend has no automated UI test suite. The following still need a
live two-wallet Sepolia session and are NOT verified by this batch: PvP
commit, refresh mid-round, resume (locked state restored); opponent
committing after the mount scan; Scout restore on a match whose
`VaultScouted` event is older than 45,000 blocks; Scout button gating under
a slow RPC.
