import { useState } from "react";
import { Contract, type Signer } from "ethers";
import VaultHeistArtifact from "../abi/VaultHeist.json";
import {
  connectSepoliaWallet,
  encryptBids,
  decryptScoutResult,
  decryptPublicValues,
} from "../lib/fhe";

const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;

export default function VaultHeistGame() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [matchId, setMatchId] = useState<number | null>(null);
  const [round, setRound] = useState<number>(1);
  const [bids, setBids] = useState<[number, number, number]>([4, 3, 3]);
  const [scoutInfo, setScoutInfo] = useState<string>("");
  const [scores, setScores] = useState<{ p1: number; p2: number }>({ p1: 0, p2: 0 });
  const [status, setStatus] = useState<string>("Hubungkan wallet Sepolia untuk mulai.");

  const getContract = (activeSigner: Signer) =>
    new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, activeSigner);

  // Mulai Match Solo vs Bot Onchain
  async function handleStartSolo() {
    try {
      const s = signer ?? (await connectSepoliaWallet());
      setSigner(s);
      setStatus("Membuat match Solo vs Bot di Sepolia...");

      const contract = getContract(s);
      const nextId = Number(await contract.nextMatchId());
      const tx = await contract.createMatch(true);
      await tx.wait();

      setMatchId(nextId);
      setRound(1);
      setScoutInfo("");
      setStatus(`Match #${nextId} aktif! Kamu punya 10 Poin Kru di Ronde 1.`);
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
  }

  // Fitur Scout: Transaksi ACL -> User Decryption (EIP-712)
  async function handleScout(vaultIdx: number, checkAlarm: boolean) {
    if (!signer || matchId === null) return;
    try {
      const contract = getContract(signer);
      setStatus(`Mengirim izin Scout untuk Brankas ${vaultIdx + 1}...`);

      const tx = await contract.scoutVault(matchId, vaultIdx, checkAlarm);
      await tx.wait();

      setStatus("Mengambil ciphertext handle & menunggu tanda tangan EIP-712...");
      const [lootHandle, alarmHandle] = await contract.getVaultHandles(
        matchId,
        round,
        vaultIdx
      );

      const targetHandle = checkAlarm ? alarmHandle : lootHandle;
      const decryptedValue = await decryptScoutResult(
        targetHandle,
        CONTRACT_ADDRESS,
        signer
      );

      const label = checkAlarm ? "Batas Alarm" : "Nilai Loot";
      setScoutInfo(`Hasil Intipan Brankas ${vaultIdx + 1} (${label}): ${decryptedValue}`);
      setStatus("Berhasil didekripsi khusus untuk wallet kamu! Sisa anggaran ronde ini: 9 kru.");
    } catch (err: any) {
      setStatus(`Scout gagal: ${err.message}`);
    }
  }

  // Commit Alokasi Terenkripsi + Ambil Skor Publik
  async function handleSubmitBids() {
    if (!signer || matchId === null) return;
    try {
      const userAddress = await signer.getAddress();
      const contract = getContract(signer);

      setStatus("Mengenkripsi alokasi kru di browser (FHE)...");
      const { handles, inputProof } = await encryptBids(
        CONTRACT_ADDRESS,
        userAddress,
        bids
      );

      setStatus("Mengirim transaksi terenkripsi ke Sepolia...");
      const tx = await contract.submitAllocation(matchId, handles, inputProof);
      await tx.wait();

      // Baca handle skor terbaru lalu dekripsi secara publik
      setStatus("Ronde selesai! Mendekripsi papan skor publik...");
      const matchData = await contract.matches(matchId);
      const decrypted = await decryptPublicValues([matchData.score1, matchData.score2]);

      setScores({
        p1: Number(decrypted[matchData.score1]),
        p2: Number(decrypted[matchData.score2]),
      });
      setRound(Number(matchData.currentRound));
      setScoutInfo("");
      setStatus(
        Number(matchData.state) === 2
          ? "Game Selesai! Cek skor akhir di atas."
          : `Lanjut ke Ronde ${matchData.currentRound}!`
      );
    } catch (err: any) {
      setStatus(`Submit gagal: ${err.message}`);
    }
  }

  return (
    <div style={{ padding: 24, maxWidth: 640, margin: "0 auto", fontFamily: "sans-serif" }}>
      <h2>Vault Heist — Confidential Onchain Game</h2>
      <p>{status}</p>

      {matchId === null ? (
        <button onClick={handleStartSolo}>Mulai Solo vs Bot Onchain</button>
      ) : (
        <div>
          <p>
            Match #{matchId} | Ronde {round}/3 | Skor Kamu: <strong>{scores.p1}</strong> vs Bot:{" "}
            <strong>{scores.p2}</strong>
          </p>

          {scoutInfo && (
            <div style={{ padding: 12, background: "#eef6ff", marginBottom: 12 }}>
              <strong>{scoutInfo}</strong>
            </div>
          )}

          <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
            {[0, 1, 2].map((idx) => (
              <div key={idx} style={{ border: "1px solid #ccc", padding: 12, flex: 1 }}>
                <h4>Vault {String.fromCharCode(65 + idx)}</h4>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={bids[idx]}
                  onChange={(e) => {
                    const next: [number, number, number] = [...bids];
                    next[idx] = Number(e.target.value);
                    setBids(next);
                  }}
                />
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                  <button onClick={() => handleScout(idx, false)}>Scout Loot (-1 kru)</button>
                  <button onClick={() => handleScout(idx, true)}>Scout Alarm (-1 kru)</button>
                </div>
              </div>
            ))}
          </div>

          <button onClick={handleSubmitBids}>
            Enkripsi & Kirim Alokasi (Total: {bids[0] + bids[1] + bids[2]})
          </button>
        </div>
      )}
    </div>
  );
}
