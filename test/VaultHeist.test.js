const { expect } = require("chai");
const hre = require("hardhat");
const { FhevmType } = require("@fhevm/hardhat-plugin");

describe("VaultHeist (mock FHEVM)", function () {
  let contract, addr, player;

  before(async function () {
    [player] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("VaultHeist");
    contract = await factory.deploy();
    addr = await contract.getAddress();
  });

  async function encBids(a, b, c) {
    return hre.fhevm
      .createEncryptedInput(addr, player.address)
      .add8(a)
      .add8(b)
      .add8(c)
      .encrypt();
  }

  it("Match A: scout reveals loot in range via ACL, valid submit advances round", async function () {
    await contract.connect(player).createMatch(true); // matchId 0
    const m0 = await contract.matches(0);
    expect(m0.state).to.equal(1n); // Active
    expect(m0.currentRound).to.equal(1n);

    // Scout loot of vault 0 (costs 1 crew -> budget 9 this round)
    await contract.connect(player).scoutVault(0, 0, false);
    const [lootHandle] = await contract.getVaultHandles(0, 1, 0);
    const loot = await hre.fhevm.userDecryptEuint(
      FhevmType.euint8,
      lootHandle,
      addr,
      player,
    );
    console.log("    scouted loot vault0 =", loot.toString());
    expect(loot).to.be.gte(30n).and.to.be.lte(93n);

    // Valid allocation within scouted budget: 4+3+2 = 9
    const enc = await encBids(4, 3, 2);
    await contract.connect(player).submitAllocation(0, enc.handles, enc.inputProof);

    const m0after = await contract.matches(0);
    expect(m0after.currentRound).to.equal(2n); // round advanced -> resolution ran

    // Scores are publicly decryptable after the round
    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m0after.score1);
    const s2 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m0after.score2);
    console.log("    after R1: score1 =", s1.toString(), " score2(bot) =", s2.toString());
    expect(s1).to.be.gte(0n);
    expect(s2).to.be.gte(0n);
  });

  it("Match B: wrap-around cheat bids [100,100,60] are zeroed (player scores 0)", async function () {
    await contract.connect(player).createMatch(true); // matchId 1
    const enc = await encBids(100, 100, 60); // each > cap 10 -> invalid -> all zero
    await contract.connect(player).submitAllocation(1, enc.handles, enc.inputProof);

    const m1 = await contract.matches(1);
    expect(m1.currentRound).to.equal(2n);
    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m1.score1);
    console.log("    cheater score1 =", s1.toString());
    expect(s1).to.equal(0n);
  });

  it("Match C: over-budget bids [10,10,10] are zeroed too", async function () {
    await contract.connect(player).createMatch(true); // matchId 2
    const enc = await encBids(10, 10, 10); // total 30 > 10 -> invalid
    await contract.connect(player).submitAllocation(2, enc.handles, enc.inputProof);

    const m2 = await contract.matches(2);
    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m2.score1);
    console.log("    over-budget score1 =", s1.toString());
    expect(s1).to.equal(0n);
  });

  it("Match E: PvP — join, both commit, round resolves only after 2nd commit", async function () {
    const [, player2] = await hre.ethers.getSigners();
    await contract.connect(player).createMatch(false); // matchId 3
    let m = await contract.matches(3);
    expect(m.state).to.equal(0n); // WaitingPlayer

    await contract.connect(player2).joinMatch(3);
    m = await contract.matches(3);
    expect(m.state).to.equal(1n); // Active

    const enc1 = await encBids(6, 4, 0);
    await contract.connect(player).submitAllocation(3, enc1.handles, enc1.inputProof);
    m = await contract.matches(3);
    expect(m.currentRound).to.equal(1n); // NOT resolved yet — waiting for P2

    const enc2 = await hre.fhevm
      .createEncryptedInput(addr, player2.address)
      .add8(0)
      .add8(3)
      .add8(6)
      .encrypt();
    await contract.connect(player2).submitAllocation(3, enc2.handles, enc2.inputProof);
    m = await contract.matches(3);
    expect(m.currentRound).to.equal(2n); // resolved after both committed

    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m.score1);
    const s2 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m.score2);
    console.log("    PvP R1: score1 =", s1.toString(), " score2 =", s2.toString());
  });

  it("Match D: full 3-round game finishes", async function () {
    await contract.connect(player).createMatch(true); // matchId 4
    const plays = [
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ];
    for (const [a, b, c] of plays) {
      const enc = await encBids(a, b, c);
      await contract.connect(player).submitAllocation(4, enc.handles, enc.inputProof);
    }
    const m3 = await contract.matches(4);
    expect(m3.state).to.equal(2n); // Finished
    const s1 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m3.score1);
    const s2 = await hre.fhevm.publicDecryptEuint(FhevmType.euint16, m3.score2);
    console.log("    final: score1 =", s1.toString(), " score2(bot) =", s2.toString());
  });
});
