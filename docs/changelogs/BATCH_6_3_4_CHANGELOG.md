# Batch 6.3.4 — Scan Chunk Size Correction (Live QA Blocker Fix)

A single-constant patch from Nino's live QA finding (23 Nov 2026): in the two-wallet
PvP test, every arena control stayed permanently locked and the
RETRY STATUS CHECK button felt unresponsive. The root cause was not in the
fail-closed logic (which worked exactly as designed in Batch 6–6.3.3),
but in the event scan chunk size, which the public RPC rejected.

## Root-cause evidence (measured directly, 23 Nov 2026)

All onchain reads go through a single free public RPC
(`ethereum-sepolia-rpc.publicnode.com`, see `src/lib/contracts.ts`).
The app's event scans used 45.000-block chunks. Direct `eth_getLogs` testing
against that endpoint from the development machine:

| Range per query | Result |
| --- | --- |
| 45.000 blocks | REJECTED: error 4444 "pruned history unavailable" |
| 10.000 blocks | Served, logs returned normally |
| 1.000 blocks | Served |
| 100 blocks | Served |

Every 45.000 chunk failed instantly, so scans were never conclusive,
the status fell to `unknown`, and per the fail-closed design every control
stayed locked. Retry repeated the same scan and failed the same
way. The contract was deployed 20 Nov 2026; its entire history through 23 Nov
was only about 16 thousand blocks, so reach was not the problem — the per-query chunk
size was the only rejection.

## Files changed

| File | Change |
| --- | --- |
| frontend/src/lib/contracts.ts | `LOG_CHUNK_BLOCKS` 45000 → 10000 (line 104); the `MAX_ANCHOR_CHUNKS` reach comment updated (~480 thousand blocks) |
| BATCH_6_3_4_CHANGELOG.md | New (this document) |

No other changes. The scan architecture (MatchCreated anchor, sequential chunk scans
, a null result = inconclusive), the Batch 6.2 hash gate,
the 6.3.1–6.3.3 fail-closed hydration, and all fail-closed rules are unchanged.
`MAX_ANCHOR_CHUNKS` stays 48: at 10.000-block chunks the anchor search reach
becomes ~480 thousand blocks, still about 30 times the contract's entire history.

## Verification

- **Smoke test of the app's scan pattern against the live RPC** (a throwaway node script
  using ethers + the real ABI + the exact same chunk pattern, for
  match #9, which Nino was playing): tip 12.193.693; the
  MatchCreated(9) anchor was found in the first chunk at block 12.193.665;
  the forward AllocationCommitted(9) scan completed conclusively with 0 logs (correct:
  no player had committed in that round yet); 1,7 seconds total.
  The same pattern at 45.000-block chunks failed on the first query.
- TypeScript: `npx tsc --noEmit` exit 0.
- Frontend build: `npm run build` exit 0 (only the pre-existing FHE WASM chunk
  size warning).
- Contracts: fresh `npx hardhat test` run, 13 passing, 0 failing.
- Locked files identical (MD5):
  - contracts/VaultHeist.sol `8b9240785791a1dfcf87e21a925d1b71`
  - contracts/HeistLootToken.sol `ac30a967b2a670c1f46c7018cfa7085e`
  - frontend/.env `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - frontend/src/lib/fhe.ts `b92c0c3b6cbb05a7818521692fe8a449`
  - frontend/src/abi/VaultHeist.json `4b90e7ad0763543259f54cfd98803e63`
  - frontend/src/abi/HeistLootToken.json `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Notes

- This fix is only proven when the patched build is the one the
  player runs; the old build (45.000-block chunks) still cannot complete
  verification against this endpoint.
- Further live testing (PvP completing 3 rounds, pending + refresh, and the rest of the
  QA list) remains in Nino's hands once this build is deployed.
