// ---------------------------------------------------------------------------
// Win streak persistence (Batch 3)
//
// Hasil akhir match (menang / seri / kalah) disimpan di localStorage agar
// badge "Heist Streak" di Lobby bisa dihitung tanpa membaca kontrak lagi.
// Prinsip:
// - Satu entri per matchId (dedupe): match yang sama tidak pernah tercatat
//   dua kali, walau user me-resume match Finished berkali-kali.
// - Key di-scope per wallet: vaultheist:results:{walletAddress lowercase}.
// - Entri diurutkan menaik per matchId (ID match sekuensial onchain, jadi
//   urutan ini mendekati urutan kronologis) dan dibatasi 50 entri terakhir
//   agar storage tetap kecil.
// - Yang disimpan hanya metadata hasil: { matchId, outcome, savedAt }.
// ---------------------------------------------------------------------------

export type MatchOutcome = "win" | "draw" | "loss";

export interface MatchResultEntry {
  matchId: number;
  outcome: MatchOutcome;
  savedAt: number;
}

const PREFIX = "vaultheist:results:";
const MAX_ENTRIES = 50;

function resultsKey(walletAddress: string): string {
  return `${PREFIX}${walletAddress.toLowerCase()}`;
}

export function loadMatchResults(walletAddress: string): MatchResultEntry[] {
  try {
    const raw = localStorage.getItem(resultsKey(walletAddress));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is MatchResultEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as MatchResultEntry).matchId === "number" &&
        ((e as MatchResultEntry).outcome === "win" ||
          (e as MatchResultEntry).outcome === "draw" ||
          (e as MatchResultEntry).outcome === "loss")
    );
  } catch {
    return [];
  }
}

// Catat hasil satu match Finished. No-op bila matchId sudah tercatat.
// Mengembalikan daftar entri terbaru setelah pencatatan.
export function recordMatchResult(
  walletAddress: string,
  matchId: number,
  scoreYou: number,
  scoreOpp: number
): MatchResultEntry[] {
  const entries = loadMatchResults(walletAddress);
  if (entries.some((e) => e.matchId === matchId)) return entries;
  const outcome: MatchOutcome =
    scoreYou > scoreOpp ? "win" : scoreYou === scoreOpp ? "draw" : "loss";
  const next = [...entries, { matchId, outcome, savedAt: Date.now() }]
    .sort((a, b) => a.matchId - b.matchId)
    .slice(-MAX_ENTRIES);
  try {
    localStorage.setItem(resultsKey(walletAddress), JSON.stringify(next));
  } catch {
    /* quota / tidak tersedia: streak hanya fitur kosmetik, abaikan */
  }
  return next;
}

// Streak = jumlah kemenangan beruntun dihitung dari match paling akhir.
// Seri atau kalah memutus streak (mengembalikan hitungan ke 0 dari titik itu).
export function currentWinStreak(entries: MatchResultEntry[]): number {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome !== "win") break;
    streak++;
  }
  return streak;
}
