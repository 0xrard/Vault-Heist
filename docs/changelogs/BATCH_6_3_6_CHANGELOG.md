# Batch 6.3.6 — Gas Limit Floor for submitAllocation (Estimation Race Fix)

A frontend fix from the live PvP QA finding in match #13 (23 Nov 2026,
pre-approved in review): the "commit transaction was sent but could not be
confirmed yet" panel appeared twice for the same wallet (rounds 2 and 3),
even though the game ultimately ran smoothly and the match completed 3 rounds.
Onchain forensics across all six of that wallet's transactions proved
the cause was not app logic, but a gas estimation race.

## Forensic evidence (match #13, room creator's wallet)

| Attempt | Block | gasLimit (estimate) | gasUsed | Status |
| --- | --- | --- | --- | --- |
| Round 2 commit, attempt 1 | 12193802 | 1.867.323 | 1.082.031 | REVERT |
| Round 2 commit, attempt 2 | 12193806 | 8.193.696 | 5.418.294 | Success |
| Round 3 commit, attempt 1 | 12193813 | 1.867.335 | 1.082.043 | REVERT |
| Round 3 commit, attempt 2 | 12193816 | 7.965.222 | 5.267.178 | Success |

Mechanism: the wallet's gas estimation runs against the state at click time.
The second commit (and Solo mode, which always resolves) executes
the contract's round-resolution branch — FHE evaluation, initialization of the next
round / reward distribution — which uses ~5,4 million gas, far
above the ordinary commit estimate of ~1,87 million. If the opponent's commit lands
first in the same block (both failed attempts shared a block with the
opponent's commit, at a higher transaction index), our transaction switches to
the resolution branch with the old estimate's limit and dies out of gas
inside an internal FHE call (gasUsed stops at ~1,08 million, below the
limit — the pattern of an internal call revert, not an early require).
`tx.wait()` threw on the status-0 receipt, the Batch 6.1 ambiguity panel
appeared, and the Batch 6.2/6.3 recovery loop worked exactly as designed:
RETRY STATUS CHECK found the status-0 receipt, the record was cleared,
the scan was conclusive, LOCK IN reopened; the second attempt was re-estimated
correctly and succeeded. There were no duplicate commits in either incident.

## Files changed

| File | Change |
| --- | --- |
| frontend/src/components/GameArena.tsx | Constant `SUBMIT_ALLOCATION_GAS_LIMIT = 10_000_000` + evidence comment; the `contract.submitAllocation(...)` call now carries the `{ gasLimit }` override |
| BATCH_6_3_6_CHANGELOG.md | New (this document) |

The value of 10 million ≈ 1,85× the worst measured requirement (5.418.294,
final round including the cross-contract reward distribution), still far
below the Sepolia block gas limit. What the player pays is still the gas used,
not the limit, so this floor adds no cost to ordinary commits.
No contract changes; the Scout path is untouched (small transactions, no conditional branch).

## Verification

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

- The proof of this fix is inherently live: on this build,
  resolution-triggering commits no longer depend on the estimation result.
  The proving test is playing one PvP round in which
  both players commit close together (the original race condition) without the ambiguity
  panel appearing.
- The ambiguity panel is NOT removed: it remains the safety net
  for genuine receipt failures (transactions held,
  replaced, or reverting for other reasons).
