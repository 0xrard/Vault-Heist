# Vault Heist — Frontend

React + TypeScript + Vite single-page app for **Vault Heist**, a confidential
onchain strategy game on Zama FHEVM (Ethereum Sepolia). See the project README
at the repository root for the game rules, deployed contract addresses, and
the security/privacy documentation.

The app talks to the deployed `VaultHeist` contract through ethers.js and the
Zama Relayer SDK: crew allocations are encrypted in the browser before they
are submitted, Scout results are decrypted privately via EIP-712 user
decryption, and round results are publicly decrypted after each round
resolves. Wallet signatures and transactions go through MetaMask; all
read-only chain queries use a public Sepolia RPC.

## Setup

```bash
npm install
npm run dev
```

## Environment

Contract addresses come from Vite environment variables in `frontend/.env`:

- `VITE_CONTRACT_ADDRESS` — the deployed VaultHeist game contract (Sepolia)
- `VITE_TOKEN_ADDRESS` — the deployed HeistLootToken (cLOOT, ERC-7984)

Copy `.env.example` to `.env` if present, or create `.env` with the two
variables above. The live Sepolia addresses are listed in the root README.
Never put a private key in this file; the frontend only ever asks the
connected wallet to sign.

## Scripts

- `npm run dev` — start the dev server
- `npm run build` — type-check (`tsc -b`) and production build
- `npm run preview` — preview the production build
