import { AlarmClockCheck, AlarmClockOff } from "lucide-react";
import type { RoundRecord } from "../lib/contracts";

export default function RoundHistory({ history }: { history: RoundRecord[] }) {
  if (history.length === 0) return null;
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
      <h3 className="mb-3 font-mono text-sm font-bold tracking-widest text-slate-300">
        ROUND HISTORY
      </h3>
      <div className="flex flex-col gap-3">
        {history.map((r) => (
          <div
            key={r.round}
            className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
          >
            <span className="font-mono text-sm font-bold">Round {r.round}</span>
            <div className="flex gap-2">
              {r.alarmsKnown === false ? (
                <span className="flex items-center gap-1 rounded-full bg-slate-500/15 px-2.5 py-1 font-mono text-[11px] font-semibold text-slate-400">
                  ALARM STATUS SYNCING…
                </span>
              ) : (
                r.alarms.map((tripped, i) => (
                <span
                  key={i}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[11px] font-semibold ${
                    tripped
                      ? "bg-rose-500/15 text-rose-400"
                      : "bg-emerald-400/10 text-emerald-400"
                  }`}
                >
                  {tripped ? <AlarmClockOff className="size-3.5" /> : <AlarmClockCheck className="size-3.5" />}
                  {String.fromCharCode(65 + i)} {tripped ? "ALARM" : "SAFE"}
                </span>
                ))
              )}
            </div>
            <span className="ml-auto font-mono text-sm text-slate-300">
              {r.scoreYou < 0 ? (
                <span className="text-slate-500">cumulative score —</span>
              ) : (
                <>
                  You <strong className="text-slate-50">{r.scoreYou}</strong> · Opp{" "}
                  <strong className="text-slate-50">{r.scoreOpp}</strong>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
