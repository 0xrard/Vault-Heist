import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying VaultHeist dengan akun:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Saldo Sepolia ETH:", ethers.formatEther(balance), "ETH");

  const VaultHeist = await ethers.getContractFactory("VaultHeist");
  const vaultHeist = await VaultHeist.deploy();
  await vaultHeist.waitForDeployment();

  const address = await vaultHeist.getAddress();
  console.log("VaultHeist berhasil dideploy ke Sepolia di:", address);
  console.log("\nSimpan alamat di atas ke frontend/.env sebagai VITE_CONTRACT_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
