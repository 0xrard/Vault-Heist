# Batch 6.3.5 — VaultScouted Filter Form Correction (Live QA Blocker Fix)

A one-line patch from the continuation of Nino's live QA (23 Nov 2026): after
Batch 6.3.4 was deployed and verified serving the new build, the Scout status
stayed `unknown` on every card, even though the chain was proven healthy — RPC
requests returned status 200, the anchor scan and commit scan completed conclusively from
the development machine, and match #12's anchor cache in Nino's browser held
the correct block (12.193.734).

## Root cause (reproduced exactly, 23 Nov 2026)

Running the `findScoutOnchain` pattern verbatim in node (ethers + the real
ABI + the live RPC) threw the following error at the moment the filter was BUILT,
before any query was sent:

```
TypeError: cannot filter non-indexed parameters; must be null
(argument="contract.round", value="0x9d58...3dF7")
```

Ethers v6 filter arguments are POSITIONAL across all event parameters.
The original signature in the contract (VaultHeist.sol:59 and the ABI):

```
VaultScouted(uint256 indexed matchId, uint8 round, address indexed player, uint8 vaultIdx, bool isAlarm)
```

The two-argument form `(matchId, walletAddress)` introduced by
Batch 6 placed the wallet address in the `round` slot (the second parameter,
non-indexed), so Ethers threw, the `catch` in `findScoutOnchain`
returned null, and the Scout status fell to `unknown` on every
check — permanently, in every browser and every match, since
Batch 6. The Batch 6 comment that stated the two-argument form was
"the correct form" misread Ethers' filter rules.

Commit verification was never affected by this bug: `findRoundCommits`
uses the single-argument filter `AllocationCommitted(matchId)` and filters
round/player from the log args. The `MatchCreated(matchId)` filter is also safe.
These three are the only uses of `filters.*` in the entire frontend
(audited).

## Files changed

| File | Change |
| --- | --- |
| frontend/src/lib/scoutStorage.ts | VaultScouted filter `(matchId, walletAddress)` → `(matchId, null, walletAddress)`; the incorrect Batch 6 comment replaced with the correct positional rule |
| BATCH_6_3_5_CHANGELOG.md | New (this document) |

## Verification

- The old form was reproduced throwing `cannot filter non-indexed
  parameters` locally (without RPC) — exactly the app's failure path.
- The new form: construction of all three app filters passes without throwing;
  the topics for VaultScouted resolve to matchId + player.
- Live negative case: match #12 + the room creator's wallet — the scan with
  the new filter completed CONCLUSIVELY, 0 events (correct: no Scout yet),
  so the legitimate status is verified-unused and the budget cap of 10
  opens.
- A live positive case was not available to demonstrate: there is no
  VaultScouted event at all in the last 10.000 blocks served by this public RPC
  (the only recent game is the QA match whose Scout was
  indeed blocked by this bug), and match #4's history (the last successful Scout, from the era before Batch 6) is already outside the free node's retention window
  — queries against that range are rejected with error 4444
  "pruned history unavailable". The positive path uses the same args filtering
  as before Batch 6, when Scout worked end-to-end.
- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0.
- Contracts: fresh `npx hardhat test` run, 13 passing, 0 failing.
- Locked files identical (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Notes

- Two stacked bugs masked each other during this QA: the 45.000 chunk
  size (Batch 6.3.4) blocked the anchor scans, and the VaultScouted
  filter form (this batch) blocked Scout verification even when scans
  ran. Both are now closed.
- RPC retention observation: the free public node only serves history
  from roughly the last 10–20 thousand blocks; verification of old matches outside
  that window ends inconclusively (fail-closed, by design) —
  fresh matches are unaffected.
