// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";
import { ERC7984 } from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";

/// @title HeistLootToken (cLOOT) — token hadiah rahasia ERC-7984 untuk Vault Heist
/// @notice Saldo dan jumlah transfer sepenuhnya terenkripsi (euint64).
///         Hanya kontrak VaultHeist yang boleh mencetak hadiah.
contract HeistLootToken is ERC7984, ZamaEthereumConfig {
    address public owner;
    address public gameContract;

    modifier onlyOwner() {
        require(msg.sender == owner, "Bukan owner");
        _;
    }

    modifier onlyGame() {
        require(msg.sender == gameContract, "Hanya kontrak VaultHeist");
        _;
    }

    constructor() ERC7984("Confidential Heist Loot", "cLOOT", "") {
        owner = msg.sender;
    }

    /// @notice Menghubungkan alamat kontrak VaultHeist setelah kedua kontrak dideploy
    function setGameContract(address _gameContract) external onlyOwner {
        require(_gameContract != address(0), "Alamat tidak valid");
        gameContract = _gameContract;
    }

    /// @notice Mencetak hadiah cLOOT terenkripsi (euint64) langsung ke saldo rahasia pemain
    function mintReward(address to, euint64 encryptedAmount) external onlyGame {
        // Fungsi internal _mint di ERC7984 otomatis menambahkan saldo terenkripsi
        // dan mengatur ACL agar hanya alamat `to` yang bisa mendekripsi saldonya sendiri.
        _mint(to, encryptedAmount);
    }
}
