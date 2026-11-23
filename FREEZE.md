# FREEZE — Final Build Record

**Frozen:** 23 November 2026 (Asia/Jakarta), by Nino's decision.
**Frozen build:** Batch 6.3.7 (frontend). Contracts unchanged since deployment.
**Status:** Live QA complete (23 Nov 2026). This is the final code state for the Zama Developer Program Season 5 submission. No further code changes are planned; any post-freeze change requires a new batch number, a changelog, and a re-test of the affected paths before it may replace this build.

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
- Live QA (23 Nov 2026, production deployment): PvP match #13 completed 3 rounds; Solo matches #14 completed and #15 used for fault injection; Scout end-to-end incl. post-refresh recovery; refresh-during-pending-commit recovery; corrupt and empty pending-tx record injection → fail-closed with the exact invalid-record note, clean recovery on removal. Full evidence: `LAPORAN-QA-LIVE-2026-11-23.txt` (kept outside this repo).

## Deliberately NOT in this build

- Silent wallet reconnect / session restore on refresh (discussed 23 Nov as a possible Batch 6.3.8; excluded from the freeze because it is behavior-changing and untested — the freeze covers only what live QA proved).

## Remaining non-code work (deadline 14 Dec 2026, 23:59 AOE)

1. 3-minute pitch video, real person (AI-generated presenters are rejected by the organizer).
2. Public X post.
3. Zama submission form.
4. Fill the two README placeholders (pitch video + X post links) — a documentation-only edit that does not unfreeze the code.
