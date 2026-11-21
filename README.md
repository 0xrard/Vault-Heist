# Vault Heist — Confidential Onchain Strategy Game

> **Disclaimer:** This project is not audited, endorsed or operated by Zama. Use at your own risk.

**Vault Heist** is a blind-allocation, push-your-luck heist game built on the **Zama Protocol (FHEVM)** for the **Zama Developer Program Mainnet Season 5: Confidential Gaming**.

> **Live Demo (Sepolia):** [https://vault-heist-ten.vercel.app/](https://vault-heist-ten.vercel.app/)
> **Game Contract (Sepolia):** [https://sepolia.etherscan.io/address/0xB3B5966F36c80c8755EA667a0d74749a8306c5A7](https://sepolia.etherscan.io/address/0xB3B5966F36c80c8755EA667a0d74749a8306c5A7)
> **cLOOT Token — ERC-7984 (Sepolia):** [https://sepolia.etherscan.io/address/0x8475A387a5D9A943975DD2F73819936b98e0320a](https://sepolia.etherscan.io/address/0x8475A387a5D9A943975DD2F73819936b98e0320a)
> **3-Minute Pitch Video:** [TO BE FILLED — after recording]
> **X Announcement:** [TO BE FILLED — after posting]

---

## Why This Game Breaks on a Transparent Blockchain

On a public blockchain, simultaneous strategy games suffer from two fatal flaws:
1. **Last-Block Sniping:** If crew allocations are visible in the mempool or contract state, the second player always counters the first.
2. **Trivial Math Instead of Psychology:** If vault payouts and alarm limits are readable via `eth_getStorageAt`, the tension of over-committing disappears.

**Vault Heist** solves both using Fully Homomorphic Encryption (FHE). Vault parameters, player allocations, and bot moves remain encrypted throughout the round—only the final alarm status and round score are revealed.

---

## Game Rules

- **Format:** 3 Rounds, 3 Vaults (`Vault A`, `Vault B`, `Vault C`), playable in **Solo vs. Onchain Bot** or **PvP** mode.
- **Crew Budget:** Each player starts every round with **10 Crew Points**.
- **Hidden Vault State:** Generated every round via onchain FHE randomness:
  - **Loot:** Random `30–93` points.
  - **Alarm Limit:** Random `6–13` total crew points.
- **Scout Action (Optional):** Sacrifice **1 Crew Point** (budget drops to 9) to privately decrypt either the **Loot** or **Alarm Limit** of one vault via FHEVM ACL (`FHE.allow`).
- **Resolution:**
  - If `Player1Bid + Player2Bid > AlarmLimit` → **Alarm Trips!** Both players score `0` on that vault.
  - Otherwise, the higher bidder takes the full loot (ties split 50/50 via `FHE.shr`).

---

## Judge Quick-Start (Under 2 Minutes on Sepolia)

1. Open the Live Demo (link above) and connect MetaMask on **Ethereum Sepolia**.
2. Click **"Mulai Solo vs Bot Onchain"** (no second wallet required).
3. *(Optional)* Click **Scout** on any vault, confirm the transaction, and sign the gasless **EIP-712** prompt to privately decrypt that vault's secret value.
4. Allocate your crew points across Vaults A, B, and C, then click **Enkripsi & Kirim Alokasi**.
5. View the decrypted alarm triggers and updated scoreboard, and finish all 3 rounds.

---

## FHE Architecture & Security Highlights

### Encrypted State & ACL Flow

| State Variable | Type | Visibility / ACL Policy |
| :--- | :--- | :--- |
| `vault.loot` | `euint8` | Onchain FHE RNG. Private until a player calls `scoutVault()` (`FHE.allow`). |
| `vault.alarmLimit` | `euint8` | Onchain FHE RNG. Private until scouted; never publicly revealed. |
| `p1Bids` / `p2Bids` | `euint8[3]` | Client-side encrypted (`externalEuint8` + ZK proof). Never publicly revealed. |
| `vault.alarmTripped` | `ebool` | Computed homomorphically; revealed via `FHE.makePubliclyDecryptable` at round end. |
| `score1` / `score2` | `euint16` | Accumulated homomorphically; publicly decryptable at round end. |

### Confidential Reward Token — `cLOOT` (ERC-7984)

Finishing a match mints the player's final score as a **confidential ERC-7984 token** (`HeistLootToken`, symbol `cLOOT`, built on OpenZeppelin Confidential Contracts): `reward = finalScore × 100`, computed homomorphically from the encrypted score (`euint16` → `euint64`) and minted cross-contract via a transient ACL grant (`FHE.allowTransient`). Balances are encrypted `euint64` values — only the owner can decrypt their own balance, via the same EIP-712 user-decryption flow as Scout (the frontend's **Reveal Balance** button). In PvP both players are paid; in Solo mode only the human player (the bot has no wallet).

### Key Technical Safeguards
- **Verifiable Onchain Fairness:** Vault stats and onchain bot allocations are generated with `FHE.randEuint8()` using bitmasking (`FHE.and`) for gas efficiency—neither players nor the deployer know the safe limits.
- **Branchless Validation & `euint8` Overflow Protection:** Because `100 + 100 + 60 = 260` wraps around to `4` in `uint8`, `_validateBudget()` checks both individual bid caps (`bid <= maxBudget`) and total sum (`sum <= maxBudget`) homomorphically. Invalid or over-budget submissions are silently zeroed out via `FHE.select` without leaking values.

## cLOOT Is Testnet Reputation Points (Non-Monetary)

`cLOOT` exists only on Sepolia testnet. It is a **testnet reputation / confidential
points** demonstration of the ERC-7984 standard — it has no monetary value, no
mainnet supply, and no redemption. `reward = finalScore × 100`, minted at the end
of a match. Farming it in Solo mode costs nothing but Sepolia gas, which is
expected for a demo and is not a mainnet economic claim.

## Security, Privacy Trade-offs & Mainnet Economy Roadmap

This section documents the findings of an internal design audit (2026-11-21:
Gemini audit + Muse verification against the deployed contract source). This is
**not** an external audit. The contract is unaudited; the disclaimer at the top
of this README stands.

### What stays encrypted, and who can decrypt it

| Asset | Who can decrypt | Status |
| --- | --- | --- |
| `vault.loot`, `vault.alarmLimit` | Only a player who called `scoutVault()` (`FHE.allow(handle, msg.sender)`) | Private by ACL |
| `p1Bids`, `p2Bids` | Only the contract (`FHE.allowThis`); never opened to the public or to the opponent | Private |
| `alarmTripped`, `score1`, `score2` | Public (`FHE.makePubliclyDecryptable`) after the round ends | Public by design — see leaks below |
| `cLOOT` balance (ERC-7984) | Only the wallet owner (via `FHE.allowTransient` to `HeistLootToken`) | Private |

### Known limitations (acknowledged, not hidden)

1. **No PvP timeout (most serious).** There is no `deadline`, `claimTimeout`, or
   `timeout` anywhere in `VaultHeist.sol` (verified by source search). If Player 1
   has committed and Player 2 goes AFK, the match locks in `Active` forever; a
   match in `WaitingPlayer` with no joiner cannot be cancelled either. A fix
   (`roundDeadline` + `claimTimeout()`) is a v3 contract change, deliberately
   deferred until after the Payday Agent deadline (see below) so the verified v2
   submission is not disturbed.
2. **Scout target leaks via event.** `VaultScouted(..., uint8 vaultIdx, bool
   isAlarm)` (`VaultHeist.sol:59`, emitted at `:155`) is plaintext, as is the
   `scoutVault` transaction itself. In PvP an observer can learn *which* vault was
   scouted and whether loot or alarm was checked — but never the value. Framed as
   design: the opponent reading your scout is a bluff/bait signal. Full privacy
   would need `vaultIdx` as `externalEuint8` selected via `FHE.select`.
3. **Public scores imply cLOOT rewards.** `score1`/`score2` are made publicly
   decryptable (`VaultHeist.sol:315–316`), and the reward formula is public
   (`score × 100`), so an onchain observer can compute one match's mint — even
   though the cumulative `cLOOT` balance stays encrypted. Keeping scores private
   per-player (`FHE.allow(score, player)`) plus a public `p1Won` boolean is the
   mainnet alternative.
4. **Loot inference after a round ends (accepted).** If only Vault C is safe and
   your score rises by 72, observers infer Vault C's loot was 72. Harmless: the
   round is over and the next round re-randomizes all vaults.
5. **Second PvP submitter pays the resolve gas.** `_resolveRound` runs inside
   `submitAllocation` (`VaultHeist.sol:214/216`), so the second submitter bears
   the FHE computation for all three vaults plus the round-3 `cLOOT` mint. On
   Sepolia this is not an economic problem, and auto-resolve is the better demo
   UX (one fewer MetaMask confirmation). A standalone `resolveRound()` is the
   mainnet alternative.
6. **Scout after the opponent commits (minor).** In PvP, Player 2 can wait for
   Player 1's commit before scouting. This leaks nothing — bids stay encrypted —
   and only gives a small psychological edge.

### Mainnet economy roadmap (not implemented — testnet only)

- **PvP escrow / wager pool:** rewards come from a zero-sum pool staked by both
  players (cUSDT / cLOOT locked in the contract), never minted from nothing —
  so two-wallet collusion cannot profit.
- **Solo daily cap & win-only mint:** Solo rewards capped per day (e.g. max 3
  rewarded matches/day, further matches are Practice Mode) and full rewards only
  for beating the bot.
- **Token sink:** `cLOOT` burnable for one-use tactical items (e.g. Extra Scout,
  Alarm Jammer) or to unlock a High-Stakes Vault.

### Why v2 stays the submitted version

The deployed v2 contract is Etherscan-verified and a full live match (Match #1)
completed end-to-end onchain, including `RewardsMinted`. A v3 with timeout and
anti-farming limits would be a separate deploy only after Payday Agent finishes
(~7–10 Dec 2026), and only replaces v2 in the submission if it passes the same
test battery (10/10 unit tests + a full live match).

---

## Project Structure

```text
vault-heist/
├── contracts/
│   ├── VaultHeist.sol          # Core FHEVM game contract
│   └── HeistLootToken.sol      # ERC-7984 confidential reward token (cLOOT)
├── scripts/
│   └── deploy.ts               # Sepolia deployment script
├── test/
│   └── VaultHeist.test.ts      # Full mock FHEVM test suite (Solo, ACL, Overflow, 3-Round)
└── frontend/                   # Vite + React + Zama Relayer SDK
```

## Local Setup & Testing

### 1. Smart Contract & FHEVM Unit Tests

```bash
npm install
npx hardhat compile
npx hardhat test
```

### 2. Deploy to Sepolia

Copy `.env.example` to `.env` and fill in your Sepolia RPC URL and deployer private key (testnet wallet only), then:

```bash
npx hardhat run scripts/deploy.ts --network sepolia
```

Deployed contracts (Sepolia): VaultHeist `0xB3B5966F36c80c8755EA667a0d74749a8306c5A7`, HeistLootToken (cLOOT) `0x8475A387a5D9A943975DD2F73819936b98e0320a`

### 3. Run Frontend Locally

```bash
cd frontend
npm install
cp .env.example .env   # VITE_CONTRACT_ADDRESS is pre-filled with the live Sepolia contract
npm run dev
```

## License

MIT
