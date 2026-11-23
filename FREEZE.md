# FREEZE — Final Build Record

**Frozen:** 23 November 2026 (Asia/Jakarta), by Nino's decision.
**Frozen build:** Batch 6.3.14. Batch 6.3.8 including Addenda 1–6, plus the 6.3.9 match-list hygiene filter, the 6.3.10 dead-file cleanup, the 6.3.11 README accuracy pass, the 6.3.12 README heading correction, the 6.3.13 LICENSE file, and the 6.3.14 collapsible Your Matches section. Contracts unchanged since deployment.
**Status:** Live QA complete (23 Nov 2026), including the full 14-item Batch 6.3.8 live test list. This is the final code state for the Zama Developer Program Season 5 submission. No further code changes are planned; any post-freeze change requires a new batch number, a changelog, and a re-test of the affected paths before it may replace this build.
**Supersedes:** The Batch 6.3.13 freeze issued earlier the same day, and through it the 6.3.12, 6.3.11, 6.3.10, 6.3.9, 6.3.8 (15:39 WIB), and 6.3.7 (14:01 WIB) freezes. The 6.3.9 and 6.3.14 changes are display-layer only; 6.3.10 deletes provably dead files only; 6.3.11 corrects documentation and pre-fills the frontend `.env.example`; 6.3.12 changes one README heading; 6.3.13 adds the LICENSE file — all made at Nino's direction under the freeze rule (new batch number + changelog + re-verification; the suite still passes 13/13).

## Contract identity (unchanged, verified on Etherscan)

- Game VaultHeist v2: `0xB3B5966F36c80c8755EA667a0d74749a8306c5A7`
- cLOOT token (ERC-7984): `0x8475A387a5D9A943975DD2F73819936b98e0320a`
- Network: Sepolia (chainId 11155111). No mainnet deployment, by decision.

## What this build contains

- Batches 1–5: heist presentation, Syndicate AI, briefing/privacy modals, TX progress, Scout storage, SFX, VaultDoor, ranks/streaks, CinematicReveal, reliability foundations.
- Batch 6–6.3.3: fail-closed verification architecture — four-state commit status, three-state Scout restore, anchor-block cache, persistent pending-transaction records with full identity validation, invalid-record fail-closed, storage-availability warning.
- Batch 6.3.4: event-scan chunk size 45,000 → 10,000 blocks (public RPC rejects wide ranges, error 4444).
- Batch 6.3.5: VaultScouted event filter corrected to the positional three-argument form `(matchId, null, player)`.
- Batch 6.3.6: `submitAllocation` gas-limit floor of 10,000,000 (gas-estimation race on resolution commits).
- Batch 6.3.7: Loot / Alarm Limit range figures enlarged for legibility; all documentation and frontend code comments in English.
- Batch 6.3.8: silent wallet reconnect + active-match session restore.
  - Session hint in localStorage (`lib/sessionStorage.ts`), honored only after the chain confirms the match is still Active and the hint's address matches the reconnected account; re-entry goes through the existing resume() path.
  - Silent reconnect (`eth_accounts`, never a prompt) applies to every visit, unless an explicit Disconnect set the opt-out marker; a manual Connect clears the marker.
  - Arena restore is reserved for same-tab refreshes (Addendum 5): closing the tab is leaving — a fresh tab lands in the lobby with the wallet connected, and re-entry is a deliberate Resume click.
  - Permanent **Leave Match** button in the arena header (Addendum 3); leaving is view-level only, the match stays Active onchain and resumable.
  - Boot splash ("Reconnecting to your match…") instead of a lobby flash during restore, with an 8-second hard cap (Addendum 4).
  - Mount-ordering fix: the session hint is cleared only on a real arena → lobby transition, never on page load (Addendum 2 — found by live test 6).
  - Navbar privacy button label cleaned to "How Privacy Works" (Addendum 6).
- Batch 6.3.9: match-list hygiene — finished matches are listed permanently; unfinished matches are hidden automatically once more than 30 minutes old (age measured from the MatchCreated block timestamp). Display filter only: nothing is deleted onchain, and any hidden match remains reachable through Resume Match by ID; the list carries a note saying so.
- Batch 6.3.10: repo hygiene — deleted the stale `scripts/deploy.js` duplicate of `deploy.ts` and the unreferenced Vite template assets (`frontend/src/assets/`); the README now names the three active test suites (13 tests, all still passing). The `test/*.js` files were verified as live suites and deliberately kept.
- Batch 6.3.11: README accuracy pass after a full claim-by-claim audit against the contract, the tree, the live UI, and the Match #1 proof transaction — pre-filled `frontend/.env.example` with the live addresses (the README claimed it was pre-filled; it shipped empty), completed the Project Structure `lib/` listing (`pendingTxStorage.ts`, `sessionStorage.ts`), corrected the cLOOT button name to "Reveal", added PvP instructions and a frontend-behavior note, and made the Quick-Start wallet-agnostic.
- Batch 6.3.12: README heading correction — "Why This Game Breaks on a Transparent Blockchain" (which read as if the game itself were broken) is now "Why Transparent Blockchains Break Games Like This".
- Batch 6.3.13: added the standard MIT `LICENSE` file (copyright 0xrard) — the README declared MIT but the repository carried no license file, a gap found by the full re-scan of 23 November.
- Batch 6.3.14: the lobby's Your Matches history is now collapsible with the same toggle pattern as PvP Mode (closed by default, match count shown in the header; Refresh and the streak badge stay visible). List logic unchanged.

## Verification at freeze time

- `npx tsc --noEmit` — exit 0. `npm run build` — exit 0.
- Hardhat contract suite — 13 passing, 0 failing (contracts untouched by all frontend batches).
- Locked-file MD5s:
  - `contracts/VaultHeist.sol` — `8b9240785791a1dfcf87e21a925d1b71`
  - `contracts/HeistLootToken.sol` — `ac30a967b2a670c1f46c7018cfa7085e`
  - `frontend/src/lib/fhe.ts` — `b92c0c3b6cbb05a7818521692fe8a449`
  - `frontend/src/abi/VaultHeist.json` — `4b90e7ad0763543259f54cfd98803e63`
  - `frontend/src/abi/HeistLootToken.json` — `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`
  - (`frontend/.env` is never included in distribution zips; its local MD5 is `3d3fdb9b2b89541503ef2b6c3095a1aa`.)
- Live QA on the 6.3.6 base (23 Nov 2026): PvP match #13 completed 3 rounds; Solo #14 completed; #15 used for fault injection (corrupt and empty pending-tx records → fail-closed with the exact invalid-record note, clean recovery on removal); refresh-during-pending-commit and post-Scout refresh recovery proven. Full evidence: `LAPORAN-QA-LIVE-2026-11-23.txt` (kept outside this repo).
- Live test campaign for 6.3.8 (23 Nov 2026, production deployment, two wallets): all 14 items passed — silent reconnect (no popup), Solo refresh restore mid-match / during pending commit / after Scout (match #17, finished 312–224 with exactly 3 onchain commits, no duplicates), PvP player-2 refresh restore (match #18), refresh on a Finished match lands in the lobby, foreign-account hint rejected by the address gate, one full Solo to Finished, Leave Match → refresh stays in the lobby, Disconnect → refresh stays disconnected, manual Connect → silent restore resumes. Test 6 initially failed and exposed the mount-ordering defect fixed in Addendum 2; the lobby flash found in the test-5 re-run was fixed in Addendum 4 and re-verified on video and live; the tab-close semantics of Addendum 5 were re-tested after the change.

## Known limitations (documented, accepted at freeze)

- Refresh/restore loading takes a few seconds: the FHE SDK initialization and the chain-rebuilt match history dominate (the event scans themselves measure ~1.1 s total for a fresh match against the public RPC). An optimization batch was considered and deferred by choice; correctness was prioritized.
- Contract-side audit notes (documented in the README, unchanged by design decision): PvP matches have no timeout; the VaultScouted event reveals vault index and stat kind (not values); the cLOOT reward amount is computable onchain. Sepolia only; cLOOT is non-monetary.

## Remaining non-code work (deadline 14 Dec 2026, 23:59 AOE)

1. 3-minute pitch video, real person (AI-generated presenters are rejected by the organizer).
2. Public X post.
3. Zama submission form.
4. Fill the two README placeholders (pitch video + X post links) — a documentation-only edit that does not unfreeze the code.
