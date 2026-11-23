# Batch 6.3.11 — README Accuracy Pass (Documentation + Example Env Only)

**Date:** 23 November 2026
**Type:** Documentation corrections and one example-config fix. No code logic changes anywhere. Post-freeze batch under the freeze rule (new batch number + changelog + re-verification), re-frozen on completion.
**Trigger:** A full README audit pass: is it accurate to the game and the files, and are its instructions correct and complete? The audit verified every checkable claim against the contract source, the file tree, the live UI labels, and the Match #1 proof transaction onchain. The technical core (rules, RNG ranges, ACL tables, all source line citations, deploy/test instructions, the Match #1 evidence) verified exact. Six items did not:

## Fixes applied

1. **Frontend setup instructions were wrong (the serious one).** The README said `frontend/.env.example` ships with `VITE_CONTRACT_ADDRESS` "pre-filled with the live Sepolia contract"; the file actually shipped empty, so a judge following the instructions would have gotten a broken app. Fix applied to the file, not the wording: `frontend/.env.example` now contains the two live public addresses (both already printed in the README itself), so the documented flow works as written.
2. **Project Structure was stale.** The `lib/` listing omitted `pendingTxStorage.ts` (Batch 6 transaction recovery) and `sessionStorage.ts` (Batch 6.3.8 session restore) — added with one-line descriptors.
3. **Wrong button name.** The cLOOT section referenced a "Reveal Balance" button; the actual Navbar label is **Reveal**. Corrected, with its location (the cLOOT pill) named.
4. **PvP had no instructions anywhere.** The Quick-Start covered Solo only. Added a short PvP paragraph using the exact UI labels (PvP Mode → Create PvP Match → share the Operation number → Join Match by ID → Join), noting the round resolves inside the second commit.
5. **Wallet wording.** Quick-Start step 1 said "connect MetaMask"; the app is wallet-agnostic. Now "connect a Web3 wallet (MetaMask, Rabby, or any injected wallet)".
6. **Frontend behavior was undocumented.** Added a "Good to know" block after the Quick-Start covering the shipped 6.3.8/6.3.9 behavior: silent reconnect (unless explicitly disconnected), same-tab refresh restore vs. tab-close = lobby, Leave Match semantics, and the 30-minute auto-hide of unfinished matches with the Resume-by-ID backdoor.

## Explicitly not changed

- The phrases "Mainnet Season 5" (header) and "Confidential Gaming track" (Project Scope): whether these match the organizer's exact category naming cannot be settled from the repo; They will be aligned with the submission form's wording at filing time.
- Everything the audit verified as exact — no verified text was touched.

## Verification

- `npx hardhat test` — 13 passing, 0 failing. `npx tsc --noEmit` — exit 0. `npm run build` — exit 0.
- Locked-file MD5s unchanged (contracts, fhe.ts, ABIs, and the real `frontend/.env` — the edited file is `.env.example`, which is not a locked file).
- The pre-filled `.env.example` values match the contract addresses printed at the top of the README and verified on Etherscan.
