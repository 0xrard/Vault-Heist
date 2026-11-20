import { expect } from "chai";
import { ethers, fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { VaultHeist } from "../types";

describe("VaultHeist (FHEVM)", function () {
  let vaultHeist: VaultHeist;
  let contractAddress: string;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let eve: HardhatEthersSigner;

  // Helper untuk mengenkripsi 3 angka bid (euint8) sekaligus dalam 1 proof
  async function encryptBids(
    signer: HardhatEthersSigner,
    bids: [number, number, number]
  ) {
    const input = fhevm.createEncryptedInput(contractAddress, signer.address);
    input.add8(bids[0]);
    input.add8(bids[1]);
    input.add8(bids[2]);
    const encrypted = await input.encrypt();
    return {
      handles: [
        encrypted.handles[0],
        encrypted.handles[1],
        encrypted.handles[2],
      ] as [string, string, string],
      inputProof: encrypted.inputProof,
    };
  }

  beforeEach(async function () {
    // Pastikan test dijalankan di jaringan mock FHEVM lokal
    if (!fhevm.isMock) {
      this.skip();
    }

    [alice, bob, eve] = await ethers.getSigners();
    const tokenFactory = await ethers.getContractFactory("HeistLootToken");
    const lootToken = await tokenFactory.deploy();
    await lootToken.waitForDeployment();
    const factory = await ethers.getContractFactory("VaultHeist");
    vaultHeist = (await factory.deploy(await lootToken.getAddress())) as unknown as VaultHeist;
    await (await lootToken.setGameContract(await vaultHeist.getAddress())).wait();
    await vaultHeist.waitForDeployment();
    contractAddress = await vaultHeist.getAddress();
  });

  // =========================================================================
  // TEST 1: Mode Solo vs Bot Onchain (1 Ronde Penuh)
  // =========================================================================
  it("1. Mode Solo vs Bot: membuat match, commit bid, dan auto-resolve ronde 1", async function () {
    const txCreate = await vaultHeist.connect(alice).createMatch(true);
    await txCreate.wait();

    const matchId = 0;
    let matchData = await vaultHeist.matches(matchId);
    expect(matchData.vsBot).to.equal(true);
    expect(matchData.currentRound).to.equal(1);
    expect(matchData.state).to.equal(1); // MatchState.Active

    // Alice mengirim alokasi terenkripsi [4, 3, 3] (total = 10)
    const enc = await encryptBids(alice, [4, 3, 3]);
    await expect(
      vaultHeist.connect(alice).submitAllocation(matchId, enc.handles, enc.inputProof)
    )
      .to.emit(vaultHeist, "AllocationCommitted")
      .and.to.emit(vaultHeist, "RoundResolved")
      .withArgs(matchId, 1);

    // Ronde otomatis maju ke 2 setelah bot ikut commit & resolve
    matchData = await vaultHeist.matches(matchId);
    expect(matchData.currentRound).to.equal(2);

    // Cek dekripsi publik untuk status alarm dan skor ronde 1
    const score1 = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score1);
    const score2 = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score2);

    expect(score1).to.be.greaterThanOrEqual(0n);
    expect(score2).to.be.greaterThanOrEqual(0n);

    // Pastikan handle alarmTripped di ronde 1 bisa didekripsi publik
    const [, , alarmTripped0] = await vaultHeist.getVaultHandles(matchId, 1, 0);
    const isTripped = await fhevm.publicDecryptEbool(alarmTripped0);
    expect(typeof isTripped).to.equal("boolean");
  });

  // =========================================================================
  // TEST 2: Fitur Scout ACL (Dekripsi Pribadi & Proteksi Akses)
  // =========================================================================
  it("2. Fitur Scout ACL: hanya pemain yang melakukan Scout yang bisa mendekripsi brankas", async function () {
    await (await vaultHeist.connect(alice).createMatch(true)).wait();
    const matchId = 0;

    // Alice melakukan Scout pada Vault 0 untuk mengintip nilai Loot (checkAlarm = false)
    await expect(vaultHeist.connect(alice).scoutVault(matchId, 0, false))
      .to.emit(vaultHeist, "VaultScouted")
      .withArgs(matchId, 1, alice.address, 0, false);

    const [lootHandle, alarmHandle] = await vaultHeist.getVaultHandles(matchId, 1, 0);

    // 1. Alice BERHASIL mendekripsi loot Vault 0 (rentang valid: 30..93)
    const decryptedLoot = await fhevm.userDecryptEuint(
      FhevmType.euint8,
      lootHandle,
      contractAddress,
      alice
    );
    expect(decryptedLoot).to.be.greaterThanOrEqual(30n);
    expect(decryptedLoot).to.be.lessThanOrEqual(93n);

    // 2. Alice GAGAL jika mencoba mendekripsi alarmLimit (karena tadi hanya scout loot)
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, alarmHandle, contractAddress, alice)
    ).to.be.rejected;

    // 3. Eve (orang luar) GAGAL mendekripsi loot Vault 0 meski punya handle-nya
    await expect(
      fhevm.userDecryptEuint(FhevmType.euint8, lootHandle, contractAddress, eve)
    ).to.be.rejected;

    // 4. Alice tidak boleh Scout dua kali di ronde yang sama
    await expect(
      vaultHeist.connect(alice).scoutVault(matchId, 1, true)
    ).to.be.revertedWith("Sudah scout atau commit");
  });

  // =========================================================================
  // TEST 3: Validasi Curang & Proteksi Wrap-Around Overflow (euint8)
  // =========================================================================
  it("3. Validasi Curang Overflow: bid [100, 100, 60] otomatis dinolkan tanpa revert", async function () {
    // Pakai mode PvP agar bid lawan (Bob) bisa kita kontrol secara deterministik
    await (await vaultHeist.connect(alice).createMatch(false)).wait();
    await (await vaultHeist.connect(bob).joinMatch(0)).wait();
    const matchId = 0;

    // Alice mencoba serangan overflow uint8: 100 + 100 + 60 = 260 -> wrap-around jadi 4 (<= 10)
    const cheatEnc = await encryptBids(alice, [100, 100, 60]);
    await (
      await vaultHeist.connect(alice).submitAllocation(matchId, cheatEnc.handles, cheatEnc.inputProof)
    ).wait();

    // Bob bermain jujur dengan bid kecil [1, 1, 1] (total 3, mustahil memicu alarm minimal 6)
    const honestEnc = await encryptBids(bob, [1, 1, 1]);
    await (
      await vaultHeist.connect(bob).submitAllocation(matchId, honestEnc.handles, honestEnc.inputProof)
    ).wait();

    const matchData = await vaultHeist.matches(matchId);
    const aliceScore = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score1);
    const bobScore = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score2);

    // Karena bid Alice dinolkan jadi [0, 0, 0], Bob menyapu bersih 3 brankas (minimal 3 x 30 = 90)
    expect(aliceScore).to.equal(0n);
    expect(bobScore).to.be.greaterThanOrEqual(90n);
  });

  it("3b. Validasi Anggaran Setelah Scout: bid total 10 setelah Scout (batas 9) otomatis dinolkan", async function () {
    await (await vaultHeist.connect(alice).createMatch(false)).wait();
    await (await vaultHeist.connect(bob).joinMatch(0)).wait();
    const matchId = 0;

    // Alice melakukan Scout -> jatah kru turun dari 10 menjadi 9
    await (await vaultHeist.connect(alice).scoutVault(matchId, 0, true)).wait();

    // Alice nekat mengirim total 10 ([4, 3, 3])
    const overBudgetEnc = await encryptBids(alice, [4, 3, 3]);
    await (
      await vaultHeist
        .connect(alice)
        .submitAllocation(matchId, overBudgetEnc.handles, overBudgetEnc.inputProof)
    ).wait();

    // Bob kirim [1, 1, 1]
    const bobEnc = await encryptBids(bob, [1, 1, 1]);
    await (
      await vaultHeist.connect(bob).submitAllocation(matchId, bobEnc.handles, bobEnc.inputProof)
    ).wait();

    const matchData = await vaultHeist.matches(matchId);
    const aliceScore = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score1);
    const bobScore = await fhevm.publicDecryptEuint(FhevmType.euint16, matchData.score2);

    expect(aliceScore).to.equal(0n);
    expect(bobScore).to.be.greaterThanOrEqual(90n);
  });

  // =========================================================================
  // TEST 4: Resolusi Penuh 3 Ronde Hingga Match Finished
  // =========================================================================
  it("4. Resolusi 3 Ronde: menyelesaikan seluruh match hingga MatchState.Finished", async function () {
    await (await vaultHeist.connect(alice).createMatch(true)).wait();
    const matchId = 0;

    // Ronde 1: Tanpa Scout (anggaran 10)
    const r1 = await encryptBids(alice, [5, 3, 2]);
    await (await vaultHeist.connect(alice).submitAllocation(matchId, r1.handles, r1.inputProof)).wait();
    expect((await vaultHeist.matches(matchId)).currentRound).to.equal(2);

    // Ronde 2: Pakai Scout alarm Vault 1 (anggaran jadi 9)
    await (await vaultHeist.connect(alice).scoutVault(matchId, 1, true)).wait();
    const r2 = await encryptBids(alice, [3, 3, 3]);
    await (await vaultHeist.connect(alice).submitAllocation(matchId, r2.handles, r2.inputProof)).wait();
    expect((await vaultHeist.matches(matchId)).currentRound).to.equal(3);

    // Ronde 3: Ronde terakhir (anggaran 10)
    const r3 = await encryptBids(alice, [2, 4, 4]);
    await expect(
      vaultHeist.connect(alice).submitAllocation(matchId, r3.handles, r3.inputProof)
    )
      .to.emit(vaultHeist, "RoundResolved")
      .withArgs(matchId, 3);

    const finalMatch = await vaultHeist.matches(matchId);
    expect(finalMatch.state).to.equal(2); // MatchState.Finished

    const finalScore1 = await fhevm.publicDecryptEuint(FhevmType.euint16, finalMatch.score1);
    const finalScore2 = await fhevm.publicDecryptEuint(FhevmType.euint16, finalMatch.score2);
    console.log(`      Skor Akhir 3 Ronde -> Alice: ${finalScore1} | Bot: ${finalScore2}`);

    // Setelah Finished, tidak bisa submit lagi
    const extra = await encryptBids(alice, [1, 1, 1]);
    await expect(
      vaultHeist.connect(alice).submitAllocation(matchId, extra.handles, extra.inputProof)
    ).to.be.revertedWith("Match tidak aktif");
  });
});
