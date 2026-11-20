const { expect } = require("chai");
const hre = require("hardhat");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("VaultHeist — Hadiah cLOOT (ERC-7984)", function () {
  let token, game, gameAddr, tokenAddr;
  let alice, bob;

  async function encryptBids(signer, bids) {
    const input = hre.fhevm.createEncryptedInput(gameAddr, signer.address);
    input.add8(bids[0]);
    input.add8(bids[1]);
    input.add8(bids[2]);
    const enc = await input.encrypt();
    return { handles: enc.handles, inputProof: enc.inputProof };
  }

  async function balanceOf(signer) {
    const handle = await token.confidentialBalanceOf(signer.address);
    return hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddr, signer);
  }

  beforeEach(async function () {
    if (!hre.fhevm.isMock) this.skip();
    [alice, bob] = await hre.ethers.getSigners();

    const tokenFactory = await hre.ethers.getContractFactory("HeistLootToken");
    token = await tokenFactory.deploy();
    await token.waitForDeployment();
    tokenAddr = await token.getAddress();

    const gameFactory = await hre.ethers.getContractFactory("VaultHeist");
    game = await gameFactory.deploy(tokenAddr);
    await game.waitForDeployment();
    gameAddr = await game.getAddress();

    await (await token.setGameContract(gameAddr)).wait();
  });

  it("Solo: match selesai -> RewardsMinted, saldo cLOOT Alice = skor akhir x 100", async function () {
    await (await game.connect(alice).createMatch(true)).wait();

    let lastTx;
    for (let r = 0; r < 3; r++) {
      const enc = await encryptBids(alice, [4, 3, 3]);
      lastTx = await game.connect(alice).submitAllocation(0, enc.handles, enc.inputProof);
      await lastTx.wait();
    }

    await expect(lastTx).to.emit(game, "RewardsMinted").withArgs(0, alice.address, hre.ethers.ZeroAddress);

    const m = await game.matches(0);
    expect(m.state).to.equal(2); // Finished
    const finalScore = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m.score1);

    const balance = await balanceOf(alice);
    console.log(`      Skor akhir Alice: ${finalScore} -> saldo cLOOT: ${balance}`);
    expect(balance).to.equal(finalScore * 100n);
  });

  it("PvP: kedua pemain menerima cLOOT sesuai skor masing-masing", async function () {
    await (await game.connect(alice).createMatch(false)).wait();
    await (await game.connect(bob).joinMatch(0)).wait();

    for (let r = 0; r < 3; r++) {
      const encA = await encryptBids(alice, [5, 3, 2]);
      await (await game.connect(alice).submitAllocation(0, encA.handles, encA.inputProof)).wait();
      const encB = await encryptBids(bob, [2, 3, 5]);
      await (await game.connect(bob).submitAllocation(0, encB.handles, encB.inputProof)).wait();
    }

    const m = await game.matches(0);
    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m.score1);
    const s2 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m.score2);

    const balA = await balanceOf(alice);
    const balB = await balanceOf(bob);
    console.log(`      Skor Alice ${s1} -> cLOOT ${balA} | Skor Bob ${s2} -> cLOOT ${balB}`);
    expect(balA).to.equal(s1 * 100n);
    expect(balB).to.equal(s2 * 100n);
  });

  it("Saldo cLOOT bersifat rahasia: orang luar tidak bisa mendekripsi saldo Alice", async function () {
    await (await game.connect(alice).createMatch(true)).wait();
    for (let r = 0; r < 3; r++) {
      const enc = await encryptBids(alice, [4, 3, 3]);
      await (await game.connect(alice).submitAllocation(0, enc.handles, enc.inputProof)).wait();
    }

    const handle = await token.confidentialBalanceOf(alice.address);
    await expect(
      hre.fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddr, bob)
    ).to.be.rejected;
  });
});
