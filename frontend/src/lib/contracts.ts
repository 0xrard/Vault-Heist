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
  matchId: number;
  round: number;
  alarms: [boolean, boolean, boolean]; // per Vault A/B/C: true = alarm berbunyi
  alarmsKnown?: boolean; // false = dekripsi status alarm ronde ini belum berhasil (relayer)
  scoreYou: number;
  scoreOpp: number;
}

// ---------------------------------------------------------------------------
// Pemindaian event onchain terjangkar (Batch 4 — Gameplay Reliability).
//
// RPC publik menolak rentang eth_getLogs yang terlalu lebar, jadi semua
// pemindaian berjalan dalam chunk. Jangkarnya adalah blok event
// MatchCreated(matchId): tidak ada pencarian "jendela terakhir N blok" yang
// bisa menyimpulkan tidak-ada sebelum seluruh riwayat match dipindai.
// Hasil null / conclusive:false berarti TIDAK KONKLUSIF (jangkar tidak
// ditemukan atau ada chunk yang gagal) — pemanggil tidak boleh
// menyimpulkan apa pun dari hasil itu.
// ---------------------------------------------------------------------------
export const LOG_CHUNK_BLOCKS = 45000;
const MAX_ANCHOR_CHUNKS = 48; // ~2,16 juta blok ke belakang untuk mencari MatchCreated

// ---------------------------------------------------------------------------
// Cache blok jangkar MatchCreated (Batch 6, P1).
//
// Tanpa cache, setiap arena dimuat memindai mundur dari blok terbaru untuk
// menemukan MatchCreated. Blok yang sudah ditemukan disimpan di
// localStorage dengan kunci terikat chainId + alamat kontrak + matchId.
// Cache TIDAK pernah dipercaya begitu saja: sebelum dipakai, bloknya
// divalidasi murah dengan query MatchCreated tepat di blok tersimpan itu
// (filter sudah terikat matchId lewat topic). Bila validasi menemukan event
// di blok itu -> cache sah. Bila query berhasil tetapi kosong -> cache
// salah/basi, dibuang, dan pemindaian penuh berjalan seperti sebelumnya.
// Bila query validasi itu sendiri gagal (RPC) -> hasil tidak konklusif
// (null), sama seperti kegagalan scan lainnya.
// ---------------------------------------------------------------------------
const ANCHOR_CACHE_PREFIX = "vaultheist:anchor:";

function anchorCacheKey(chainId: number, contractAddress: string, matchId: number): string {
  return `${ANCHOR_CACHE_PREFIX}${chainId}:${contractAddress.toLowerCase()}:${matchId}`;
}

function loadAnchorCache(chainId: number, contractAddress: string, matchId: number): number | null {
  try {
    const raw = localStorage.getItem(anchorCacheKey(chainId, contractAddress, matchId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function saveAnchorCache(chainId: number, contractAddress: string, matchId: number, block: number): void {
  try {
    localStorage.setItem(anchorCacheKey(chainId, contractAddress, matchId), String(block));
  } catch {
    /* storage tidak tersedia — abaikan, scan tetap benar */
  }
}

function dropAnchorCache(chainId: number, contractAddress: string, matchId: number): void {
  try {
    localStorage.removeItem(anchorCacheKey(chainId, contractAddress, matchId));
  } catch {
    /* abaikan */
  }
}

// Blok tempat match ini dibuat (event MatchCreated), dicari mundur dari
// blok terbaru dalam chunk (atau dari cache terverifikasi, lihat di atas).
// null = tidak ditemukan dalam jangkauan / RPC gagal (tidak konklusif).
export async function findMatchCreatedBlock(
  contract: Contract,
  matchId: number
): Promise<number | null> {
  try {
    const provider: any = contract.runner;
    if (!provider?.getBlockNumber) return null;
    const filter = contract.filters.MatchCreated(matchId);

    // Batch 6: coba cache jangkar dulu, dengan validasi satu blok.
    let cacheScope: { chainId: number; address: string } | null = null;
    try {
      const network = await provider.getNetwork();
      cacheScope = { chainId: Number(network.chainId), address: String(contract.target) };
    } catch {
      cacheScope = null; // tanpa identitas chain/kontrak, lewati cache
    }
    if (cacheScope) {
      const cached = loadAnchorCache(cacheScope.chainId, cacheScope.address, matchId);
      if (cached !== null) {
        let validation: any[];
        try {
          validation = await contract.queryFilter(filter, cached, cached);
        } catch {
          return null; // validasi cache gagal di RPC -> tidak konklusif
        }
        if (validation.length > 0) return cached;
        dropAnchorCache(cacheScope.chainId, cacheScope.address, matchId);
      }
    }

    const latest: number = await provider.getBlockNumber();
    for (let i = 0; i < MAX_ANCHOR_CHUNKS; i++) {
      const to = latest - i * LOG_CHUNK_BLOCKS;
      if (to < 0) break;
      const from = Math.max(0, to - LOG_CHUNK_BLOCKS + 1);
      let logs: any[];
      try {
        logs = await contract.queryFilter(filter, from, to);
      } catch {
        return null; // chunk ditolak RPC -> jangkar tidak konklusif
      }
      if (logs.length > 0) {
        const block = Number(logs[0].blockNumber);
        if (cacheScope) saveAnchorCache(cacheScope.chainId, cacheScope.address, matchId, block);
        return block;
      }
      if (from === 0) break;
    }
    return null;
  } catch {
    return null;
  }
}

// Pindai event dari fromBlock sampai toBlock dalam chunk berurutan.
// Mengembalikan null bila ADA chunk yang gagal: rentang tidak lengkap,
// jadi kesimpulan "tidak ada event" tidak sah.
export async function scanEventLogs(
  contract: Contract,
  filter: any,
  fromBlock: number,
  toBlock: number
): Promise<any[] | null> {
  const logs: any[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = Math.min(toBlock, start + LOG_CHUNK_BLOCKS - 1);
    try {
      const part: any[] = await contract.queryFilter(filter, start, end);
      logs.push(...part);
    } catch {
      return null;
    }
  }
  return logs;
}

export interface RoundCommitState {
  mine: boolean; // wallet ini sudah commit di ronde ini (event AllocationCommitted)
  opponent: boolean; // lawan sudah commit di ronde ini
  conclusive: boolean; // false = scan tidak lengkap, jangan simpulkan apa pun
}

// Status commit kedua pemain untuk satu ronde, dari event
// AllocationCommitted(matchId, round, player) sejak blok MatchCreated.
// Dipakai GameArena untuk memulihkan status setelah refresh: tanpa ini,
// pemain yang sudah commit melihat tombol LOCK IN lagi dan transaksinya
// akan revert di kontrak.
export async function findRoundCommits(
  contract: Contract,
  matchId: number,
  round: number,
  myAddress: string,
  opponentAddress: string | null
): Promise<RoundCommitState> {
  const inconclusive: RoundCommitState = { mine: false, opponent: false, conclusive: false };
  try {
    const provider: any = contract.runner;
    if (!provider?.getBlockNumber) return inconclusive;
    const anchor = await findMatchCreatedBlock(contract, matchId);
    if (anchor === null) return inconclusive;
    const latest: number = await provider.getBlockNumber();
    const logs = await scanEventLogs(
      contract,
      contract.filters.AllocationCommitted(matchId),
      anchor,
      latest
    );
    if (logs === null) return inconclusive;
    const me = myAddress.toLowerCase();
    const opp = opponentAddress?.toLowerCase() ?? null;
    let mine = false;
    let opponent = false;
    for (const l of logs) {
      if (Number(l?.args?.round) !== round) continue;
      const p = String(l?.args?.player ?? "").toLowerCase();
      if (p === me) mine = true;
      if (opp && p === opp) opponent = true;
    }
    return { mine, opponent, conclusive: true };
  } catch {
    return inconclusive;
  }
}
