import * as fs from "fs";

// Minimal .env loader (Hardhat does not read .env by itself)
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

import "@nomicfoundation/hardhat-ethers";
import "@fhevm/hardhat-plugin";
import "@nomicfoundation/hardhat-chai-matchers";
import "@typechain/hardhat";
import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { HardhatUserConfig } from "hardhat/config";

chai.use(chaiAsPromised);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
      viaIR: true,
    },
  },
  networks: {
    hardhat: { chainId: 31337 },
    sepolia: {
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL || "",
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  mocha: { timeout: 600000 },
  typechain: { outDir: "types", target: "ethers-v6" },
};

export default config;
