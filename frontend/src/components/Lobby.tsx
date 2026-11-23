import { useEffect, useState } from "react";
import { Bot, ChevronLeft, ChevronRight, Copy, Crosshair, Eye, Flame, History, Loader2, Play, RefreshCw, Swords, Users } from "lucide-react";
import { fetchUserMatches, getGameReadContract, type UserMatch } from "../lib/contracts";
import { currentWinStreak, loadMatchResults } from "../lib/streakStorage";

interface Props {
  busy: string | null;
  waitingMatchId: number | null;
  address: string | null;
  onStartSolo: () => void;
  onCreatePvp: () => void;
  onJoinPvp: (matchId: number) => void;
  onResume: (matchId: number) => void;
  onEnterWaiting: () => void;
}

export default function Lobby({
  busy,
  waitingMatchId,
  address,
  onStartSolo,
  onCreatePvp,
  onJoinPvp,
  onResume,
  onEnterWaiting,
}: Props) {
  const [joinId, setJoinId] = useState("");
  const [resumeId, setResumeId] = useState("");
  const [copied, setCopied] = useState(false);
  const [showPvp, setShowPvp] = useState(false);
  const [myMatches, setMyMatches] = useState<UserMatch[] | null>(null);
  const [loadingMatches, setLoadingMatches] = useState(false);
  const [matchPage, setMatchPage] = useState(0);

  const isBusy = busy !== null;

  // Win streak from locally recorded Finished match results (Batch 3).
  // Recomputed on every render from localStorage: cheap (max 50 entries).
  const winStreak = address ? currentWinStreak(loadMatchResults(address)) : 0;

  async function loadMyMatches() {
    if (!address) return;
    setLoadingMatches(true);
    try {
      setMyMatches(await fetchUserMatches(getGameReadContract(), address));
    } catch {
      setMyMatches([]);
    } finally {
      setLoadingMatches(false);
    }
  }

  useEffect(() => {
    setMatchPage(0);
    if (address) void loadMyMatches();
    else setMyMatches(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address]);

  function statusLabel(m: UserMatch): string {
    if (m.info.state === 0) return "Waiting for opponent";
    if (m.info.state === 2) return "Finished";
    return `In progress: Round ${m.info.currentRound} of 3`;
  }

  const MATCHES_PER_PAGE = 4;
  const matchPageCount = myMatches
    ? Math.max(1, Math.ceil(myMatches.length / MATCHES_PER_PAGE))
    : 1;
  const safeMatchPage = Math.min(matchPage, matchPageCount - 1);
  const pageMatches = myMatches
    ? myMatches.slice(
        safeMatchPage * MATCHES_PER_PAGE,
        safeMatchPage * MATCHES_PER_PAGE + MATCHES_PER_PAGE,
      )
    : [];

  return (
    <div className="rise-in mx-auto w-full max-w-3xl px-4 py-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Rob the vaults. <span className="text-cyan-400">Your strategy stays yours.</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          Your crew allocations and vault secrets stay encrypted. A blind-allocation
          heist on Zama FHEVM: loot, alarm limits, and every bid are ciphertext
          onchain. A Scout reveals one stat privately to your wallet only; alarm
          status and scores become public when the round resolves, and transaction
          metadata remains visible onchain.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Crosshair className="mb-2 size-5 text-amber-400" />
            <p className="text-sm leading-snug text-slate-300">
              Deploy <strong className="font-mono text-slate-100">10 Agents</strong> across
              3 vaults with hidden Loot &amp; Alarm Limits.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Eye className="mb-2 size-5 text-cyan-400" />
            <p className="text-sm leading-snug text-slate-300">
              Spend 1 Agent to <strong className="text-slate-100">Scout</strong>, privately
              decrypt 1 stat via FHE ACL. Only your wallet can read it.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Bot className="mb-2 size-5 text-emerald-400" />
            <p className="text-sm leading-snug text-slate-300">
              Outbid your rival, but if the combined agents pass the Alarm Limit,{" "}
              <strong className="text-rose-400">everyone gets 0</strong>.
            </p>
          </div>
        </div>

        <button
          onClick={onStartSolo}
          disabled={isBusy}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3.5 text-base font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
        >
          {busy === "solo" ? <Loader2 className="size-5 animate-spin" /> : <Play className="size-5" />}
          Start Solo vs Syndicate AI
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Instant match, no second wallet needed. 3 rounds, about 2 minutes.
        </p>

        <div className="mt-6 border-t border-slate-800 pt-5">
          <button
            onClick={() => setShowPvp((v) => !v)}
            className="flex items-center gap-2 text-sm font-semibold text-slate-200 transition hover:text-cyan-300"
          >
            <Users className="size-4" /> PvP Mode {showPvp ? "▲" : "▼"}
          </button>

          {showPvp && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                  <Swords className="size-4 text-cyan-400" /> Create PvP Match
                </div>
                {waitingMatchId === null ? (
                  <button
                    onClick={onCreatePvp}
                    disabled={isBusy}
                    className="w-full rounded-lg bg-slate-800 py-2.5 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
                  >
                    {busy === "create" ? "Creating…" : "Create Match"}
                  </button>
                ) : (
                  <div>
                    <div className="flex items-center justify-between rounded-lg bg-slate-900 px-3 py-2">
                      <span className="font-mono text-sm">
                        Match ID: <strong className="text-cyan-300">{waitingMatchId}</strong>
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(String(waitingMatchId));
                          setCopied(true);
                          setTimeout(() => setCopied(false), 1500);
                        }}
                        className="flex items-center gap-1 text-xs text-slate-300 transition hover:text-cyan-300"
                      >
                        <Copy className="size-3.5" /> {copied ? "Copied!" : "Copy"}
                      </button>
                    </div>
                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      Share this ID with your opponent. Once they join, enter the arena:
                    </p>
                    <button
                      onClick={onEnterWaiting}
                      disabled={isBusy}
                      className="mt-2 w-full rounded-lg bg-cyan-400 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-60"
                    >
                      {busy === "enter" ? "Checking…" : "Enter Arena / Check Opponent"}
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <div className="mb-2 text-sm font-semibold">Join Match by ID</div>
                <div className="flex gap-2">
                  <input
                    value={joinId}
                    onChange={(e) => setJoinId(e.target.value.replace(/[^0-9]/g, ""))}
                    placeholder="e.g. 0"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400"
                  />
                  <button
                    onClick={() => joinId !== "" && onJoinPvp(Number(joinId))}
                    disabled={isBusy || joinId === ""}
                    className="shrink-0 rounded-lg bg-slate-800 px-4 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
                  >
                    {busy === "join" ? "Joining…" : "Join"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Joining sends one Sepolia transaction, then the match starts.
                </p>
              </div>
            </div>
          )}
        </div>

        {address && (
          <div className="mt-5 border-t border-slate-800 pt-5">
            <div className="mb-2 flex items-center gap-2">
              <History className="size-4 text-cyan-400" />
              <span className="text-sm font-semibold text-slate-300">Your Matches</span>
              {winStreak >= 2 && (
                <span className="flex items-center gap-1 rounded-full bg-orange-400/10 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-orange-300">
                  <Flame className="size-3" /> {winStreak}x Heist Streak
                </span>
              )}
              <button
                onClick={() => void loadMyMatches()}
                disabled={loadingMatches}
                className="ml-auto flex items-center gap-1 text-xs text-slate-400 transition hover:text-cyan-300 disabled:opacity-60"
              >
                <RefreshCw className={`size-3.5 ${loadingMatches ? "animate-spin" : ""}`} /> Refresh
              </button>
            </div>
            {loadingMatches && myMatches === null ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="size-4 animate-spin" /> Loading your matches from Sepolia…
              </p>
            ) : myMatches && myMatches.length > 0 ? (
              <>
              <div className="flex flex-col gap-2">
                {pageMatches.map((m) => (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                  >
                    <span className="font-mono text-sm font-bold">Operation #{m.id}</span>
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-mono text-[11px] font-semibold ${
                        m.info.vsBot
                          ? "bg-emerald-400/10 text-emerald-400"
                          : "bg-cyan-400/10 text-cyan-300"
                      }`}
                    >
                      {m.info.vsBot ? "SOLO vs BOT" : "PVP"}
                    </span>
                    <span
                      className={`font-mono text-xs ${
                        m.info.state === 2
                          ? "text-amber-300"
                          : m.info.state === 1
                            ? "text-slate-200"
                            : "text-slate-400"
                      }`}
                    >
                      {statusLabel(m)}
                    </span>
                    <button
                      onClick={() => onResume(m.id)}
                      disabled={isBusy}
                      className="ml-auto rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
                    >
                      {busy === "resume" ? "Loading…" : m.info.state === 2 ? "View Result" : "Resume"}
                    </button>
                  </div>
                ))}
              </div>
              {matchPageCount > 1 && (
                <div className="mt-3 flex items-center justify-between">
                  <button
                    onClick={() => setMatchPage(safeMatchPage - 1)}
                    disabled={safeMatchPage === 0}
                    className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-700 disabled:opacity-40"
                  >
                    <ChevronLeft className="size-3.5" /> Prev
                  </button>
                  <span className="font-mono text-xs text-slate-400">
                    Page {safeMatchPage + 1} of {matchPageCount}
                  </span>
                  <button
                    onClick={() => setMatchPage(safeMatchPage + 1)}
                    disabled={safeMatchPage >= matchPageCount - 1}
                    className="flex items-center gap-1 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-700 disabled:opacity-40"
                  >
                    Next <ChevronRight className="size-3.5" />
                  </button>
                </div>
              )}
              </>
            ) : (
              <p className="text-sm text-slate-500">No matches yet for this wallet.</p>
            )}
          </div>
        )}

        <div className="mt-5 border-t border-slate-800 pt-5">
          <div className="mb-2 text-sm font-semibold text-slate-300">Resume Match by ID</div>
          <div className="flex gap-2">
            <input
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value.replace(/[^0-9]/g, ""))}
              placeholder="Match ID you already play in"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm outline-none placeholder:text-slate-600 focus:border-cyan-400"
            />
            <button
              onClick={() => resumeId !== "" && onResume(Number(resumeId))}
              disabled={isBusy || resumeId === ""}
              className="shrink-0 rounded-lg bg-slate-800 px-4 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
            >
              {busy === "resume" ? "Loading…" : "Resume"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
