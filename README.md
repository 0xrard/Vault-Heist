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

**Vault Heist** solves both using Fully Homomorphic Encryption (FHE). Vault parameters, player allocations, and bot moves remain encrypted from the public and the opponent throughout the round. Scout allows a player to selectively decrypt one vault statistic through FHE access control. Only the final alarm status and round score are publicly revealed at round end.

---

## Game Rules

- **Format:** 3 Rounds, 3 Vaults (`Vault A`, `Vault B`, `Vault C`), playable in **Solo vs. Onchain Bot** or **PvP** mode.
- **Agent Budget:** Each player starts every round with **10 Agents**.
- **Hidden Vault State:** Generated every round via onchain FHE randomness:
  - **Loot:** Random `30–93` points.
  - **Alarm Limit:** Random `6–13` total agents.
- **Scout Action (Optional):** Spend **1 Agent** (budget drops to 9) to privately decrypt either the **Loot** or **Alarm Limit** of one vault via FHEVM ACL (`FHE.allow`).
- **Resolution:**
  - If `Player1Bid + Player2Bid > AlarmLimit` → **Alarm Trips!** Both players score `0` on that vault.
  - Otherwise, the higher bidder takes the full loot (ties split 50/50 via `FHE.shr`).

---

## Judge Quick-Start (Under 2 Minutes on Sepolia)

1. Open the Live Demo (link above) and connect MetaMask on **Ethereum Sepolia**.
2. Click **"Start Solo vs Syndicate AI"** (no second wallet required).
3. *(Optional)* Click **Scout Loot (-1 Agent)** or **Scout Alarm (-1 Agent)** on any vault, confirm the transaction, and sign the gas-free **EIP-712** prompt to privately decrypt that vault's secret value.
4. Allocate your agents across Vaults A, B, and C, then click **LOCK IN & START HEIST**.
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

## Project Scope & Deployment

- **Built for the Zama Developer Program campaign** (Season 5, Confidential Gaming track).
- **Deployed on Ethereum Sepolia only** — the game contract and cLOOT token addresses are listed at the top of this README.
- **No mainnet deployment is planned.** Vault Heist is a campaign submission and a demonstration of confidential gameplay with FHEVM, not a product launch.
- **cLOOT is non-monetary testnet reputation** (see the section above): it cannot be redeemed and has no mainnet supply.
- **Known privacy trade-offs are explicitly documented** in the Security & Privacy Trade-offs section below, including the acknowledged limitations of the current design.

## Security & Privacy Trade-offs

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
   (`roundDeadline` + `claimTimeout()`) would require a new contract version;
   the verified v2 contract documented here remains the submitted version for
   this campaign (see Project Scope & Deployment above).
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
   per-player (`FHE.allow(score, player)`) plus a public `p1Won` boolean would
   be the alternative design.
4. **Loot inference after a round ends (accepted).** If only Vault C is safe and
   your score rises by 72, observers infer Vault C's loot was 72. Harmless: the
   round is over and the next round re-randomizes all vaults.
5. **Second PvP submitter pays the resolve gas.** `_resolveRound` runs inside
   `submitAllocation` (`VaultHeist.sol:214/216`), so the second submitter bears
   the FHE computation for all three vaults plus the round-3 `cLOOT` mint. On
   Sepolia this is not an economic problem, and auto-resolve is the better demo
   UX (one fewer MetaMask confirmation). A standalone `resolveRound()` would be
   the alternative design.
6. **Scout after the opponent commits (minor).** In PvP, Player 2 can wait for
   Player 1's commit before scouting. This leaks nothing — bids stay encrypted —
   and only gives a small psychological edge.

### Why v2 stays the submitted version

The deployed v2 contract is Etherscan-verified and a full live match (Match #1)
completed end-to-end onchain, including `RewardsMinted`. Proof: the Match #1
final-round transaction on Sepolia Etherscan,
[0x91958806…a67a](https://sepolia.etherscan.io/tx/0x91958806cad839da7e813eef38acb67911b1358f4427c0a5cb4b3ac4837ae67a),
contains the round-3 `RoundResolved`, the `RewardsMinted` event, and the cLOOT
mint to the winner in a single transaction. It is the submitted
version for this campaign, and no redeploy is planned (see Project Scope &
Deployment above). The limitations listed here are documented openly rather
than fixed by disturbing a verified, working deployment.

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
│   ├── VaultHeist.test.ts      # Mock FHEVM suite (Solo, ACL, Overflow, 3-Round)
│   ├── VaultHeist.test.js      # FHEVM suite (Solo, Scout ACL, budget validation, resolution)
│   └── ClootRewards.test.js    # cLOOT ERC-7984 reward tests
└── frontend/                   # Vite + React + Zama Relayer SDK
    └── src/
        ├── components/         # GameArena, Lobby, VaultCard, VaultDoor, RoundHistory,
        │                       # Navbar, MatchSummaryModal, MissionBriefingModal,
        │                       # PrivacyExplainerModal, SyndicateBar, TxProgress,
        │                       # CinematicReveal
        └── lib/                # contracts.ts, fhe.ts, scoutStorage.ts, sfx.ts,
                                # streakStorage.ts, usePrefersReducedMotion.ts
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
