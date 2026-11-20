import { useState } from "react";
import { Bot, Copy, Crosshair, Eye, Loader2, Play, Swords, Users } from "lucide-react";

interface Props {
  busy: string | null;
  waitingMatchId: number | null;
  onStartSolo: () => void;
  onCreatePvp: () => void;
  onJoinPvp: (matchId: number) => void;
  onResume: (matchId: number) => void;
  onEnterWaiting: () => void;
}

export default function Lobby({
  busy,
  waitingMatchId,
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

  const isBusy = busy !== null;

  return (
    <div className="rise-in mx-auto w-full max-w-3xl px-4 py-8">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl">
        <h1 className="text-2xl font-bold tracking-tight">
          Rob the vaults. <span className="text-cyan-400">Nobody sees your moves.</span>
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-400">
          A blind-allocation heist on Zama FHEVM: vault loot, alarm limits, and every crew
          allocation stay encrypted onchain. Only round results are ever revealed.
        </p>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Crosshair className="mb-2 size-5 text-amber-400" />
            <p className="text-sm leading-snug text-slate-300">
              Allocate <strong className="font-mono text-slate-100">10 Crew Points</strong> across
              3 vaults with hidden Loot &amp; Alarm Limits.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Eye className="mb-2 size-5 text-cyan-400" />
            <p className="text-sm leading-snug text-slate-300">
              Spend 1 Crew Point to <strong className="text-slate-100">Scout</strong> — privately
              decrypt 1 stat via FHE ACL. Only your wallet can read it.
            </p>
          </div>
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5">
            <Bot className="mb-2 size-5 text-emerald-400" />
            <p className="text-sm leading-snug text-slate-300">
              Outbid your rival — but if the combined crew passes the Alarm Limit,{" "}
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
          Start Solo vs. Onchain Bot
        </button>
        <p className="mt-2 text-center text-xs text-slate-500">
          Instant match — no second wallet needed. 3 rounds, about 2 minutes.
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
