# Batch 6.3.8 — Silent Wallet Reconnect + Active-Match Session Restore

**Date:** 23 November 2026
**Type:** Frontend-only UX fix (one new lib file, one component touched). No contract changes, no GameArena changes.
**Trigger:** During the live QA session (23 Nov), the same friction kept recurring: after connecting the wallet and entering a match, any page refresh dropped the player back to the home/lobby screen and demanded a manual Connect click — even though the wallet still remembered the site's authorization. Root cause, verified from the code: `App.tsx` held `screen` / `matchId` / `signer` / `address` purely in React state, nothing persisted the active match, and the only `eth_requestAccounts` call lived behind the Connect button — the app never asked the wallet silently (`eth_accounts`) on load.

## Design

Two mechanisms, both built on the project's standing rule: **localStorage is a hint, never the truth; the chain decides.**

### 1. Session hint store — new file `frontend/src/lib/sessionStorage.ts`

Written in the style of `lib/pendingTxStorage.ts` (same header discipline, same never-throw rule):

- Key: `vaultheist:session:{chainId}:{contractAddress}` — chainId from the existing `SEPOLIA_CHAIN_ID` constant (`lib/fhe.ts`), contract from the existing `CONTRACT_ADDRESS` constant (`lib/contracts.ts`); no duplicated constants.
- Record: JSON `{ matchId, address }` — public session metadata only, never any credential.
- `saveSessionHint(matchId, address): boolean` — validates inputs (positive-integer matchId, well-formed address) before writing; returns false on any failure.
- `loadSessionHint(): { matchId, address } | null` — full validation on read: JSON must parse to an object, `matchId` a positive integer, `address` matching `/^0x[0-9a-f]{40}$/i`. The raw value is compared against `null`, not falsiness, so an empty string is treated as a corrupt record that fails validation, not as an absent one (the Batch 6.3.3 lesson).
- `clearSessionHint()` — removeItem, no-op on error.
- Every function is wrapped in try/catch and never throws: unavailable storage degrades to exactly the pre-6.3.8 behavior.

### 2. Session persistence — `App.tsx` effect on `[screen, matchId, address]`

When `screen === "arena"` with a matchId and address, the hint is saved; when `screen === "lobby"`, it is cleared. No flow function was changed: this automatically covers every existing path — entering via solo/PvP/resume (all funnel through `enterArena`), leaving via the summary modal's `setScreen("lobby")`, and the `accountsChanged` handler, which already resets to the lobby.

### 3. Silent reconnect + restore — `App.tsx` mount-once effect

Guarded by a `useRef` flag so it runs at most once per page load:

1. No `window.ethereum` → do nothing.
2. `eth_accounts` (never prompts): empty → do nothing. The app starts exactly as before — lobby, disconnected, no error banner.
3. An authorized account exists → build a `BrowserProvider`, take its signer, and set `signer` / `address` / `chainId` — the same state sets as `ensureWallet()`'s connect path, but **without** `eth_requestAccounts` and **without** `ensureSepolia()`: a page load must never pop a connect or chain-switch prompt. If the wallet is on a wrong network, the restore stops there (connection state kept, hint kept) and the existing wrong-network UI handles it — this gate also matters because `resume()`'s fast path internally calls `ensureSepolia()`, so `resume()` is only invoked when the chain is already Sepolia.
4. Session restore: `loadSessionHint()`; if the hint's address differs from the reconnected account (case-insensitive), the hint is cleared and nothing is entered — one wallet's hint never enters another wallet into a match. The match is then fetched through the public read contract; **only if `state === 1` (Active)** does the effect re-enter, via the existing `resume()` (called through `resumeRef`, the file's established pattern, so `ensureWallet()` inside `resume()` sees the signer set in step 3 and takes its fast path). `resume()` re-validates that the connected address is a participant and rebuilds scores and history from chain. A Waiting (0) or Finished (2) match, a failed fetch, or any other failure clears or ignores the hint and leaves the app in the lobby.
5. The whole effect is wrapped so any failure leaves the app exactly as it was before this batch.

## Files changed

- **New:** `frontend/src/lib/sessionStorage.ts` (87 lines).
- **Modified:** `frontend/src/App.tsx` (451 → 523 lines):
  - Line 3: `BrowserProvider` added to the ethers import.
  - Line 17: `SEPOLIA_CHAIN_ID` added to the `lib/fhe` import.
  - Line 27: session-hint functions imported from `./lib/sessionStorage`.
  - Lines 94–108: session-persistence effect.
  - Lines 366–419: silent reconnect + session restore effect (placed beside `resumeRef`, which it uses).
  - `enterArena`, `resume`, `ensureWallet`, and all flow functions are byte-identical to before.
- **Not touched:** `contracts/`, `frontend/src/lib/fhe.ts`, `frontend/src/abi/`, `frontend/.env`, `frontend/src/components/GameArena.tsx`, every other lib file, and `FREEZE.md`.

## Regression risks

- **Batch 6 / 6.3 fail-closed paths: untouched by construction.** GameArena is not modified at all; its four-state commit status, hash gate, pending-tx hydration, and Scout restore run exactly as QA proved them. The new restore path enters the arena exclusively through the pre-existing `resume()` → `enterArena()` funnel, so a restored arena goes through the same chain-derived rebuild and the same GameArena verification as a manual resume from the lobby list.
- **The hint cannot create state.** It carries only a matchId and an address. It is honored only after two independent chain-side checks (address match against the wallet's own account; match state read fresh from the contract), and participation is re-validated a third time inside `resume()`. A forged or stale hint can at worst cause one wasted read call; it cannot enter a finished/waiting match, another wallet's match, or fabricate scores.
- **No new prompts.** `eth_accounts` is a read-only, non-prompting call; `eth_requestAccounts` is never called on load, and the chain gate keeps `ensureSepolia()`'s switch prompt out of the load path. A first-time visitor sees exactly the old behavior.
- **Failure mode is the old behavior.** Every new code path is wrapped; any exception (storage blocked, RPC down, wallet locked) resolves to lobby-as-before with no error banner.
- **One behavioral nuance to watch in live testing:** during a successful restore, `resume()` sets the lobby's `busy` state to `"resume"` while it rebuilds — a brief loading indication in the lobby before the arena opens. This is `resume()`'s existing behavior on the manual path as well.

## Verification (run from the local tree, 23 Nov 2026)

- `npx tsc --noEmit` in `frontend/` — exit 0.
- `npm run build` — exit 0 ("✓ built in 2.88s"; only the pre-existing chunk-size warning).
- `npx hardhat test` at project root — **13 passing, 0 failing** (contracts untouched).
- Locked-file MD5s — all identical to baseline:
  - `contracts/VaultHeist.sol` — `8b9240785791a1dfcf87e21a925d1b71`
  - `contracts/HeistLootToken.sol` — `ac30a967b2a670c1f46c7018cfa7085e`
  - `frontend/.env` — `3d3fdb9b2b89541503ef2b6c3095a1aa`
  - `frontend/src/lib/fhe.ts` — `b92c0c3b6cbb05a7818521692fe8a449`
  - `frontend/src/abi/VaultHeist.json` — `4b90e7ad0763543259f54cfd98803e63`
  - `frontend/src/abi/HeistLootToken.json` — `31f13e0ff2b88fb3d2e9b76d9ffc3b4b`

## Status

Implemented and statically verified in the local tree. **Not zipped, not deployed.** This batch changes load-time behavior, so per the freeze rule it supersedes the Batch 6.3.7 freeze (`FREEZE.md`, left untouched by this batch) **only after the live tests pass** — the agreed test list: silent reconnect with an authorized wallet (no click, no popup); no-popup behavior with no authorized account; account-switch followed by refresh follows the new account; refresh mid-Solo restores the same arena; refresh mid-PvP as player 2 restores as player 2; refresh during a pending commit and after Scout use keep the Batch 6 recovery paths intact (regression); refresh on a finished match and with a foreign wallet's hint stay in the lobby; one full Solo to Finished; leave-then-refresh does not bounce back. After those pass, the freeze record is re-issued on top of 6.3.8.

## Addendum — Disconnect (added before live testing)

While reviewing the connected-wallet pill during 6.3.8 testing prep, it was noted the app had no log out at all: the pill was a plain status display, and the only way to disconnect was from inside the wallet extension. A **Disconnect** action is now part of this batch (added before the batch shipped, so it is covered by the same live test pass).

**What was added:**

- **`frontend/src/components/Navbar.tsx`** — new `onDisconnect` prop. The connected pill is now a button (same visuals, plus a `ChevronDown` icon) opening a small right-aligned dropdown whose single item is **Disconnect** (with the `LogOut` icon). A transparent full-screen backdrop closes the menu on an outside click. The wrong-network and Connect branches are unchanged.
- **`frontend/src/App.tsx`** — new `handleDisconnect()`: clears the signer and address and returns to the lobby. The session hint needs no explicit clearing there: the existing session-persistence effect clears it automatically when the screen becomes "lobby". `onDisconnect={handleDisconnect}` is passed to `Navbar`.
- **`frontend/src/lib/sessionStorage.ts`** — a "user disconnected" opt-out marker under the key `vaultheist:disconnected:{chainId}:{contractAddress}` (same context binding as the session hint), with `setDisconnectedMarker()` / `isDisconnectedMarkerSet()` / `clearDisconnectedMarker()` under the same never-throw discipline as the hint helpers. `handleDisconnect()` sets it; the silent reconnect/restore effect checks it **first** and returns immediately while it is set; `ensureWallet()` clears it in its full-connect branch only.

**Opt-out marker semantics — why it exists:** silent reconnect is designed to undo *accidental* disconnects (a page refresh). Without the marker, an *explicit* Disconnect would be silently undone by the very next page load — the user would click "log out" and find themselves logged back in after any refresh, which reads as the app ignoring them. The marker records the deliberate choice so reconnect honors it across loads. Conversely, a manual **Connect** clears the marker: an explicit connect is a fresh opt-in, and from that point silent reconnect and session restore resume as designed. The marker stores no credential — just the fact of the choice, bound to chain + contract like the hint.

**Two live tests added to the agreed list:**

- **(13)** Disconnect → refresh: the app stays disconnected (no silent reconnect), and the session hint is gone (no arena restore is attempted).
- **(14)** After a Disconnect, a manual Connect connects normally; a later refresh then silently reconnects and restores again (the marker was cleared by the manual Connect).


## Addendum 2 — Mount-ordering fix (found by live test 6, before re-freeze)

**Finding (23 Nov, live):** Test 6 (refresh as PvP player 2, match #18) failed: the wallet-2 browser landed in the lobby. Evidence ruled out the mundane causes — the deployed bundle was current (Disconnect chevron present), silent reconnect had succeeded (pill showed the correct player-2 address), and the match was Active onchain with the correct player2. The session hint was gone by the time the restore effect read it.

**Root cause:** The session-persistence effect ran on the initial mount with `screen === "lobby"` and cleared the hint unconditionally; effects run in declaration order, so the clear executed before the restore effect's asynchronous `loadSessionHint()`. Whether a restore succeeded depended on effect timing and on the manual Resume path masking the flaw, not on the design being correct.

**Fix (`App.tsx`, persistence effect only):** the clear branch now requires a real arena → lobby transition, tracked with a `prevScreenRef`. The initial mount no longer clears. Restore-time failure branches (address mismatch, match not Active, fetch failure) still clear the hint inside the restore effect itself, and genuine exits (leave button, account change, Disconnect) are all arena → lobby transitions, so they still clear exactly as before.

**Re-test required:** Test 6 (PvP player-2 refresh restore) and Test 5 (Solo refresh restore) on the rebuilt package.


## Addendum 3 — Leave Match button (requested during live testing)

**Gap found (23 Nov, live):** The arena had no exit at all during an active match — the only route back to the lobby was the finished-match summary. Before session restore this was masked by refresh-to-lobby; with restore working, a player was effectively trapped in an active arena.

**Change:** A persistent **Leave Match** button in the arena header (next to the operation number), wired through a new `onLeave` prop to the existing `setScreen("lobby")` path in `App.tsx`. Leaving is view-level only: the match stays Active onchain (the contract has no forfeit function) and can be resumed anytime from the lobby's match history; the arena → lobby transition clears the session hint, so a later refresh stays in the lobby (this is exactly what test 12 exercises). Leaving while a commit is confirming is safe by the Batch 6.3 design: the pending-transaction record is written by the send flow itself, independent of the arena staying mounted.


## Addendum 4 — Boot splash instead of the lobby flash (found by live test 5 re-run)

**Finding (23 Nov, live, video evidence):** On the fixed build, test 5's restore worked — refresh during Solo match #19 returned to the same arena — but the lobby painted in full for about a second first (the app's initial screen is the lobby; the asynchronous restore lands only after the wallet check and one chain read). Functionally a pass, visually a glitch.

**Fix (`App.tsx` only):** A `bootRestoring` state, initialized synchronously on first render: true only when a session hint exists and the Disconnect marker is not set (both localStorage helpers never throw, so the initializer is safe). While true, the first paint is a minimal "Reconnecting to your match…" splash instead of the lobby. The restore effect clears it in a `finally`, and an 8-second hard cap guarantees the splash can never trap the player if the wallet or RPC stalls (the restore may still complete afterwards and enter the arena then). Visits without a hint, and visits after an explicit Disconnect, render the lobby immediately, exactly as before.


## Addendum 5 — Refresh restores; a closed tab does not (design call)

**Design call (23 Nov, live testing):** Test 10's first half exposed a semantics question: after closing the tab, reopening with the same wallet dropped the player straight back into the arena. The call: closing the tab is leaving. A refresh inside the same tab is an accident to recover from (automatic restore); a new tab is a new visit that must start in the lobby, with re-entry a deliberate Resume click — especially since PvP matches have no timeout and can be days old.

**Change:** New `claimTabSession()` in `lib/sessionStorage.ts`, built on `sessionStorage` (survives a same-tab refresh, dies with the tab; result memoized per page load). The restore effect now discards the hint and stays in the lobby when the load is a fresh tab, and the boot splash only arms for same-tab loads. Everything else is unchanged: silent reconnect still applies in the lobby (the wallet pill connects without a click), the address gate still guards the refresh path, and the Disconnect marker still wins over everything.

**Revised test expectations:** Test 10 first half now expects lobby (not arena) after tab close + reopen with the same wallet; foreign wallet still expects lobby. Test 6 (wallet-2 refresh restore) is unaffected — it is a same-tab refresh.


**Addendum 5 clarification (same day):** "still auto-connect, but stay in the lobby." The silent wallet reconnect is independent of arena restore and applies to every visit (unless the Disconnect marker is set): a fresh tab lands in the lobby **with the wallet already connected**; only the automatic arena entry is reserved for same-tab refreshes. The tab-session gate therefore sits after the reconnect and chain check inside the restore effect, immediately before the hint is loaded.


## Addendum 6 — Privacy button label cleaned (during freeze)

The navbar privacy button rendered a HelpCircle icon plus a literal "? " before its label — a doubled question mark. Both are removed; the button now reads simply **How Privacy Works**. The unused `HelpCircle` import was removed with it, and the matching comment in `PrivacyExplainerModal.tsx` was updated. No behavior change; the button still opens the same modal. This was the last change before the 6.3.8 freeze.
