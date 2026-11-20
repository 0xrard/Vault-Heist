const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying dengan akun:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Saldo Sepolia ETH:", ethers.formatEther(balance), "ETH");

  // 1. Deploy ERC-7984 HeistLootToken (cLOOT)
  const TokenFactory = await ethers.getContractFactory("HeistLootToken");
  const lootToken = await TokenFactory.deploy();
  await lootToken.waitForDeployment();
  const tokenAddress = await lootToken.getAddress();
  console.log("HeistLootToken (ERC-7984) deployed:", tokenAddress);

  // 2. Deploy VaultHeist dengan alamat token
  const GameFactory = await ethers.getContractFactory("VaultHeist");
  const vaultHeist = await GameFactory.deploy(tokenAddress);
  await vaultHeist.waitForDeployment();
  const gameAddress = await vaultHeist.getAddress();
  console.log("VaultHeist deployed:", gameAddress);

  // 3. Beri izin minting ke kontrak VaultHeist
  const tx = await lootToken.setGameContract(gameAddress);
  await tx.wait();
  console.log("Izin minting cLOOT berhasil diberikan ke VaultHeist!");

  console.log("\nSimpan ke frontend/.env dan Vercel Environment Variables:");
  console.log("VITE_CONTRACT_ADDRESS=" + gameAddress);
  console.log("VITE_TOKEN_ADDRESS=" + tokenAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
