// Deploy VaultHeist to the selected network (default: Sepolia).
// Requires in .env (NEVER commit real keys):
//   SEPOLIA_RPC_URL  - RPC endpoint for Sepolia
//   DEPLOYER_PRIVATE_KEY - testnet-only wallet key (no real assets)
const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying VaultHeist with:", deployer.address);
  const factory = await hre.ethers.getContractFactory("VaultHeist");
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log("VaultHeist deployed to:", address);
  console.log("Network:", hre.network.name, "chainId:", (await hre.ethers.provider.getNetwork()).chainId.toString());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
