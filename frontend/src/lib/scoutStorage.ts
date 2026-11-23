import type { Contract } from "ethers";
import { findMatchCreatedBlock, scanEventLogs } from "./contracts";

// ---------------------------------------------------------------------------
// Scout persistence (Batch 1, deliverable 7)
//
// Menyimpan hasil dekripsi Scout di localStorage agar tidak hilang saat
// halaman di-refresh. Prinsip keamanan:
// - localStorage HANYA kemudahan browser — bukan pengganti FHE ACL. Nilai
//   cache tidak ditampilkan sebelum status Scout diverifikasi ke state
//   onchain (event VaultScouted) lewat findScoutOnchain().
// - Yang disimpan HANYA metadata hasil scout: { vaultIdx, checkAlarm, value,
//   savedAt }. Tidak pernah ada private key, signature EIP-712, atau
//   kredensial wallet di sini.
// - value === null artinya transaksi Scout sudah tercatat onchain tetapi
//   dekripsinya belum berhasil (relayer lambat) — user bisa retry dekripsi
//   gratis tanpa transaksi baru.
// ---------------------------------------------------------------------------

export interface ScoutCacheEntry {
  vaultIdx: number;
  checkAlarm: boolean;
  value: number | null;
  savedAt: number;
}

const PREFIX = "vaultheist:scout:";
const MAX_ENTRIES = 20;
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 hari

export function scoutStorageKey(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): string {
  return `${PREFIX}${contractAddress.toLowerCase()}:${matchId}:${round}:${walletAddress.toLowerCase()}`;
}

function allScoutKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
  } catch {
    /* localStorage tidak tersedia */
  }
  return keys;
}

function parseEntry(raw: string | null): ScoutCacheEntry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (
      typeof o?.vaultIdx === "number" &&
      o.vaultIdx >= 0 &&
      o.vaultIdx <= 2 &&
      typeof o?.checkAlarm === "boolean" &&
      (o?.value === null || typeof o?.value === "number") &&
      typeof o?.savedAt === "number"
    ) {
      return o as ScoutCacheEntry;
    }
  } catch {
    /* entri rusak -> abaikan */
  }
  return null;
}

export function loadScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): ScoutCacheEntry | null {
  try {
    return parseEntry(
      localStorage.getItem(scoutStorageKey(contractAddress, matchId, round, walletAddress))
    );
  } catch {
    return null;
  }
}

export function saveScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string,
  data: { vaultIdx: number; checkAlarm: boolean; value: number | null }
): void {
  try {
    const entry: ScoutCacheEntry = { ...data, savedAt: Date.now() };
    localStorage.setItem(
      scoutStorageKey(contractAddress, matchId, round, walletAddress),
      JSON.stringify(entry)
    );
    enforceRetention();
  } catch {
    /* quota / tidak tersedia — abaikan, Scout tetap tercatat onchain */
  }
}

export function clearScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): void {
  try {
    localStorage.removeItem(scoutStorageKey(contractAddress, matchId, round, walletAddress));
  } catch {
    /* abaikan */
  }
}

// Hapus semua entri Scout (semua ronde) milik satu match + wallet — dipanggil
// saat match mencapai Finished (state === 2).
export function pruneMatchScouts(
  contractAddress: string,
  matchId: number,
  walletAddress: string
): void {
  const c = contractAddress.toLowerCase();
  const w = walletAddress.toLowerCase();
  try {
    for (const k of allScoutKeys()) {
      const parts = k.split(":"); // [vaultheist, scout, contract, matchId, round, wallet]
      if (parts.length === 6 && parts[2] === c && Number(parts[3]) === matchId && parts[5] === w) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* abaikan */
  }
}

// Batas retensi global: buang entri kedaluwarsa (TTL) dan batasi jumlah total
// entri (yang tertua dibuang dulu) agar storage tidak tumbuh tanpa batas.
export function enforceRetention(): void {
  try {
    const now = Date.now();
    const entries: { key: string; savedAt: number }[] = [];
    for (const k of allScoutKeys()) {
      const e = parseEntry(localStorage.getItem(k));
      if (!e || now - e.savedAt > TTL_MS) {
        localStorage.removeItem(k);
      } else {
        entries.push({ key: k, savedAt: e.savedAt });
      }
    }
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (const extra of entries.slice(MAX_ENTRIES)) {
      localStorage.removeItem(extra.key);
    }
  } catch {
    /* abaikan */
  }
}

// Migrasi format lama (`vh-scout-${matchId}-${round}` -> { scouted | pendingScout })
// ke format baru yang ter-scope per kontrak + wallet. Kunci lama selalu dihapus;
// verifikasi onchain sesudahnya yang menentukan apakah nilai migrasi dipercaya.
export function migrateLegacyScout(
  matchId: number,
  round: number,
  contractAddress: string,
  walletAddress: string
): void {
  const legacyKey = `vh-scout-${matchId}-${round}`;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    localStorage.removeItem(legacyKey);
    if (loadScout(contractAddress, matchId, round, walletAddress)) return;
    const saved = JSON.parse(raw);
    if (saved?.scouted) {
      saveScout(contractAddress, matchId, round, walletAddress, {
        vaultIdx: Number(saved.scouted.vaultIdx),
        checkAlarm: saved.scouted.kind === "alarm",
        value: Number(saved.scouted.value),
      });
    } else if (saved?.pendingScout) {
      saveScout(contractAddress, matchId, round, walletAddress, {
        vaultIdx: Number(saved.pendingScout.vaultIdx),
        checkAlarm: saved.pendingScout.kind === "alarm",
        value: null,
      });
    }
  } catch {
    /* format lama tidak valid — abaikan */
  }
}

// ---------------------------------------------------------------------------
// Verifikasi onchain: satu-satunya bukti publik bahwa wallet ini benar-benar
// melakukan Scout di ronde ini adalah event
//   VaultScouted(matchId, round, player, vaultIdx, isAlarm)
// (state RoundData.p1Scouted/p2Scouted di kontrak bersifat private, tidak ada
// getter publik).
//
// Batch 4 (P0-B): pemindaian DIJANGKAR di blok MatchCreated dan berjalan
// maju sampai blok terbaru dalam chunk (lihat lib/contracts.ts). Dulu
// pencarian memakai jendela blok terakhir yang menyusut dan menyimpulkan
// "tidak ada" begitu satu query berhasil kosong — padahal event Scout bisa
// berada lebih tua dari jendela itu sementara cache masih berlaku (TTL 14
// hari), sehingga cache yang sah terhapus dan Scout terlihat belum terpakai.
// Sekarang { found: false } hanya dikembalikan setelah SELURUH rentang
// sejak MatchCreated berhasil dipindai. Mengembalikan:
//   { found: true, vaultIdx, checkAlarm } — event ditemukan, chain yang menang
//   { found: false }                      — KONKLUSIF: seluruh rentang sejak
//                                           MatchCreated dipindai, tidak ada
//                                           event Scout untuk ronde ini
//   null                                  — TIDAK KONKLUSIF (jangkar tidak
//                                           ditemukan / ada chunk RPC yang
//                                           gagal) -> pemanggil WAJIB jatuh
//                                           kembali ke cache, jangan hapus
//                                           cache, jangan simpulkan Scout
//                                           belum terpakai
// ---------------------------------------------------------------------------
export type ScoutChainResult =
  | { found: true; vaultIdx: number; checkAlarm: boolean }
  | { found: false }
  | null;

export async function findScoutOnchain(
  readContract: Contract,
  matchId: number,
  round: number,
  walletAddress: string
): Promise<ScoutChainResult> {
  try {
    const provider: any = readContract.runner;
    if (!provider?.getBlockNumber) return null;
    const anchor = await findMatchCreatedBlock(readContract, matchId);
    if (anchor === null) return null; // tanpa jangkar, tidak ada kesimpulan yang sah
    const latest: number = await provider.getBlockNumber();
    const logs = await scanEventLogs(
      readContract,
      // Batch 6 (P0): filter Ethers v6 hanya menerima argumen untuk field
      // INDEXED. VaultScouted(matchId indexed, round, player indexed,
      // vaultIdx, isAlarm) -> bentuk yang benar hanya dua argumen
      // (matchId, player). Bentuk lama (matchId, null, walletAddress)
      // melempar error di Ethers, tertangkap catch, dan verifikasi selalu
      // berakhir tidak konklusif. Penyaringan ronde tetap dilakukan dari
      // args log di bawah.
      readContract.filters.VaultScouted(matchId, walletAddress),
      anchor,
      latest
    );
    if (logs === null) return null; // rentang tidak lengkap -> tidak konklusif
    const mine = logs.filter((l) => Number(l?.args?.round) === round);
    if (mine.length > 0) {
      const a = mine[mine.length - 1].args;
      return { found: true, vaultIdx: Number(a.vaultIdx), checkAlarm: Boolean(a.isAlarm) };
    }
    return { found: false };
  } catch {
    return null;
  }
}
