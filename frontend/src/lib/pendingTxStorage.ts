// ---------------------------------------------------------------------------
// Persistensi transaksi belum terkonfirmasi (Batch 6.3)
//
// Batch 6.1/6.2 menyimpan record transaksi ambigu (hash sudah ada,
// receipt belum terkonfirmasi) hanya di state + ref GameArena. Refresh
// halaman atau crash browser menghapusnya, dan verifikasi pasca-reload
// kembali hanya mengandalkan scan event: transaksi yang masih pending
// belum punya event, sehingga jendela transaksi duplikat Batch 6.1
// terbuka lagi hanya karena reload. Batch 6.3 mempersistensikan record
// yang sama ke localStorage agar gerbang hash Batch 6.2 tetap berlaku
// setelah reload.
//
// Prinsip:
// - localStorage di sini HANYA petunjuk untuk menemukan transaksi.
//   Isinya tidak pernah dianggap bukti transaksi berhasil — blockchain
//   tetap sumber kebenaran, dan record hanya boleh dihapus lewat jalur
//   clear yang disetujui gerbang hash (receipt status 0, event cocok
//   pada mode scan-strict, atau cabang replacement yang konklusif).
// - Key DAN isi record terikat penuh pada satu konteks:
//   (chainId, contractAddress, matchId, round, sender, kind). Saat
//   dibaca kembali, semua field identitas di dalam JSON divalidasi
//   terhadap konteks yang meminta; record yang tidak cocok persis
//   diabaikan dan dibiarkan utuh — record wallet / match / ronde lain
//   tidak pernah dibaca untuk arena ini dan tidak pernah dihapus oleh
//   arena ini.
// - Yang disimpan hanya metadata transaksi publik: { kind, hash, nonce,
//   matchId, round, sender, chainId, contractAddress, savedAt }. Tidak
//   pernah ada private key, signature, atau kredensial wallet di sini.
// - Semua akses dibungkus try/catch: bila localStorage tidak tersedia
//   (mode privat / kuota), perilaku degradasi persis Batch 6.2
//   (record hanya hidup di memori sesi).
// ---------------------------------------------------------------------------

export interface PendingTxRecord {
  kind: "commit" | "scout";
  hash: string;
  nonce: number;
  matchId: number;
  round: number;
  sender: string; // alamat wallet pengirim, lowercase
  chainId: number;
  contractAddress: string; // alamat kontrak game, lowercase
  savedAt: number;
}

const PREFIX = "vaultheist:pendingtx:";

export function pendingTxKey(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): string {
  return `${PREFIX}${chainId}:${contractAddress.toLowerCase()}:${matchId}:${round}:${sender.toLowerCase()}:${kind}`;
}

// Record tanpa identitas lengkap tidak bisa divalidasi saat dibaca
// kembali, jadi tidak dipersistensikan sama sekali; record seperti itu
// cukup hidup di memori sesi (perilaku Batch 6.2).
function hasCompleteIdentity(rec: PendingTxRecord): boolean {
  return (
    Number.isInteger(rec.chainId) &&
    rec.chainId > 0 &&
    typeof rec.sender === "string" &&
    /^0x[0-9a-f]{40}$/.test(rec.sender.toLowerCase())
  );
}

// Batch 6.3.1: hasil simpan kini eksplisit (boolean). Dulu fungsi ini
// menelan semua kegagalan secara diam-diam, sehingga kegagalan simpan
// AKTUAL per record (kuota penuh di tengah sesi, atau identitas capture
// tidak lengkap) tidak terlihat oleh UI — probe ketersediaan di awal
// arena tidak bisa mendeteksinya. true hanya bila setItem benar-benar
// berhasil; false bila identitas tidak lengkap atau tulisannya gagal.
// Pemanggil (storeUnconfirmedTx di GameArena) memakai hasil ini untuk
// menampilkan peringatan persistensi per transaksi.
export function savePendingTx(rec: PendingTxRecord): boolean {
  if (!hasCompleteIdentity(rec)) return false;
  try {
    localStorage.setItem(
      pendingTxKey(rec.chainId, rec.contractAddress, rec.matchId, rec.round, rec.sender, rec.kind),
      JSON.stringify({
        ...rec,
        sender: rec.sender.toLowerCase(),
        contractAddress: rec.contractAddress.toLowerCase(),
      })
    );
    return true;
  } catch {
    /* localStorage tidak tersedia / penuh: record hanya hidup di memori sesi (Batch 6.2) */
    return false;
  }
}

// Batch 6.3.1: loader multi-hasil untuk jalur hidrasi. loadPendingTx lama
// menggabungkan situasi yang sangat berbeda ke dalam null yang sama:
// "bacaan storage BERHASIL dan memang tidak ada entri untuk konteks ini"
// (konklusif: tidak ada record) dan "bacaan storage itu sendiri GAGAL"
// (getItem melempar — storage tidak tersedia). Hidrasi wajib membedakan
// keduanya: yang pertama boleh melanjutkan ke gerbang hash / scan event,
// yang kedua harus fail-closed (status unknown), karena kegagalan membaca
// bukan bukti tidak ada record.
// Batch 6.3.2: "absent" dipecah lagi. Entri yang ADA di key konteks ini
// tetapi rusak (JSON tidak bisa di-parse) atau tidak lolos validasi
// identitas BUKAN bukti tidak ada transaksi pending — isinya tidak bisa
// dipercaya, dan memperlakukannya sebagai "tidak ada record" akan membuka
// kontrol di atas sesuatu yang tidak bisa diverifikasi. Klasifikasi:
//   "found"   — entri ada dan lolos validasi identitas penuh.
//   "absent"  — bacaan berhasil; key konteks ini memang tidak memiliki
//               entri. Hanya ini yang konklusif "tidak ada record".
//   "invalid" — entri ADA di key konteks ini, tetapi JSON-nya rusak atau
//               satu saja field identitasnya tidak lolos validasi.
//               Fail-closed: entri dibiarkan utuh di storage (loader
//               tidak pernah menghapus), status transaksi tidak boleh
//               disimpulkan dari ketiadaan yang semu ini.
//   "error"   — getItem itu sendiri melempar (storage tidak tersedia).
export type PendingTxLoadResult =
  | { status: "found"; record: PendingTxRecord }
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "error" };

export function loadPendingTxResult(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): PendingTxLoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(
      pendingTxKey(chainId, contractAddress, matchId, round, sender, kind)
    );
  } catch {
    return { status: "error" };
  }
  if (raw === null) return { status: "absent" };
  // Entri ADA di key konteks ini. Mulai titik ini, kegagalan apa pun
  // BUKAN "absent": isinya tidak bisa dipercaya, jadi hasilnya "invalid"
  // dan pemanggil (hidrasi) wajib fail-closed. Entri selalu dibiarkan
  // utuh di storage; loader tidak pernah menghapus.
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return { status: "invalid" }; // JSON rusak
  }
  // Validasi SEMUA field identitas terhadap konteks yang meminta.
  // Satu saja tidak cocok -> entri tidak valid untuk konteks ini.
  if (
    o?.kind === kind &&
    typeof o?.hash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(o.hash) &&
    Number.isInteger(o?.nonce) &&
    o.nonce >= 0 &&
    o?.matchId === matchId &&
    o?.round === round &&
    typeof o?.sender === "string" &&
    o.sender.toLowerCase() === sender.toLowerCase() &&
    o?.chainId === chainId &&
    typeof o?.contractAddress === "string" &&
    o.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
    typeof o?.savedAt === "number"
  ) {
    return {
      status: "found",
      record: {
        kind,
        hash: o.hash,
        nonce: o.nonce,
        matchId,
        round,
        sender: sender.toLowerCase(),
        chainId,
        contractAddress: contractAddress.toLowerCase(),
        savedAt: o.savedAt,
      },
    };
  }
  return { status: "invalid" };
}

export function loadPendingTx(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): PendingTxRecord | null {
  // Perilaku publik lama dipertahankan untuk pemanggil lain: record atau
  // null. Jalur hidrasi memakai loadPendingTxResult agar bisa fail-closed.
  const res = loadPendingTxResult(chainId, contractAddress, matchId, round, sender, kind);
  return res.status === "found" ? res.record : null;
}

// Penghapusan hanya dipanggil dari jalur clear yang disetujui gerbang
// hash Batch 6.2 (lewat clearUnconfirmedTx di GameArena). Tidak ada
// jalur removeItem lain untuk record ini.
export function clearPendingTx(rec: PendingTxRecord): void {
  try {
    localStorage.removeItem(
      pendingTxKey(rec.chainId, rec.contractAddress, rec.matchId, rec.round, rec.sender, rec.kind)
    );
  } catch {
    /* abaikan */
  }
}

// ---------------------------------------------------------------------------
// Probe ketersediaan storage (addendum Batch 6.3)
//
// savePendingTx menelan kegagalan secara diam-diam sebagai backstop, dan
// itu tetap benar untuk jalur simpan. Tetapi UI tidak boleh menyiratkan
// perlindungan recovery setelah refresh sedang aktif ketika persistensi
// sebenarnya mati (mode privat, kuota, storage dinonaktifkan browser).
// Probe ini melakukan tulis + baca-balik + hapus NYATA pada key khusus
// dan hanya mengembalikan true bila seluruh siklus itu berhasil. Hasil
// di-cache di level modul: ketersediaan storage tidak berubah di tengah
// sesi. Key probe selalu dihapus, jadi tidak meninggalkan sisa.
// ---------------------------------------------------------------------------

const PROBE_KEY = "vaultheist:pendingtx:__probe__";
let storageAvailableCache: boolean | null = null;

export function isPendingTxStorageAvailable(): boolean {
  if (storageAvailableCache !== null) return storageAvailableCache;
  try {
    localStorage.setItem(PROBE_KEY, "1");
    const ok = localStorage.getItem(PROBE_KEY) === "1";
    localStorage.removeItem(PROBE_KEY);
    storageAvailableCache = ok;
  } catch {
    storageAvailableCache = false;
  }
  return storageAvailableCache;
}
