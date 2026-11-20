// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint8, euint16, ebool, externalEuint8 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract VaultHeist is ZamaEthereumConfig {
    uint8 public constant MAX_ROUNDS = 3;
    uint8 public constant VAULT_COUNT = 3;
    uint8 public constant BASE_CREW = 10;

    enum MatchState { WaitingPlayer, Active, Finished }

    struct Vault {
        euint8 loot;        // Nilai jarahan rahasia (30 - 93)
        euint8 alarmLimit;  // Batas maksimal total kru sebelum alarm bunyi (6 - 13)
        ebool alarmTripped; // Hasil resolusi ronde: apakah alarm berbunyi
    }

    struct RoundData {
        Vault[3] vaults;
        euint8[3] p1Bids;
        euint8[3] p2Bids;
        bool p1Scouted;
        bool p2Scouted;
        bool p1Committed;
        bool p2Committed;
        bool resolved;
    }

    struct Match {
        address player1;
        address player2; // address(0) jika mode vsBot
        bool vsBot;
        uint8 currentRound;
        MatchState state;
        euint16 score1;
        euint16 score2;
    }

    uint256 public nextMatchId;
    mapping(uint256 => Match) public matches;
    mapping(uint256 => mapping(uint8 => RoundData)) private rounds;

    event MatchCreated(uint256 indexed matchId, address indexed player1, bool vsBot);
    event PlayerJoined(uint256 indexed matchId, address indexed player2);
    event VaultScouted(uint256 indexed matchId, uint8 round, address indexed player, uint8 vaultIdx, bool isAlarm);
    event AllocationCommitted(uint256 indexed matchId, uint8 round, address indexed player);
    event RoundResolved(uint256 indexed matchId, uint8 round);

    // =============================================================
    // 1. PEMBUATAN MATCH & INISIALISASI RONDE (FHE RNG)
    // =============================================================

    function createMatch(bool vsBot) external returns (uint256 matchId) {
        matchId = nextMatchId++;
        Match storage m = matches[matchId];
        m.player1 = msg.sender;
        m.vsBot = vsBot;
        m.currentRound = 1;
        m.state = vsBot ? MatchState.Active : MatchState.WaitingPlayer;

        m.score1 = FHE.asEuint16(0);
        m.score2 = FHE.asEuint16(0);
        FHE.allowThis(m.score1);
        FHE.allowThis(m.score2);

        if (vsBot) {
            _initRound(matchId, 1);
        }

        emit MatchCreated(matchId, msg.sender, vsBot);
    }

    function joinMatch(uint256 matchId) external {
        Match storage m = matches[matchId];
        require(m.state == MatchState.WaitingPlayer, "Match tidak tersedia");
        require(msg.sender != m.player1, "Tidak bisa melawan diri sendiri");

        m.player2 = msg.sender;
        m.state = MatchState.Active;
        _initRound(matchId, 1);

        emit PlayerJoined(matchId, msg.sender);
    }

    function _initRound(uint256 matchId, uint8 roundNum) internal {
        RoundData storage r = rounds[matchId][roundNum];

        for (uint8 i = 0; i < VAULT_COUNT; i++) {
            // Bitmasking (FHE.and) jauh lebih hemat gas FHE dibanding modulo (FHE.rem)
            // Loot: (0..63) + 30 = 30..93
            euint8 randLoot = FHE.add(
                FHE.and(FHE.randEuint8(), FHE.asEuint8(63)),
                FHE.asEuint8(30)
            );
            // Alarm Limit: (0..7) + 6 = 6..13
            euint8 randAlarm = FHE.add(
                FHE.and(FHE.randEuint8(), FHE.asEuint8(7)),
                FHE.asEuint8(6)
            );

            r.vaults[i].loot = randLoot;
            r.vaults[i].alarmLimit = randAlarm;

            // Kontrak wajib memberi izin ke dirinya sendiri agar bisa memakai handle ini di transaksi berikutnya
            FHE.allowThis(r.vaults[i].loot);
            FHE.allowThis(r.vaults[i].alarmLimit);
        }
    }

    // =============================================================
    // 2. FITUR SCOUT (DEKRIPSI PRIBADI VIA ACL)
    // =============================================================

    /// @notice Korbankan 1 poin kru untuk mengintip loot ATAU batas alarm 1 brankas
    function scoutVault(uint256 matchId, uint8 vaultIdx, bool checkAlarm) external {
        Match storage m = matches[matchId];
        require(m.state == MatchState.Active, "Match tidak aktif");
        require(vaultIdx < VAULT_COUNT, "Indeks brankas tidak valid");

        RoundData storage r = rounds[matchId][m.currentRound];
        bool isP1 = (msg.sender == m.player1);
        bool isP2 = (!m.vsBot && msg.sender == m.player2);
        require(isP1 || isP2, "Bukan peserta match");

        if (isP1) {
            require(!r.p1Scouted && !r.p1Committed, "Sudah scout atau commit");
            r.p1Scouted = true;
        } else {
            require(!r.p2Scouted && !r.p2Committed, "Sudah scout atau commit");
            r.p2Scouted = true;
        }

        // Berikan izin ACL HANYA ke wallet pemain yang melakukan Scout
        if (checkAlarm) {
            FHE.allow(r.vaults[vaultIdx].alarmLimit, msg.sender);
        } else {
            FHE.allow(r.vaults[vaultIdx].loot, msg.sender);
        }

        emit VaultScouted(matchId, m.currentRound, msg.sender, vaultIdx, checkAlarm);
    }

    /// @notice Helper bagi frontend untuk mengambil ciphertext handle yang sudah diizinkan ACL
    function getVaultHandles(uint256 matchId, uint8 roundNum, uint8 vaultIdx)
        external
        view
        returns (euint8 lootHandle, euint8 alarmHandle, ebool alarmTrippedHandle)
    {
        Vault storage v = rounds[matchId][roundNum].vaults[vaultIdx];
        return (v.loot, v.alarmLimit, v.alarmTripped);
    }

    // =============================================================
    // 3. COMMIT ALOKASI & VALIDASI HOMOMORFIK
    // =============================================================

    function submitAllocation(
        uint256 matchId,
        externalEuint8[3] calldata encryptedBids,
        bytes calldata inputProof
    ) external {
        Match storage m = matches[matchId];
        require(m.state == MatchState.Active, "Match tidak aktif");

        RoundData storage r = rounds[matchId][m.currentRound];
        bool isP1 = (msg.sender == m.player1);
        bool isP2 = (!m.vsBot && msg.sender == m.player2);
        require(isP1 || isP2, "Bukan peserta match");

        // Konversi input eksternal terenkripsi + verifikasi ZK proof
        euint8 b0 = FHE.fromExternal(encryptedBids[0], inputProof);
        euint8 b1 = FHE.fromExternal(encryptedBids[1], inputProof);
        euint8 b2 = FHE.fromExternal(encryptedBids[2], inputProof);

        uint8 maxBudgetPlain = (isP1 ? r.p1Scouted : r.p2Scouted) ? (BASE_CREW - 1) : BASE_CREW;
        euint8[3] memory safeBids = _validateBudget(b0, b1, b2, maxBudgetPlain);

        if (isP1) {
            require(!r.p1Committed, "Player 1 sudah commit");
            r.p1Committed = true;
            for (uint8 i = 0; i < VAULT_COUNT; i++) {
                r.p1Bids[i] = safeBids[i];
                FHE.allowThis(r.p1Bids[i]);
            }
        } else {
            require(!r.p2Committed, "Player 2 sudah commit");
            r.p2Committed = true;
            for (uint8 i = 0; i < VAULT_COUNT; i++) {
                r.p2Bids[i] = safeBids[i];
                FHE.allowThis(r.p2Bids[i]);
            }
        }

        emit AllocationCommitted(matchId, m.currentRound, msg.sender);

        // Jika mode Solo, Bot Onchain otomatis mengisi alokasi terenkripsi & langsung resolve
        if (m.vsBot) {
            _commitBotBids(r);
            _resolveRound(matchId);
        } else if (r.p1Committed && r.p2Committed) {
            _resolveRound(matchId);
        }
    }

    /// @dev Validasi anggaran homomorfik + proteksi euint8 overflow
    function _validateBudget(
        euint8 b0,
        euint8 b1,
        euint8 b2,
        uint8 maxBudgetPlain
    ) internal returns (euint8[3] memory validBids) {
        euint8 maxB = FHE.asEuint8(maxBudgetPlain);
        euint8 zero = FHE.asEuint8(0);

        // Langkah 1: Pastikan tiap bid individu <= maxBudget (cegah wrap-around overflow euint8)
        ebool eachWithinCap = FHE.and(
            FHE.and(FHE.le(b0, maxB), FHE.le(b1, maxB)),
            FHE.le(b2, maxB)
        );

        // Langkah 2: Jumlahkan ketiganya (maks 30 jika Langkah 1 lolos, aman dari batas 255)
        euint8 total = FHE.add(FHE.add(b0, b1), b2);
        ebool isValid = FHE.and(eachWithinCap, FHE.le(total, maxB));

        // Jika curang (melebihi jatah kru), seluruh alokasi otomatis dijadikan 0
        validBids[0] = FHE.select(isValid, b0, zero);
        validBids[1] = FHE.select(isValid, b1, zero);
        validBids[2] = FHE.select(isValid, b2, zero);
    }

    /// @dev Bot onchain membagi 10 poin kru secara acak terenkripsi
    function _commitBotBids(RoundData storage r) internal {
        // Vault 0: 1..4, Vault 1: 1..4, Vault 2: sisa (2..8) -> total selalu 10
        euint8 bot0 = FHE.add(FHE.and(FHE.randEuint8(), FHE.asEuint8(3)), FHE.asEuint8(1));
        euint8 bot1 = FHE.add(FHE.and(FHE.randEuint8(), FHE.asEuint8(3)), FHE.asEuint8(1));
        euint8 bot2 = FHE.sub(FHE.asEuint8(BASE_CREW), FHE.add(bot0, bot1));

        r.p2Bids[0] = bot0;
        r.p2Bids[1] = bot1;
        r.p2Bids[2] = bot2;
        r.p2Committed = true;

        for (uint8 i = 0; i < VAULT_COUNT; i++) {
            FHE.allowThis(r.p2Bids[i]);
        }
    }

    // =============================================================
    // 4. RESOLUSI RONDE HOMOMORFIK & DEKRIPSI HASIL PUBLIK
    // =============================================================

    function _resolveRound(uint256 matchId) internal {
        Match storage m = matches[matchId];
        RoundData storage r = rounds[matchId][m.currentRound];
        require(!r.resolved, "Ronde sudah selesai");
        r.resolved = true;

        euint8 zero8 = FHE.asEuint8(0);

        for (uint8 i = 0; i < VAULT_COUNT; i++) {
            Vault storage v = r.vaults[i];
            euint8 bid1 = r.p1Bids[i];
            euint8 bid2 = r.p2Bids[i];

            euint8 totalCrew = FHE.add(bid1, bid2);
            ebool alarmTripped = FHE.gt(totalCrew, v.alarmLimit);
            v.alarmTripped = alarmTripped;

            // Cek pemenang jika alarm tidak berbunyi
            ebool p1Wins = FHE.gt(bid1, bid2);
            ebool p2Wins = FHE.gt(bid2, bid1);
            ebool isTieWithCrew = FHE.and(FHE.eq(bid1, bid2), FHE.gt(totalCrew, zero8));

            // Pembagian 2 saat seri memakai right-shift 1 bit (jauh lebih murah daripada FHE.div)
            euint8 halfLoot = FHE.shr(v.loot, uint8(1));

            euint8 p1Gain = FHE.select(
                alarmTripped,
                zero8,
                FHE.select(p1Wins, v.loot, FHE.select(isTieWithCrew, halfLoot, zero8))
            );
            euint8 p2Gain = FHE.select(
                alarmTripped,
                zero8,
                FHE.select(p2Wins, v.loot, FHE.select(isTieWithCrew, halfLoot, zero8))
            );

            // Akumulasi skor dalam euint16
            m.score1 = FHE.add(m.score1, FHE.asEuint16(p1Gain));
            m.score2 = FHE.add(m.score2, FHE.asEuint16(p2Gain));

            // Buka HANYA status alarm ke publik; bid pemain tetap rahasia
            FHE.allowThis(v.alarmTripped);
            FHE.makePubliclyDecryptable(v.alarmTripped);
        }

        // Perbarui izin ACL skor terbaru dan izinkan dekripsi publik untuk papan skor
        FHE.allowThis(m.score1);
        FHE.allowThis(m.score2);
        FHE.makePubliclyDecryptable(m.score1);
        FHE.makePubliclyDecryptable(m.score2);

        emit RoundResolved(matchId, m.currentRound);

        if (m.currentRound < MAX_ROUNDS) {
            m.currentRound++;
            _initRound(matchId, m.currentRound);
        } else {
            m.state = MatchState.Finished;
        }
    }
}
