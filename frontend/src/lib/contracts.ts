import { Contract, JsonRpcProvider, type Signer } from "ethers";
import VaultHeistArtifact from "../abi/VaultHeist.json";
import HeistLootTokenArtifact from "../abi/HeistLootToken.json";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
export const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS as string | undefined;

// Semua pembacaan onchain (view calls) lewat RPC publik yang terverifikasi,
// BUKAN lewat RPC bawaan MetaMask user — RPC kustom/bawaan wallet yang
// bermasalah membuat eth_call mengembalikan data kosong ("missing revert
// data") seolah kontrak tidak ada. Wallet hanya dipakai untuk tanda tangan
// dan pengiriman transaksi.
export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL);

export function getGameContract(signer: Signer): Contract {
  return new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, signer);
}

export function getGameReadContract(): Contract {
  return new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, readProvider);
}

export function getTokenContract(signer: Signer): Contract | null {
  if (!TOKEN_ADDRESS) return null;
  return new Contract(TOKEN_ADDRESS, HeistLootTokenArtifact.abi, signer);
}

export function getTokenReadContract(): Contract | null {
  if (!TOKEN_ADDRESS) return null;
  return new Contract(TOKEN_ADDRESS, HeistLootTokenArtifact.abi, readProvider);
}

export interface MatchInfo {
  player1: string;
  player2: string;
  vsBot: boolean;
  currentRound: number;
  state: number; // 0 WaitingPlayer, 1 Active, 2 Finished
  score1Handle: string;
  score2Handle: string;
}

export async function fetchMatch(contract: Contract, matchId: number): Promise<MatchInfo> {
  const m = await contract.matches(matchId);
  return {
    player1: m.player1,
    player2: m.player2,
    vsBot: m.vsBot,
    currentRound: Number(m.currentRound),
    state: Number(m.state),
    score1Handle: m.score1,
    score2Handle: m.score2,
  };
}

export interface UserMatch {
  id: number;
  info: MatchInfo;
}

// Daftar match milik satu wallet: enumerasi ID dari nextMatchId (terbaru
// dulu, dibatasi maxScan agar panggilan RPC tetap ringan), lalu saring yang
// player1/player2-nya adalah wallet ini. Tanpa event scan — node RPC publik
// memangkas riwayat log lama, enumerasi langsung selalu lengkap.
export async function fetchUserMatches(
  contract: Contract,
  userAddress: string,
  maxScan = 60
): Promise<UserMatch[]> {
  const total = Number(await contract.nextMatchId());
  const from = Math.max(0, total - maxScan);
  const ids: number[] = [];
  for (let id = total - 1; id >= from; id--) ids.push(id);
  const me = userAddress.toLowerCase();
  const results = await Promise.all(
    ids.map(async (id) => ({ id, info: await fetchMatch(contract, id) }))
  );
  return results.filter(
    ({ info }) => info.player1.toLowerCase() === me || info.player2.toLowerCase() === me
  );
}

export interface RoundRecord {
  round: number;
  alarms: [boolean, boolean, boolean]; // per Vault A/B/C: true = alarm berbunyi
  alarmsKnown?: boolean; // false = dekripsi status alarm ronde ini belum berhasil (relayer)
  scoreYou: number;
  scoreOpp: number;
}
