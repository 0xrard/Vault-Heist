import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, Loader2, Lock, RefreshCw, Send, TriangleAlert } from "lucide-react";
import type { Signer } from "ethers";
import VaultCard, { type ScoutedStat } from "./VaultCard";
import TxProgress from "./TxProgress";
import SyndicateBar from "./SyndicateBar";
import CinematicReveal, {
  consumePendingReveal,
  stashPendingReveal,
  type CinematicRevealData,
} from "./CinematicReveal";
import { loadMatchResults } from "../lib/streakStorage";
import {
  clearPendingTx,
  isPendingTxStorageAvailable,
  loadPendingTxResult,
  savePendingTx,
  type PendingTxRecord,
} from "../lib/pendingTxStorage";
import {
  clearScout,
  enforceRetention,
  findScoutOnchain,
  loadScout,
  migrateLegacyScout,
  pruneMatchScouts,
  saveScout,
} from "../lib/scoutStorage";
import { encryptBids, friendlyError, publicDecryptHandles, userDecryptHandle } from "../lib/fhe";
import { playClick, playCoin, playLock, playReveal, playSonar } from "../lib/sfx";
import { CONTRACT_ADDRESS, fetchMatch, findRoundCommits, getGameContract, getGameReadContract, readProvider, type MatchInfo, type RoundRecord } from "../lib/contracts";

interface Props {
  signer: Signer;
  matchId: number;
  matchInfo: MatchInfo;
  myPlayer: 1 | 2;
  scores: { you: number; opp: number };
  onRoundResolved: (record: RoundRecord, updated: MatchInfo, scores: { you: number; opp: number }) => void;
  onError: (msg: string) => void;
  onResync: () => void;
}

// Batch 6: status sinkronisasi eksplisit. Prinsipnya: UI hanya boleh
// menyimpulkan "sudah / belum" dari hasil scan yang KONKLUSIF. Kegagalan
// RPC adalah status tersendiri ("unknown"), bukan "belum".
type ScoutSyncStatus = "syncing" | "verified-unused" | "verified-used" | "unknown";
type CommitSyncStatus = "checking" | "verified-uncommitted" | "committed" | "unknown";

const BASE_BUDGET = 10;

export default function GameArena({
  signer,
  matchId,
  matchInfo,
  myPlayer,
  scores,
  onRoundResolved,
  onError,
  onResync,
}: Props) {
  const round = matchInfo.currentRound;
  const [bids, setBids] = useState<[number, number, number]>([4, 3, 3]);
  const [scouted, setScouted] = useState<ScoutedStat | null>(null);
  const [pendingScout, setPendingScout] = useState<{ vaultIdx: number; kind: "loot" | "alarm" } | null>(null);
  const [handles, setHandles] = useState<{ loot: string; alarm: string }[] | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingOpp, setWaitingOpp] = useState(false);
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState(0); // 0 = idle, 1..4 = tahap progres commit
  const [cachedScoutUsed, setCachedScoutUsed] = useState(false); // cache lokal: scout terpakai, nilai menunggu verifikasi onchain
  const [scoutStatus, setScoutStatus] = useState<ScoutSyncStatus>("syncing"); // Batch 6: gerbang Scout tiga kondisi (verified-unused / verified-used / unknown), menggantikan boolean Batch 4 yang membuka gerbang di semua hasil termasuk gagal
  const [commitStatus, setCommitStatus] = useState<CommitSyncStatus>("checking"); // Batch 6: status commit empat kondisi, menggantikan boolean Batch 4 yang menjadi true juga saat scan gagal
  const [oppCommitted, setOppCommitted] = useState<boolean | null>(null); // Batch 4 (P0-A): lawan sudah commit ronde ini? null = belum tahu / tidak konklusif
  // Batch 6.1: tx sudah terkirim (hash ada) tetapi receipt tidak terkonfirmasi;
  // status terkait dipaksa "unknown" dan hash ditampilkan sebagai link
  // Etherscan. Batch 6.2: record kini juga menyimpan nonce pengirim, dan
  // verifikasi wajib memeriksa status hash ini SEBELUM kesimpulan scan event
  // boleh membuka kontrol atau menghapus record (lihat consultTxHashGate).
  // Batch 6.3: record membawa identitas konteks lengkap (matchId, round,
  // sender, chainId, contractAddress) dan dipersistensikan ke localStorage
  // lewat pintu store/clear yang sama (lib/pendingTxStorage.ts), agar
  // gerbang hash tetap berlaku setelah refresh / crash browser. Storage
  // hanya petunjuk untuk menemukan transaksi; blockchain tetap sumber
  // kebenaran dan isinya tidak pernah dianggap bukti keberhasilan.
  type UnconfirmedTx = PendingTxRecord;
  const [unconfirmedTx, setUnconfirmedTx] = useState<UnconfirmedTx | null>(null);
  // Addendum Batch 6.3: probe ketersediaan localStorage, dihitung sekali
  // per mount arena (hasilnya sendiri di-cache di level modul). Bila
  // storage tidak tersedia, persistensi record pending mati dan pemain
  // harus TAHU sejak awal bahwa perlindungan recovery setelah refresh
  // tidak aktif — bukan baru sadar setelah ada transaksi menggantung.
  const [pendingTxStorageAvailable] = useState(() => isPendingTxStorageAvailable());
  const [unconfirmedTxPending, setUnconfirmedTxPending] = useState(false); // Batch 6.2: pemeriksaan hash terakhir menemukan tx masih pending (dikenal provider, belum ada receipt)
  // Batch 6.3.1 (P1): peringatan persistensi PER TRANSAKSI. Probe di awal
  // arena hanya membuktikan storage bisa dipakai saat itu; penyimpanan
  // record aktual tetap bisa gagal sesudahnya (kuota, identitas capture
  // tidak lengkap). storeUnconfirmedTx menyalakan flag kind terkait bila
  // savePendingTx melaporkan gagal, dan panel unconfirmedTx menampilkan
  // catatan tambahan untuk transaksi itu. Dihapus lewat jalur clear yang
  // sama dengan record-nya.
  const [txPersistenceWarning, setTxPersistenceWarning] = useState<{
    commit: boolean;
    scout: boolean;
  }>({ commit: false, scout: false });
  // Batch 6.3.2: peringatan recovery untuk record persisten yang ADA
  // tetapi tidak lolos validasi ("invalid"). Dinyalakan per kind oleh
  // fungsi verifikasi ketika hidrasi kind itu fail-closed karena
  // invalid-record, dan dimatikan ketika hidrasi kind itu kemudian
  // berhasil. Satu catatan tampil di arena bila salah satu kind aktif.
  const [hydrationWarning, setHydrationWarning] = useState<{
    commit: boolean;
    scout: boolean;
  }>({ commit: false, scout: false });
  // Batch 6.2: cermin ref dari unconfirmedTx agar fungsi verifikasi async
  // selalu membaca record terbaru, bukan closure state yang basi.
  // Batch 6.3: cermin ini per-kind (satu slot per jenis), persis seperti
  // key persistennya — record commit dan record Scout adalah dua record
  // independen di storage, jadi ref tidak boleh mengorbankan salah satu;
  // state `unconfirmedTx` tetap satu record untuk panel (yang terakhir
  // disimpan / hasil hidrasi).
  const unconfirmedTxByKindRef = useRef<{
    commit: UnconfirmedTx | null;
    scout: UnconfirmedTx | null;
  }>({ commit: null, scout: null });
  const pendingTxHydrationRef = useRef<Promise<HydrationOutcome> | null>(null); // Batch 6.3: hidrasi record persisten berjalan sekali per instance arena; kedua fungsi verifikasi menunggunya sebelum gerbang hash dikonsultasikan. Batch 6.3.1: hanya hidrasi yang SEPENUHNYA berhasil yang tetap di-cache di sini — hasil gagal dibersihkan agar retry menjalankan hidrasi ulang
  const commitCheckSeq = useRef(0); // Batch 6.1: sequence guard checkCommitStatus — hanya pemanggilan terbaru yang boleh menulis state
  const scoutCheckSeq = useRef(0); // Batch 6.1: sequence guard restoreScoutStatus (independen dari commit)
  const [scoutAnimate, setScoutAnimate] = useState(false); // Batch 2: cipher scramble hanya untuk reveal Scout segar
  const [outcomes, setOutcomes] = useState<[boolean, boolean, boolean] | null>(null); // Batch 2: alarm per brankas ronde ini (pintu terbuka)
  const [cineReveal, setCineReveal] = useState<CinematicRevealData | null>(null); // Batch 5: cinematic reveal overlay (hanya jalur submit langsung)
  const resolutionRef = useRef<{
    round: number;
    alarms: [boolean, boolean, boolean];
    mapped: { you: number; opp: number };
  } | null>(null); // Batch 5: hasil resolusi terakhir dari collectResolution, dibaca handleSubmit untuk overlay
  const closeReveal = useCallback(() => setCineReveal(null), []);

  // Batch 6.2: simpan / hapus record tx ambigu lewat satu pintu agar state
  // React dan cermin ref tidak pernah berbeda.
  // Batch 6.3: pintu yang sama kini juga menulis / menghapus record
  // persisten di localStorage, jadi state, ref, dan storage bergerak
  // selalu bersama dan tidak pernah drift. Penghapusan persisten hanya
  // terjadi dari jalur clear yang sudah disetujui gerbang hash 6.2
  // (receipt status 0, event cocok pada scan-strict, cabang replacement
  // konklusif) — hasil blocked / tidak konklusif / error RPC tidak pernah
  // memanggil fungsi ini, jadi record persisten ikut bertahan.
  function storeUnconfirmedTx(rec: UnconfirmedTx) {
    unconfirmedTxByKindRef.current[rec.kind] = rec;
    // Batch 6.3.1 (P1): hasil simpan aktual kini dibaca. Bila record ini
    // gagal dipersistensikan (storage menolak, atau identitas capture
    // tidak lengkap), gerbang sesi tetap bekerja dari memori, tetapi
    // pemain harus tahu record transaksi INI tidak akan selamat dari
    // refresh — nyalakan peringatan per transaksi untuk kind-nya.
    const saved = savePendingTx(rec);
    setTxPersistenceWarning((prev) => ({ ...prev, [rec.kind]: !saved }));
    setUnconfirmedTx(rec);
    setUnconfirmedTxPending(false);
  }

  function clearUnconfirmedTx(kind: "commit" | "scout") {
    const rec = unconfirmedTxByKindRef.current[kind];
    if (!rec) return;
    unconfirmedTxByKindRef.current[kind] = null;
    clearPendingTx(rec);
    setTxPersistenceWarning((prev) => ({ ...prev, [kind]: false }));
    // Panel menampilkan satu record: bila yang dihapus adalah yang sedang
    // tampil, tampilkan record kind lain yang mungkin masih ada.
    setUnconfirmedTx((prev) =>
      prev?.kind === kind
        ? (unconfirmedTxByKindRef.current.commit ?? unconfirmedTxByKindRef.current.scout)
        : prev
    );
    setUnconfirmedTxPending(false);
  }

  // Batch 6.3: bentuk record lengkap dari respons transaksi yang ambigu.
  // Identitas konteks (sender + chainId) dibaca dari signer / provider
  // saat penangkapan; bila pembacaan itu gagal, record tetap dibentuk
  // dengan identitas kosong: gerbang hash sesi ini tetap bekerja dari
  // hash + nonce, tetapi savePendingTx menolak mempersistensikannya
  // (identitas tidak lengkap tidak bisa divalidasi saat dibaca kembali),
  // sehingga perilakunya degradasi persis ke Batch 6.2.
  async function captureUnconfirmedTx(
    kind: "commit" | "scout",
    tx: any
  ): Promise<UnconfirmedTx> {
    let sender = "";
    let chainId = 0;
    try {
      sender = (await signer.getAddress()).toLowerCase();
      chainId = Number((await readProvider.getNetwork()).chainId);
    } catch {
      /* identitas tidak terbaca: record hanya hidup di memori sesi ini */
    }
    return {
      kind,
      hash: tx.hash,
      nonce: tx.nonce,
      matchId,
      round,
      sender,
      chainId,
      contractAddress: CONTRACT_ADDRESS,
      savedAt: Date.now(),
    };
  }

  // Batch 6.3: hidrasi record persisten untuk konteks arena ini
  // (chain + kontrak + matchId + round + wallet terhubung, per kind).
  // Berjalan sekali per instance arena — App me-remount GameArena per
  // `${matchId}-${round}`, jadi konteksnya selalu segar. Kedua fungsi
  // verifikasi MENUNGGU promise ini sebelum consultTxHashGate dipanggil,
  // sehingga record hasil reload sudah berada di ref sebelum kesimpulan
  // event apa pun diambil — urutan yang sama dengan sesi aktif 6.2.
  // Record milik konteks lain tidak pernah dimuat (key + validasi field
  // identitas di loadPendingTxResult) dan tidak pernah disentuh di storage.
  //
  // Batch 6.3.1 (P0): hidrasi kini FAIL-CLOSED dan mengembalikan hasil
  // eksplisit per kind. Versi 6.3 menelan semua kegagalan di try/catch dan
  // menyelesaikan promise seolah-olah berhasil: bila signer.getAddress()
  // atau getNetwork() gagal sementara, pemanggil lanjut ke gerbang hash
  // dengan ref kosong, gerbang melihat "tidak ada record", dan scan event
  // polos boleh membuka kontrol di atas transaksi yang sebenarnya masih
  // pending — persis celah yang Batch 6.3 seharusnya tutup. Lebih buruk
  // lagi, promise yang gagal itu di-cache, jadi retry pun tidak pernah
  // mencoba hidrasi ulang selama instance arena hidup. Sekarang:
  //   - identitas tidak terbaca -> kedua kind { ok: false,
  //     reason: "identity-unavailable" }.
  //   - bacaan storage per kind melempar (loadPendingTxResult "error")
  //     -> kind itu { ok: false, reason: "storage-unavailable" }.
  //     Bacaan berhasil tanpa entri ("absent") atau dengan entri valid
  //     ("found") adalah ok: secara konklusif memang tidak ada record
  //     persisten untuk konteks itu.
  //   - Batch 6.3.2: entri ADA tetapi rusak / tidak lolos validasi
  //     (loadPendingTxResult "invalid") -> kind itu { ok: false,
  //     reason: "invalid-record" }. Isi yang tidak bisa dipercaya bukan
  //     bukti tidak ada transaksi pending, jadi perlakuannya sama
  //     seperti kegagalan lain: fail-closed + peringatan recovery.
  //   - hanya hasil yang SEPENUHNYA ok yang tetap di-cache; hasil gagal
  //     membersihkan cache begitu promise selesai, jadi pemeriksaan atau
  //     retry berikutnya menjalankan hidrasi ulang.
  // Kegagalan hidrasi tidak pernah ditafsirkan sebagai bukti tidak ada
  // record: kedua fungsi verifikasi memeriksa hasil ini per kind dan
  // berhenti di status "unknown" tanpa menyentuh gerbang maupun scan.
  type HydrationResult =
    | { ok: true }
    | {
        ok: false;
        reason: "identity-unavailable" | "storage-unavailable" | "invalid-record";
      };
  type HydrationOutcome = { commit: HydrationResult; scout: HydrationResult };

  function ensurePendingTxHydrated(): Promise<HydrationOutcome> {
    if (!pendingTxHydrationRef.current) {
      const p = (async (): Promise<HydrationOutcome> => {
        let sender: string;
        let chainId: number;
        try {
          sender = (await signer.getAddress()).toLowerCase();
          chainId = Number((await readProvider.getNetwork()).chainId);
        } catch {
          const fail: HydrationResult = { ok: false, reason: "identity-unavailable" };
          return { commit: fail, scout: fail };
        }
        const outcome = {} as HydrationOutcome;
        for (const kind of ["commit", "scout"] as const) {
          if (unconfirmedTxByKindRef.current[kind]) {
            // Record sesi ini lebih segar dari storage; kind ini tidak
            // bergantung pada hasil bacaan storage sama sekali.
            outcome[kind] = { ok: true };
            continue;
          }
          const res = loadPendingTxResult(chainId, CONTRACT_ADDRESS, matchId, round, sender, kind);
          if (res.status === "error") {
            outcome[kind] = { ok: false, reason: "storage-unavailable" };
          } else if (res.status === "invalid") {
            // Batch 6.3.2: entri ada tetapi tidak bisa divalidasi.
            // Fail-closed persis seperti kegagalan bacaan: entri yang
            // tidak bisa dipercaya tidak boleh diperlakukan sebagai
            // "tidak ada record".
            outcome[kind] = { ok: false, reason: "invalid-record" };
          } else {
            if (res.status === "found") unconfirmedTxByKindRef.current[kind] = res.record;
            outcome[kind] = { ok: true };
          }
        }
        const display =
          unconfirmedTxByKindRef.current.commit ?? unconfirmedTxByKindRef.current.scout;
        if (display) setUnconfirmedTx((prev) => prev ?? display);
        return outcome;
      })();
      pendingTxHydrationRef.current = p;
      // Cache hanya untuk keberhasilan penuh. Penangan ini terdaftar
      // sebelum continuation para pemanggil (yang meng-await promise yang
      // sama), jadi ref sudah dibersihkan sebelum pemeriksaan berikutnya
      // dimulai; pemanggil saat ini tetap menerima hasil gagalnya dan
      // fail-closed pada kind terkait.
      void p.then((outcome) => {
        if (
          (!outcome.commit.ok || !outcome.scout.ok) &&
          pendingTxHydrationRef.current === p
        ) {
          pendingTxHydrationRef.current = null;
        }
      });
    }
    return pendingTxHydrationRef.current;
  }

  // Batch 6.2 — gerbang hash (menutup celah transaksi pending dari review
  // Batch 6.1). Batch 6.1 memaksa status "unknown" saat tx.wait() gagal
  // setelah broadcast, tetapi verifikasi retry/mount hanya membaca scan
  // event sampai blok terbaru: bila transaksi asli MASIH PENDING, event-nya
  // memang belum ada, scan menyimpulkan "tidak ditemukan" secara konklusif,
  // dan kontrol sempat dibuka lagi padahal transaksi lama masih bisa
  // tereksekusi. Sekarang, selama ada record unconfirmedTx untuk jenis
  // ini, status transaksi berdasarkan HASH diperiksa lebih dulu dan hasil
  // scan event tidak boleh bertentangan dengannya:
  //   "scan"        — tidak ada record, ATAU receipt membuktikan tx gagal
  //                   (status 0): record dihapus (clearRecord) dan scan
  //                   event normal yang memutuskan status sebenarnya.
  //   "scan-strict" — receipt sukses (status 1), ATAU nonce sudah terpakai
  //                   tx lain yang mined (kemungkinan tx pengganti dari
  //                   speed-up wallet): scan event tetap berjalan, tetapi
  //                   HANYA hasil "ditemukan" yang boleh menyelesaikan
  //                   status dan menghapus record. Hasil tidak ditemukan
  //                   (konklusif sekalipun) berarti TIDAK KONSISTEN dengan
  //                   receipt: status tetap "unknown", record disimpan.
  //   "blocked"     — tx masih pending, atau tx tidak ditemukan sementara
  //                   nonce-nya belum terpakai, atau pemeriksaan hash itu
  //                   sendiri gagal di RPC: status tetap "unknown", record
  //                   disimpan, scan event tidak dijalankan sama sekali.
  // Fungsi ini tidak menulis state kecuali lewat nilai kembalian; pemanggil
  // memeriksanya setelah isLatest() agar sequence guard Batch 6.1 tetap
  // menaungi semua await baru ini.
  // Batch 6.3: record yang dibaca fungsi ini bisa berasal dari sesi aktif
  // maupun dari hidrasi localStorage setelah reload — sumbernya tidak
  // mengubah logika gerbang sama sekali; record hasil hidrasi melewati
  // keputusan scan / scan-strict / blocked yang persis sama.
  type TxHashGate = "scan" | "scan-strict" | "blocked";

  async function consultTxHashGate(
    kind: "commit" | "scout",
    sender: string
  ): Promise<{ gate: TxHashGate; pending: boolean; clearRecord: boolean }> {
    const rec = unconfirmedTxByKindRef.current[kind];
    if (!rec) return { gate: "scan", pending: false, clearRecord: false };
    try {
      const receipt = await readProvider.getTransactionReceipt(rec.hash);
      if (receipt) {
        if (receipt.status === 1) return { gate: "scan-strict", pending: false, clearRecord: false };
        if (receipt.status === 0) return { gate: "scan", pending: false, clearRecord: true };
        return { gate: "blocked", pending: false, clearRecord: false }; // status receipt tidak dikenal: jangan menebak
      }
      const tx = await readProvider.getTransaction(rec.hash);
      if (tx) return { gate: "blocked", pending: true, clearRecord: false }; // dikenal provider, belum ada receipt: masih pending
      // Hash tidak ditemukan: ter-drop atau tergantikan. Nonce memutuskan:
      // nonce sudah terpakai transaksi mined -> kemungkinan tx pengganti,
      // biarkan scan event konklusif (mode strict) yang memutuskan. Nonce
      // belum terpakai -> tx hanya belum terlihat; jangan anggap gagal.
      if (!Number.isInteger(rec.nonce)) return { gate: "blocked", pending: false, clearRecord: false };
      const minedCount = await readProvider.getTransactionCount(sender);
      return minedCount > rec.nonce
        ? { gate: "scan-strict", pending: false, clearRecord: false }
        : { gate: "blocked", pending: false, clearRecord: false };
    } catch {
      return { gate: "blocked", pending: false, clearRecord: false }; // RPC gagal saat memeriksa hash: tetap unknown
    }
  }

  const contract = useMemo(() => getGameContract(signer), [signer]);
  const readContract = useMemo(() => getGameReadContract(), []);

  // Persistensi Scout (Batch 1 #7, lihat lib/scoutStorage.ts): transaksi Scout
  // bisa berhasil onchain sementara dekripsinya gagal (relayer lambat) — tanpa
  // cache, UI tidak tahu Scout sudah terpakai dan budget desync dari kontrak.
  // Tapi cache TIDAK pernah dipercaya begitu saja: saat arena dimuat, status
  // Scout diverifikasi dulu ke event VaultScouted onchain. Flag "scout used"
  // dari cache langsung dipakai agar budget benar sejak paint pertama, namun
  // NILAI dekripsinya baru ditampilkan setelah chain mengonfirmasi vault +
  // jenis stat yang sama (atau verifikasi tidak konklusif -> fallback cache).
  async function persistScout(entry: { vaultIdx: number; checkAlarm: boolean; value: number | null }) {
    try {
      const wallet = (await signer.getAddress()).toLowerCase();
      saveScout(CONTRACT_ADDRESS, matchId, round, wallet, entry);
    } catch {
      /* abaikan — Scout tetap tercatat onchain */
    }
  }

  // Batch 6: restore Scout kini fungsi bernama agar bisa dijalankan ulang
  // lewat tombol retry saat hasilnya "unknown". Status akhir selalu salah
  // satu dari tiga kondisi eksplisit — tidak ada lagi gerbang boolean yang
  // terbuka pada SEMUA hasil (Batch 4 membuka gerbang juga saat scan
  // gagal, sehingga kegagalan RPC tersamar sebagai "Scout belum terpakai").
  async function restoreScoutStatus() {
    // Batch 6.1: sequence guard. Effect mount, StrictMode double-effect,
    // dan tombol retry bisa menjalankan pemeriksaan ini bersamaan; tanpa
    // guard, scan lama yang selesai belakangan bisa menimpa hasil scan
    // yang lebih baru. Hanya pemanggilan dengan nomor urut terakhir yang
    // boleh menulis state.
    const seq = ++scoutCheckSeq.current;
    const isLatest = () => seq === scoutCheckSeq.current;
    setScoutStatus("syncing");
    try {
      enforceRetention();
      const wallet = (await signer.getAddress()).toLowerCase();
      if (!isLatest()) return;
      migrateLegacyScout(matchId, round, CONTRACT_ADDRESS, wallet);
      const cached = loadScout(CONTRACT_ADDRESS, matchId, round, wallet);
      if (cached) setCachedScoutUsed(true);

      // Batch 6.3: tunggu hidrasi record persisten selesai dulu, agar
      // gerbang hash di bawah melihat record hasil reload (bila ada),
      // bukan ref yang masih kosong.
      // Batch 6.3.1 (P0): hasilnya kini diperiksa. Bila hidrasi untuk
      // kind Scout GAGAL (identitas / bacaan storage) dan tidak ada
      // record sesi di ref, pemeriksaan BERHENTI di "unknown": gerbang
      // hash tidak dikonsultasikan dan scan event tidak dijalankan,
      // karena ref yang kosong pada titik ini tidak membuktikan apa pun.
      // Retry menjalankan ulang pemeriksaan ini, dan hidrasi yang gagal
      // tidak di-cache, jadi retry benar-benar mencoba hidrasi lagi.
      const hydration = await ensurePendingTxHydrated();
      if (!isLatest()) return;
      // Batch 6.3.2: peringatan recovery mengikuti hasil hidrasi kind
      // ini — menyala hanya untuk kegagalan invalid-record, mati begitu
      // hidrasi kind ini berhasil.
      if (hydration.scout.ok) {
        setHydrationWarning((w) => (w.scout ? { ...w, scout: false } : w));
      } else if (
        !unconfirmedTxByKindRef.current.scout &&
        hydration.scout.reason === "invalid-record"
      ) {
        setHydrationWarning((w) => (w.scout ? w : { ...w, scout: true }));
      }
      if (!unconfirmedTxByKindRef.current.scout && !hydration.scout.ok) {
        setScoutStatus("unknown");
        return;
      }

      // Batch 6.2: gerbang hash lebih dulu. Selama ada tx Scout yang belum
      // terkonfirmasi untuk ronde ini, kesimpulan scan event tidak boleh
      // membuka Scout atau menghapus record sebelum status hash diketahui:
      // tx yang masih pending memang belum punya event, jadi "tidak
      // ditemukan" pada titik itu bukan bukti apa pun.
      const gateRes = await consultTxHashGate("scout", wallet);
      if (!isLatest()) return;
      if (gateRes.clearRecord) clearUnconfirmedTx("scout"); // receipt status 0: tx terbukti gagal, record selesai
      setUnconfirmedTxPending(gateRes.pending);
      const chain =
        gateRes.gate === "blocked"
          ? null // gerbang menahan: jangan jalankan scan event sama sekali
          : await findScoutOnchain(readContract, matchId, round, wallet);
      if (!isLatest()) return;

      if (chain && chain.found) {
        const kind = chain.checkAlarm ? ("alarm" as const) : ("loot" as const);
        if (
          cached &&
          cached.vaultIdx === chain.vaultIdx &&
          cached.checkAlarm === chain.checkAlarm &&
          cached.value !== null
        ) {
          // Terverifikasi: cache cocok dengan event onchain -> tampilkan nilai.
          setScoutAnimate(false);
          setScouted({ vaultIdx: cached.vaultIdx, kind, value: cached.value });
          setPendingScout(null);
        } else {
          // Chain menang: Scout terpakai di vault ini (mungkin dari browser
          // lain / cache basi) — nilainya belum ada di browser ini, tawarkan
          // dekripsi ulang gratis lewat panel pending.
          setScouted(null);
          setPendingScout({ vaultIdx: chain.vaultIdx, kind });
          if (!cached || cached.vaultIdx !== chain.vaultIdx || cached.checkAlarm !== chain.checkAlarm) {
            saveScout(CONTRACT_ADDRESS, matchId, round, wallet, {
              vaultIdx: chain.vaultIdx,
              checkAlarm: chain.checkAlarm,
              value: null,
            });
          }
        }
        setCachedScoutUsed(false);
        setScoutStatus("verified-used");
        clearUnconfirmedTx("scout"); // Batch 6.1/6.2: event Scout konsisten dengan receipt -> record tx ambigu selesai
      } else if (chain && !chain.found && gateRes.gate !== "scan-strict") {
        // Konklusif: seluruh rentang sejak MatchCreated terpindai dan tidak
        // ada event Scout untuk ronde ini. Hanya hasil sekonklusif ini yang
        // boleh membuang cache dan menyatakan Scout belum terpakai.
        if (cached) clearScout(CONTRACT_ADDRESS, matchId, round, wallet);
        setCachedScoutUsed(false);
        setScouted(null);
        setPendingScout(null);
        setScoutStatus("verified-unused");
        clearUnconfirmedTx("scout"); // mode "scan": tidak ada record, atau receipt status 0 sudah menghapusnya di gerbang hash
      } else {
        // Tidak konklusif — RPC gagal / rentang tidak lengkap, ATAU gerbang
        // hash Batch 6.2 menahan kesimpulan: tx Scout masih pending
        // ("blocked", scan bahkan tidak dijalankan), atau receipt sukses
        // tetapi event-nya tidak terlihat ("scan-strict" + tidak
        // ditemukan = tidak konsisten). Pada semua kasus ini cache TIDAK
        // dibuang, record tx TIDAK dihapus, dan Scout TIDAK dinyatakan
        // belum terpakai. Nilai cache
        // (bila ada) tetap ditampilkan sebagai fallback tampilan, tetapi
        // status sinkronisasi adalah "unknown": tombol Scout tetap nonaktif
        // dan pemain ditawari retry verifikasi. Sisa permainan (alokasi,
        // LOCK IN) tidak terpengaruh.
        if (cached) {
          if (cached.value !== null) {
            setScoutAnimate(false);
            setScouted({
              vaultIdx: cached.vaultIdx,
              kind: cached.checkAlarm ? "alarm" : "loot",
              value: cached.value,
            });
          } else {
            setPendingScout({
              vaultIdx: cached.vaultIdx,
              kind: cached.checkAlarm ? "alarm" : "loot",
            });
          }
          setCachedScoutUsed(false);
        }
        setScoutStatus("unknown");
      }
    } catch {
      if (isLatest()) setScoutStatus("unknown");
    }
  }

  useEffect(() => {
    void restoreScoutStatus();
    // Batch 6.1: cleanup membatalkan pemeriksaan yang masih berjalan saat
    // match/ronde berganti atau komponen unmount (menaikkan nomor urut
    // membuat hasil in-flight menjadi basi dan diabaikan).
    return () => {
      scoutCheckSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, round]);

  // Batch 4 (P0-A) + Batch 6: pulihkan status commit dari event
  // AllocationCommitted saat arena dimuat. Tanpa ini, pemain yang sudah
  // commit lalu refresh melihat tombol LOCK IN lagi (waitingOpp selalu
  // mulai false) dan bisa mencoba commit kedua yang pasti revert di
  // kontrak. Batch 6 mengganti boolean Batch 4 (yang menjadi true pada
  // SEMUA hasil, termasuk scan gagal — sehingga RPC yang bermasalah
  // membuka kembali LOCK IN untuk pemain yang sebenarnya sudah commit)
  // dengan status empat kondisi:
  //   checking              -> kontrol terkunci, pemeriksaan berjalan
  //   verified-uncommitted  -> scan konklusif, belum commit: LOCK IN aktif
  //   committed             -> scan konklusif, sudah commit: panel
  //                            ORDERS LOCKED / WAITING FOR OPPONENT yang
  //                            sudah ada mengambil alih (waitingOpp)
  //   unknown               -> scan gagal / tidak konklusif: kontrol TETAP
  //                            terkunci + tombol RETRY STATUS CHECK.
  // Kegagalan RPC tidak pernah lagi disamakan dengan "belum commit".
  async function checkCommitStatus() {
    // Batch 6.1: sequence guard yang sama seperti restoreScoutStatus,
    // independen: hanya pemanggilan terbaru yang boleh menulis state,
    // hasil scan lama yang selesai belakangan diabaikan.
    const seq = ++commitCheckSeq.current;
    const isLatest = () => seq === commitCheckSeq.current;
    setCommitStatus("checking");
    try {
      if (finished || matchInfo.state !== 1) {
        // Arena tidak dalam fase commit (match selesai / belum aktif):
        // pemeriksaan tidak berlaku, jangan blokir UI karenanya.
        setCommitStatus("verified-uncommitted");
        return;
      }
      const me = await signer.getAddress();
      if (!isLatest()) return;
      // Batch 6.3: tunggu hidrasi record persisten selesai dulu, agar
      // gerbang hash di bawah melihat record hasil reload (bila ada),
      // bukan ref yang masih kosong.
      // Batch 6.3.1 (P0): fail-closed yang sama seperti Scout. Hidrasi
      // commit yang gagal tanpa record sesi di ref -> tetap "unknown",
      // tanpa gerbang hash dan tanpa scan event; LOCK IN tidak boleh
      // dibuka oleh ketiadaan informasi. Retry mengulang hidrasi karena
      // hasil gagal tidak di-cache.
      const hydration = await ensurePendingTxHydrated();
      if (!isLatest()) return;
      // Batch 6.3.2: peringatan recovery per kind, sama seperti Scout.
      if (hydration.commit.ok) {
        setHydrationWarning((w) => (w.commit ? { ...w, commit: false } : w));
      } else if (
        !unconfirmedTxByKindRef.current.commit &&
        hydration.commit.reason === "invalid-record"
      ) {
        setHydrationWarning((w) => (w.commit ? w : { ...w, commit: true }));
      }
      if (!unconfirmedTxByKindRef.current.commit && !hydration.commit.ok) {
        setCommitStatus("unknown");
        return;
      }
      // Batch 6.2: gerbang hash lebih dulu, sama seperti Scout. Tx commit
      // yang masih pending belum punya event AllocationCommitted, jadi
      // scan yang menyimpulkan "belum commit" saat itu juga akan membuka
      // LOCK IN di atas transaksi yang masih bisa tereksekusi.
      const gateRes = await consultTxHashGate("commit", me);
      if (!isLatest()) return;
      if (gateRes.clearRecord) clearUnconfirmedTx("commit"); // receipt status 0: tx terbukti gagal, record selesai
      setUnconfirmedTxPending(gateRes.pending);
      if (gateRes.gate === "blocked") {
        // Tx masih pending / tidak ditemukan dengan nonce belum terpakai /
        // pemeriksaan hash gagal: tetap unknown, record disimpan, LOCK IN
        // tetap terkunci, scan event tidak dijalankan.
        setCommitStatus("unknown");
        return;
      }
      const oppAddress = myPlayer === 1 ? matchInfo.player2 : matchInfo.player1;
      const res = await findRoundCommits(readContract, matchId, round, me, oppAddress);
      if (!isLatest()) return;
      if (!res.conclusive) {
        setCommitStatus("unknown");
        return;
      }
      if (gateRes.gate === "scan-strict" && !res.mine) {
        // Receipt membuktikan tx commit berhasil (atau nonce-nya terpakai
        // tx pengganti yang mined), tetapi event commit ronde ini tidak
        // terlihat: tidak konsisten. Jangan buka LOCK IN, jangan hapus
        // record; retry berikutnya memeriksa ulang hash lalu event.
        setCommitStatus("unknown");
        return;
      }
      setOppCommitted(res.opponent);
      clearUnconfirmedTx("commit"); // Batch 6.1/6.2: verifikasi konklusif (dan konsisten dengan receipt bila ada) menyelesaikan record tx commit yang sempat ambigu
      if (res.mine) {
        setWaitingOpp(true);
        setCommitStatus("committed");
      } else {
        setCommitStatus("verified-uncommitted");
      }
    } catch {
      if (isLatest()) setCommitStatus("unknown");
    }
  }

  useEffect(() => {
    void checkCommitStatus();
    // Batch 6.1: cleanup membatalkan pemeriksaan in-flight saat
    // match/ronde berganti atau komponen unmount.
    return () => {
      commitCheckSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, round]);

  // Batch 5: ambil serah-terima cinematic reveal dari instance arena
  // sebelumnya (App me-remount arena tiap ronde). Hanya jalur submit
  // langsung yang menyerahkan data; resume/polling/backfill tidak pernah
  // menulisnya, dan refresh halaman menghapusnya (memori modul).
  useEffect(() => {
    const data = consumePendingReveal(matchId);
    if (data) setCineReveal(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const scoutUsed = scouted !== null || pendingScout !== null || cachedScoutUsed;
  // Batch 6.1 (P0): budget konservatif. Kontrak mematok budget 9 bila
  // Scout sudah terpakai (BASE_CREW - 1) dan _validateBudget menolkan
  // SELURUH bid yang totalnya melewati cap, sementara transaksinya tetap
  // sukses — alokasi 10 yang dikirim saat status Scout sebenarnya
  // "sudah terpakai" akan hilang diam-diam. Jadi selama status Scout
  // belum terverifikasi ("syncing" / "unknown"), cap UI adalah 9 walau
  // cache lokal kosong: hanya "verified-unused" yang membuka budget 10.
  // Harga ketidakpastian ini maksimal satu agen untuk sementara; harga
  // menebak sebaliknya adalah seluruh alokasi ronde.
  const scoutBudgetUncertain = scoutStatus === "syncing" || scoutStatus === "unknown";
  const maxBudget = scoutUsed || scoutBudgetUncertain ? BASE_BUDGET - 1 : BASE_BUDGET;
  const showConservativeBudgetNote = scoutBudgetUncertain && !scoutUsed;
  const total = bids[0] + bids[1] + bids[2];
  const overBudget = total > maxBudget;
  const finished = matchInfo.state === 2;
  const oppLabel = matchInfo.vsBot ? "Syndicate AI" : myPlayer === 1 ? "Player 2" : "Player 1";

  // Dialog Syndicate AI — pembuka ronde (hanya mode Solo; komponen di-remount
  // tiap ronde oleh App, jadi effect ini berjalan sekali per ronde).
  useEffect(() => {
    if (!matchInfo.vsBot || finished) return;
    setDialogue(
      round === 1 ? "Another crew thinks they can outsmart us?" : "Three vaults. Don't get greedy."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reaksi Syndicate AI saat match berakhir + pruning cache Scout match ini
  // (kontrak: entri dibersihkan begitu match Finished / state === 2).
  useEffect(() => {
    if (!finished) return;
    if (matchInfo.vsBot) {
      setDialogue(
        scores.you > scores.opp
          ? "Impossible... You cracked our vault!"
          : scores.you === scores.opp
            ? "A standoff. Neither crew walks away clean."
            : "The Syndicate always collects its dues."
      );
    }
    (async () => {
      try {
        const wallet = (await signer.getAddress()).toLowerCase();
        pruneMatchScouts(CONTRACT_ADDRESS, matchId, wallet);
        // Batch 5: dialog milestone streak Syndicate AI (hanya Solo, hanya
        // bila match INI yang dimenangkan pemain). Streak dihitung berakhir
        // tepat di entri match ini di streakStorage, jadi angkanya adalah
        // streak yang dihasilkan match ini, bukan streak sesi saat ini.
        // Hasil match dicatat App sebelum arena melihat state Finished
        // (jalur live) atau sebelum arena di-mount (jalur resume), dan
        // pencatatannya dedupe per matchId.
        if (matchInfo.vsBot && scores.you > scores.opp) {
          const entries = loadMatchResults(wallet);
          const ix = entries.findIndex((e) => e.matchId === matchId);
          if (ix >= 0 && entries[ix].outcome === "win") {
            let streak = 0;
            for (let i = ix; i >= 0; i--) {
              if (entries[i].outcome !== "win") break;
              streak++;
            }
            if (streak === 3)
              setDialogue("Three in a row. Enjoy it while it lasts, the vaults learn fast.");
            else if (streak === 5)
              setDialogue("Five straight hits on my vaults? Nobody is that lucky. Nobody.");
            else if (streak === 10)
              setDialogue("TEN in a row?! Impossible. Someone on my crew is getting fired tonight.");
          }
        }
      } catch {
        /* abaikan */
      }
    })();
  }, [finished, scores.you, scores.opp, matchInfo.vsBot, matchId, signer]);

  // Ambil handle ciphertext brankas ronde ini (hanya untuk tooltip teknis pada stempel CLASSIFIED / SEALED di UI)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows: { loot: string; alarm: string }[] = [];
        for (let i = 0; i < 3; i++) {
          const [loot, alarm] = await readContract.getVaultHandles(matchId, round, i);
          rows.push({ loot, alarm });
        }
        if (!cancelled) setHandles(rows);
      } catch {
        /* pratinjau handle bersifat opsional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readContract, matchId, round]);

  // Batch 6.1: fase 1 ("siap lock in") membandingkan total dengan cap
  // efektif ronde ini (maxBudget), bukan angka 10 yang diasumsikan tetap —
  // dengan budget konservatif 9, total 9 adalah alokasi lengkap.
  const phase = waitingOpp || busy ? 3 : scoutUsed || total !== maxBudget ? 2 : 1;

  function setBid(idx: number, value: number) {
    setBids((prev) => {
      const next: [number, number, number] = [...prev];
      next[idx] = value;
      return next;
    });
  }

  // Dekripsi hasil Scout yang transaksinya SUDAH tercatat onchain.
  // Dipisah dari handleScout agar bisa di-retry tanpa transaksi baru.
  async function decryptPending(p: { vaultIdx: number; kind: "loot" | "alarm" }) {
    setStep(
      "This is a gas-free signature to privately reveal your scouted intelligence. It does not transfer tokens or spend your funds."
    );
    const [lootHandle, alarmHandle] = await readContract.getVaultHandles(matchId, round, p.vaultIdx);
    const value = await userDecryptHandle(
      p.kind === "alarm" ? alarmHandle : lootHandle,
      CONTRACT_ADDRESS,
      signer
    );
    // Reveal segar dari dekripsi langsung: jalankan cipher scramble + blip.
    setScoutAnimate(true);
    playReveal();
    setScouted({ vaultIdx: p.vaultIdx, kind: p.kind, value: Number(value) });
    setPendingScout(null);
    void persistScout({ vaultIdx: p.vaultIdx, checkAlarm: p.kind === "alarm", value: Number(value) });
  }

  // Kontrak menolak karena status match di onchain sudah berubah (mis. sudah
  // Finished) sementara UI masih memegang tampilan lama: sinkronkan ulang dari
  // chain alih-alih menampilkan error yang membingungkan.
  function isStaleStateError(err: any): boolean {
    const msg = String(err?.reason ?? err?.message ?? err ?? "");
    return /Match tidak aktif|Match sudah dimulai|Match penuh/.test(msg);
  }

  async function handleScout(idx: number, kind: "loot" | "alarm") {
    if (scoutStatus !== "verified-unused") return; // Batch 6: Scout hanya dari status terverifikasi belum terpakai; "unknown" tidak pernah dianggap belum terpakai
    setBusy(true);
    playClick(); // Batch 5: klik interaksi saja; konfirmasi sonar setelah tx berhasil
    try {
      setStep("Sending Scout transaction (needs Sepolia gas), granting decryption access only to your wallet…");
      // Batch 6.1: pisahkan kegagalan SEBELUM broadcast (wallet menolak /
      // pengiriman gagal: belum ada hash, perilaku lama dipertahankan)
      // dari ambiguitas SETELAH broadcast (hash sudah ada tetapi
      // tx.wait() gagal membaca receipt: transaksi mungkin sudah masuk
      // blok). Pada kondisi kedua status Scout dipaksa "unknown" dan
      // hash disimpan untuk ditampilkan; UI tidak pernah menebak Scout
      // belum terpakai dan tidak pernah mengirim ulang. Verifikasi event
      // onchain (tombol Retry check) yang memutuskan status sebenarnya,
      // termasuk bila tx ternyata revert (konklusif tidak ditemukan ->
      // verified-unused).
      let tx: any = null;
      try {
        tx = await contract.scoutVault(matchId, idx, kind === "alarm");
        await tx.wait();
      } catch (txErr: any) {
        if (tx) {
          setScoutStatus("unknown");
          storeUnconfirmedTx(await captureUnconfirmedTx("scout", tx)); // Batch 6.2: nonce disimpan agar gerbang hash bisa mengenali tx pengganti (replacement). Batch 6.3: record membawa identitas konteks lengkap dan dipersistensikan lewat storeUnconfirmedTx
          return;
        }
        throw txErr;
      }
      playSonar(); // Batch 5: konfirmasi, transaksi Scout sudah tercatat onchain
      setScoutStatus("verified-used"); // Batch 6: receipt transaksi sesi ini adalah bukti konklusif Scout terpakai
      // Sejak transaksi ini tercatat, budget onchain = 9. Tandai SEKARANG,
      // sebelum dekripsi dicoba, agar UI tidak pernah desync dari kontrak.
      const p = { vaultIdx: idx, kind };
      setPendingScout(p);
      void persistScout({ vaultIdx: idx, checkAlarm: kind === "alarm", value: null });
      if (matchInfo.vsBot) setDialogue("Trying to peek behind our doors?");
      await decryptPending(p);
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  async function handleRetryDecrypt() {
    if (!pendingScout) return;
    setBusy(true);
    try {
      await decryptPending(pendingScout);
    } catch (err: any) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  // Setelah commit: baca ulang match; bila ronde sudah beres, dekripsi publik hasilnya
  const collectResolution = useCallback(
    async (playedRound: number, quiet = false): Promise<boolean> => {
      const updated = await fetchMatch(readContract, matchId);
      const resolved = updated.currentRound !== playedRound || updated.state === 2;
      if (!resolved) return false;

      if (!quiet) setStep("Decrypting public round results (alarms & scores)…");
      const alarmHandles: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [, , alarmTripped] = await readContract.getVaultHandles(matchId, playedRound, i);
        alarmHandles.push(alarmTripped);
      }
      const clear = await publicDecryptHandles([
        ...alarmHandles,
        updated.score1Handle,
        updated.score2Handle,
      ]);
      const alarms = alarmHandles.map((h) => Boolean(clear[h])) as [boolean, boolean, boolean];
      setOutcomes(alarms); // pintu brankas terbuka sesuai hasil ronde ini (presentasi saja)
      const s1 = Number(clear[updated.score1Handle] as any);
      const s2 = Number(clear[updated.score2Handle] as any);
      const mapped = myPlayer === 1 ? { you: s1, opp: s2 } : { you: s2, opp: s1 };
      // Batch 5: simpan hasil resolusi ini agar handleSubmit bisa memicu
      // cinematic overlay. Jalur refresh/recovery juga mengisi ref ini,
      // tetapi tidak pernah membacanya untuk overlay.
      resolutionRef.current = { round: playedRound, alarms, mapped };
      // Denting koin bila skor pemain naik ronde ini. `scores` di sini adalah
      // skor awal ronde (arena di-remount tiap ronde), baseline yang tepat.
      if (mapped.you > scores.you) playCoin();
      onRoundResolved({ matchId, round: playedRound, alarms, scoreYou: mapped.you, scoreOpp: mapped.opp }, updated, mapped);
      return true;
    },
    [contract, matchId, myPlayer, onRoundResolved]
  );

  async function handleSubmit() {
    setBusy(true);
    playClick(); // Batch 5: klik interaksi saja; konfirmasi kunci baja setelah tx berhasil
    try {
      const userAddress = await signer.getAddress();
      // Progres 4 tahap (Batch 1 #6) — digerakkan state async asli, bukan timer:
      // 1 enkripsi FHE berjalan -> 2 menunggu tanda tangan MetaMask ->
      // 3 menunggu tx.wait() -> 4 ambil state + publicDecrypt hasil ronde.
      setSubmitStage(1);
      const { handles: encHandles, inputProof } = await encryptBids(CONTRACT_ADDRESS, userAddress, bids);

      setSubmitStage(2);
      // Batch 6.1: ambiguitas receipt, sama seperti handleScout. Kegagalan
      // sebelum hash ada (wallet menolak / pengiriman gagal) diteruskan ke
      // catch luar dengan perilaku lama. Hash sudah ada tetapi tx.wait()
      // gagal: status commit dipaksa "unknown" (LOCK IN tetap terkunci,
      // panel RETRY STATUS CHECK muncul), hash disimpan untuk ditampilkan
      // sebagai link Etherscan, dan tidak ada pengiriman ulang otomatis.
      // Event AllocationCommitted yang memutuskan status sebenarnya.
      let tx: any = null;
      try {
        tx = await contract.submitAllocation(matchId, encHandles, inputProof);
        setSubmitStage(3);
        await tx.wait();
      } catch (txErr: any) {
        if (tx) {
          setCommitStatus("unknown");
          storeUnconfirmedTx(await captureUnconfirmedTx("commit", tx)); // Batch 6.2: nonce disimpan agar gerbang hash bisa mengenali tx pengganti (replacement). Batch 6.3: record membawa identitas konteks lengkap dan dipersistensikan lewat storeUnconfirmedTx
          return;
        }
        throw txErr;
      }
      playLock(); // Batch 5: konfirmasi, alokasi sudah tercatat onchain
      if (matchInfo.vsBot) setDialogue("Orders received. Let's see who's smarter.");

      setSubmitStage(4);
      let done = false;
      try {
        done = await collectResolution(round, true);
      } catch {
        // Transaksi commit SUDAH tercatat onchain; yang gagal hanya mengambil
        // hasilnya dari relayer. Jangan tinggalkan arena mati: tampilkan panel
        // pemulihan agar hasil bisa diambil ulang tanpa transaksi baru.
        done = false;
      }
      if (!done) {
        setWaitingOpp(true);
        setCommitStatus("committed"); // Batch 6: transaksi commit sesi ini sudah tercatat onchain
        setStep(null);
      } else {
        // Batch 5: cinematic reveal overlay, HANYA dari jalur submit
        // langsung ini (handleRefresh/recovery tidak pernah memicunya).
        // Datanya murni hasil dekripsi collectResolution yang baru selesai;
        // delta dihitung terhadap skor awal ronde (prop `scores` instance
        // arena ronde ini).
        const res = resolutionRef.current;
        if (res && res.round === round) {
          const data: CinematicRevealData = {
            round,
            alarms: res.alarms,
            deltaYou: res.mapped.you - scores.you,
            deltaOpp: res.mapped.opp - scores.opp,
            totalYou: res.mapped.you,
            totalOpp: res.mapped.opp,
            oppLabel,
          };
          setCineReveal(data);
          // App me-remount arena saat ronde berganti (key berisi ronde):
          // serahkan data ke instance berikutnya lewat hand-off sekali
          // konsumsi. Ronde final tidak berganti key karena match
          // Finished, jadi overlay tampil dari state lokal instance ini.
          if (round < 3) stashPendingReveal(matchId, data);
        }
      }
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
      setStep(null);
    } finally {
      setSubmitStage(0);
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      const done = await collectResolution(round);
      if (!done) onError("Round results are not available yet. Try again in a moment.");
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const steps = ["1. Scout (Optional)", "2. Assign Agents", "3. Resolve Round"];

  return (
    <div className="rise-in mx-auto w-full max-w-6xl px-4 py-6">
      {/* Indikator fase */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1.5 font-mono text-xs font-semibold ${
                phase === i + 1
                  ? "bg-cyan-400 text-slate-950"
                  : phase > i + 1
                    ? "bg-emerald-400/15 text-emerald-400"
                    : "bg-slate-800 text-slate-400"
              }`}
            >
              {label}
            </span>
            {i < 2 && <span className="text-slate-600">→</span>}
          </div>
        ))}
        <span className="ml-auto font-mono text-xs text-slate-500">OPERATION #{matchId}</span>
      </div>

      {/* Addendum Batch 6.3: peringatan storage tidak tersedia. Ditampilkan
          selama arena terbuka dan probe menyatakan localStorage mati, agar
          pemain tahu SEBELUM mengirim transaksi bahwa persistensi mati di
          browser ini. Batch 6.3.2: teks diselaraskan dengan perilaku
          fail-closed Batch 6.3.1 — bila bacaan storage gagal, hidrasi
          gagal, verifikasi status transaksi tidak bisa dilanjutkan dengan
          aman, dan aksi yang membutuhkan verifikasi tetap terkunci di
          "unknown". Peringatan ini sendiri tidak mengunci apa pun; yang
          mengunci adalah jalur hidrasi fail-closed itu. */}
      {!pendingTxStorageAvailable && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            Browser storage is unavailable in this browser. Transaction status cannot be
            verified safely, so actions that need verification stay locked, and refreshing
            while a transaction is confirming is unsafe.
          </span>
        </div>
      )}

      {/* Batch 6.3.2: peringatan recovery untuk record persisten yang ada
          tetapi tidak lolos validasi. Selama catatan ini tampil, kind
          terkait berhenti di "unknown" (fail-closed): gerbang hash dan
          scan event tidak dijalankan untuknya sampai hidrasi berhasil. */}
      {(hydrationWarning.commit || hydrationWarning.scout) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            A saved transaction recovery record could not be validated, so actions stay
            locked for safety until it can be verified.
          </span>
        </div>
      )}

      {/* Dialog Syndicate AI (mode Solo saja) */}
      {matchInfo.vsBot && dialogue && <SyndicateBar line={dialogue} />}

      {/* HUD */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4">
        <div>
          <div className="text-[11px] tracking-widest text-slate-500">ROUND</div>
          <div className="font-mono text-xl font-bold">
            {Math.min(round, 3)} <span className="text-slate-500">/ 3</span>
          </div>
        </div>
        <div className="h-9 w-px bg-slate-800" />
        <div>
          <div className="text-[11px] tracking-widest text-slate-500">SCOREBOARD</div>
          <div className="font-mono text-xl font-bold">
            You <span className="text-cyan-300">{scores.you}</span>
            <span className="mx-2 text-slate-600">vs</span>
            {oppLabel} <span className="text-slate-100">{scores.opp}</span>
          </div>
        </div>
        <div className="ml-auto min-w-56">
          <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-widest text-slate-500">
            <span>AGENTS READY</span>
            <span className={`font-mono text-xs font-bold ${overBudget ? "text-rose-400" : "text-slate-300"}`}>
              {total} / {maxBudget}
              {scoutUsed ? " (Scout used)" : ""}
            </span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: BASE_BUDGET }).map((_, i) => (
              <span
                key={i}
                className={`h-2.5 flex-1 rounded-full ${
                  i < total
                    ? overBudget
                      ? "bg-rose-500"
                      : "bg-amber-400"
                    : i < maxBudget
                      ? "bg-slate-700"
                      : "bg-slate-800 opacity-40"
                }`}
              />
            ))}
          </div>
          {overBudget && (
            <p className="mt-1.5 text-xs text-rose-400">
              Total exceeds this round's agent budget ({maxBudget}). Reduce your assignment first.
            </p>
          )}
          {showConservativeBudgetNote && (
            <p className="mt-1.5 text-xs text-amber-300/90">
              Scout status is unverified. A conservative 9-agent budget is applied until synchronization completes.
            </p>
          )}
          {total === 0 && !finished && (
            <p className="mt-1.5 text-xs text-slate-500">Assign at least 1 agent to lock in.</p>
          )}
        </div>
      </div>

      {/* Kartu brankas */}
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((idx) => {
          const others = total - bids[idx];
          return (
            <VaultCard
              key={`${matchId}-${round}-${idx}`}
              idx={idx}
              bid={bids[idx]}
              maxBid={maxBudget - others}
              lootHandle={handles?.[idx]?.loot ?? null}
              alarmHandle={handles?.[idx]?.alarm ?? null}
              scouted={scouted?.vaultIdx === idx ? scouted : null}
              scoutUsed={scoutUsed}
              scoutGate={
                scoutStatus === "syncing"
                  ? "syncing"
                  : scoutStatus === "unknown"
                    ? "unknown"
                    : "ready"
              }
              onRetryScoutSync={() => void restoreScoutStatus()}
              busy={busy}
              locked={waitingOpp || finished || commitStatus !== "verified-uncommitted"}
              outcome={outcomes ? (outcomes[idx] ? "alarm" : "safe") : null}
              scoutAnimate={scoutAnimate}
              onBidChange={setBid}
              onScout={handleScout}
            />
          );
        })}
      </div>

      {/* Scout tercatat onchain tapi dekripsi belum berhasil -> tawarkan retry gratis */}
      {pendingScout && !scouted && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <Eye className="size-4 shrink-0" />
          <span>
            Your Scout is recorded onchain (this round's budget is now {maxBudget}), but the
            private decryption hasn't succeeded yet, the relayer is usually just slow.
          </span>
          <button
            onClick={handleRetryDecrypt}
            disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            <RefreshCw className="size-4" /> Retry Decryption (no new transaction)
          </button>
        </div>
      )}

      {/* Progres transaksi commit 4 tahap (state async asli, bukan timer) */}
      {submitStage > 0 && <TxProgress stage={submitStage} />}

      {/* Banner langkah / status */}
      {step && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span className="font-mono">{step}</span>
        </div>
      )}

      {/* Batch 6: status commit tidak terverifikasi (RPC gagal / scan tidak
          konklusif). Kontrol alokasi tetap terkunci agar pemain yang
          sebenarnya sudah commit tidak tergoda mencoba commit kedua yang
          pasti revert; retry menjalankan ulang verifikasi event. */}
      {commitStatus === "unknown" && !finished && !waitingOpp && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <RefreshCw className="size-4 shrink-0" />
          <span>
            Your commit status could not be verified onchain, the RPC did not answer
            conclusively. Allocation stays locked until the check succeeds, so a round you
            already committed can never be committed twice by accident.
          </span>
          <button
            onClick={() => void checkCommitStatus()}
            className="ml-auto flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
          >
            <RefreshCw className="size-4" /> RETRY STATUS CHECK
          </button>
        </div>
      )}

      {/* Batch 6.1: transaksi sudah terkirim (hash ada) tetapi receipt
          tidak terkonfirmasi. Status terkait sudah dipaksa "unknown" oleh
          handler, jadi LOCK IN / Scout tetap terkunci; panel ini hanya
          menjelaskan dan menautkan hash ke Etherscan. Pemain diarahkan ke
          retry verifikasi event, bukan mengirim ulang transaksi.
          Batch 6.2: selama gerbang hash belum memberi kepastian, retry
          memeriksa status hash itu lebih dulu; bila pemeriksaan terakhir
          menemukan transaksinya masih pending, kalimat panel menyebutnya
          secara eksplisit. */}
      {unconfirmedTx && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <Send className="size-4 shrink-0" />
          <span>
            Your {unconfirmedTx.kind === "commit" ? "commit" : "Scout"} transaction{" "}
            {unconfirmedTxPending
              ? "is still pending and has not been mined yet"
              : "was sent but could not be confirmed yet"}:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${unconfirmedTx.hash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-cyan-300 underline"
            >
              {unconfirmedTx.hash.slice(0, 10)}…{unconfirmedTx.hash.slice(-8)}
            </a>
            . Do not send it again. Use the retry status check instead; the onchain events
            decide the real status.
          </span>
          {/* Batch 6.3.1 (P1): peringatan persistensi per transaksi.
              savePendingTx melaporkan record transaksi INI gagal disimpan
              (storage menolak saat itu, atau identitas capture tidak
              lengkap), jadi berbeda dengan peringatan probe umum di atas
              arena: transaksi ini spesifik tidak akan selamat dari
              refresh, walau probe sempat menyatakan storage tersedia. */}
          {txPersistenceWarning[unconfirmedTx.kind] && (
            <span className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4 shrink-0" />
              This transaction's recovery record could not be saved in this browser. Do not
              refresh until its status is confirmed.
            </span>
          )}
        </div>
      )}

      {waitingOpp && !finished ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <CheckCircle2 className="size-5 text-emerald-400" />
          <span className="text-sm text-slate-200">
            <span className="font-bold tracking-widest text-emerald-300">ORDERS LOCKED</span>
            {" · "}
            {matchInfo.vsBot
              ? "Allocation committed & encrypted. This round's results are still syncing from the relayer…"
              : oppCommitted === true
                ? "Both crews have committed. Round results are still syncing from the relayer…"
                : oppCommitted === false
                  ? "WAITING FOR OPPONENT: your opponent has not committed yet."
                  : "Allocation committed & encrypted. Waiting for your opponent to commit…"}
          </span>
          <button
            onClick={handleRefresh}
            disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className="size-4" /> {matchInfo.vsBot ? "Fetch Round Results" : "Check Resolution"}
          </button>
        </div>
      ) : (
        !finished && (
          <button
            onClick={handleSubmit}
            disabled={busy || overBudget || total === 0 || commitStatus !== "verified-uncommitted"}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3.5 text-base font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            LOCK IN &amp; START HEIST
          </button>
        )
      )}

      {finished && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          <Lock className="size-4" /> Match finished. Rewards were minted as confidential cLOOT
          (score × 100). Reveal your balance from the top bar.
        </div>
      )}

      {/* Batch 5: cinematic reveal overlay (presentasi murni, lihat CinematicReveal.tsx) */}
      {cineReveal && <CinematicReveal data={cineReveal} onDone={closeReveal} />}
    </div>
  );
}
