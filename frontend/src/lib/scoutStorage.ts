import type { Contract } from "ethers";

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
// getter publik). Mengembalikan:
//   { found: true, vaultIdx, checkAlarm } — event ditemukan, chain yang menang
//   { found: false }                      — query berhasil, tidak ada event
//                                           dalam jendela blok yang dipindai
//   null                                  — tidak konklusif (RPC gagal di semua
//                                           jendela) -> pemanggil boleh jatuh
//                                           kembali ke cache sebagai fallback
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
    const latest: number = await provider.getBlockNumber();
    // RPC publik menolak rentang getLogs yang terlalu lebar — coba jendela
    // besar dulu, lalu menyusut bila ditolak.
    for (const window of [45000, 10000, 2000]) {
      try {
        const logs: any[] = await readContract.queryFilter(
          readContract.filters.VaultScouted(matchId, null, walletAddress),
          Math.max(0, latest - window),
          latest
        );
        const mine = logs.filter((l) => Number(l?.args?.round) === round);
        if (mine.length > 0) {
          const a = mine[mine.length - 1].args;
          return { found: true, vaultIdx: Number(a.vaultIdx), checkAlarm: Boolean(a.isAlarm) };
        }
        return { found: false };
      } catch {
        /* jendela ditolak RPC — coba yang lebih kecil */
      }
    }
    return null;
  } catch {
    return null;
  }
}
