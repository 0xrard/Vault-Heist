// ---------------------------------------------------------------------------
// Win streak persistence (Batch 3)
//
// Final match results (win / draw / loss) are stored in localStorage so
// the "Heist Streak" badge in the Lobby can be computed without reading the contract again.
// Prinsip:
// - One entry per matchId (dedupe): the same match is never recorded
//   twice, even if the user resumes a Finished match repeatedly.
// - The key is scoped per wallet: vaultheist:results:{walletAddress lowercase}.
// - Entries are sorted ascending by matchId (match IDs are sequential onchain, so
//   this order approximates chronological order) and capped at the last 50 entries
//   to keep storage small.
// - Only result metadata is stored: { matchId, outcome, savedAt }.
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

// Record one Finished match's result. No-op if the matchId is already recorded.
// Returns the latest entry list after recording.
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
    /* quota / unavailable: the streak is only a cosmetic feature, ignore */
  }
  return next;
}

// Streak = the number of consecutive wins counted from the latest match.
// A draw or a loss breaks the streak (resetting the count to 0 from that point).
export function currentWinStreak(entries: MatchResultEntry[]): number {
  let streak = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].outcome !== "win") break;
    streak++;
  }
  return streak;
}
