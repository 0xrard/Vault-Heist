import { useEffect, useState } from "react";
import { AlarmClockCheck, AlarmClockOff } from "lucide-react";
import type { RoundRecord } from "../lib/contracts";
import VaultDoor from "./VaultDoor";
import { playChime, playSiren } from "../lib/sfx";

// Baris statis: dipakai untuk semua ronde lama dan jalur resume/backfill.
function StaticRow({ r }: { r: RoundRecord }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
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
                tripped ? "bg-rose-500/15 text-rose-400" : "bg-emerald-400/10 text-emerald-400"
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
          <span className="text-slate-500">cumulative score …</span>
        ) : (
          <>
            You <strong className="text-slate-50">{r.scoreYou}</strong> · Opp{" "}
            <strong className="text-slate-50">{r.scoreOpp}</strong>
          </>
        )}
      </span>
    </div>
  );
}

// Kunci sesi untuk ronde yang urutan reveal-nya sudah pernah diputar, agar
// remount (navigasi bolak-balik, backfill) tidak mengulang animasi.
const animatedKeys = new Set<string>();

function recordKey(r: RoundRecord): string {
  return `${r.matchId}|${r.round}|${r.alarms.join(",")}|${r.scoreYou}|${r.scoreOpp}`;
}

function RevealTile({
  idx,
  tripped,
  revealed,
}: {
  idx: number;
  tripped: boolean;
  revealed: boolean;
}) {
  const name = String.fromCharCode(65 + idx);
  return (
    <div
      className={`relative flex flex-col items-center gap-1 rounded-lg border px-2.5 py-2 ${
        !revealed
          ? "border-slate-800 bg-slate-950/60"
          : tripped
            ? "border-rose-500/40 bg-rose-500/10"
            : "border-emerald-400/30 bg-emerald-400/5"
      } ${revealed && tripped ? "vault-shake" : ""}`}
    >
      <VaultDoor
        variant={!revealed ? "sealed" : tripped ? "alarm" : "safe"}
        open={revealed}
        className="w-14"
      />
      <span
        className={`flex items-center gap-1 font-mono text-[10px] font-semibold ${
          !revealed ? "text-slate-500" : tripped ? "text-rose-400" : "text-emerald-400"
        }`}
      >
        {revealed &&
          (tripped ? <AlarmClockOff className="size-3" /> : <AlarmClockCheck className="size-3" />)}
        {name} {!revealed ? "SEALED" : tripped ? "ALARM" : "SAFE"}
      </span>
      {revealed && tripped && (
        <span className="alarm-stamp absolute top-1/2 left-1/2 z-10 rounded border-2 border-rose-500 bg-slate-950/80 px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-widest whitespace-nowrap text-rose-500">
          ALARM TRIPPED
        </span>
      )}
    </div>
  );
}

// Dramatic reveal (Batch 2 #4): MURNI urutan tampilan dari RoundRecord yang
// sudah terdekripsi utuh oleh collectResolution(). Tidak ada dekripsi ulang
// per brankas, tidak ada transaksi baru. Vault A, B, C terbuka satu per satu
// (jeda 0,7 detik), lalu skor terbang masuk. Bila urutan ini sudah pernah
// diputar untuk record yang sama, baris langsung tampil final.
function RevealRow({ r }: { r: RoundRecord }) {
  const key = recordKey(r);
  const [step, setStep] = useState(() => (animatedKeys.has(key) ? 4 : 0));

  useEffect(() => {
    if (animatedKeys.has(key)) {
      setStep(4);
      return;
    }
    animatedKeys.add(key);
    const timers: number[] = [];
    [600, 1300, 2000].forEach((t, i) => {
      timers.push(
        window.setTimeout(() => {
          setStep(i + 1);
          if (r.alarms[i]) playSiren();
          else playChime();
        }, t)
      );
    });
    timers.push(window.setTimeout(() => setStep(4), 2450));
    return () => timers.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
      <span className="font-mono text-sm font-bold">Round {r.round}</span>
      <div className="flex gap-2">
        {r.alarms.map((tripped, i) => (
          <RevealTile key={i} idx={i} tripped={tripped} revealed={step > i} />
        ))}
      </div>
      <span className="ml-auto font-mono text-sm text-slate-300">
        {step < 4 ? (
          <span className="text-slate-500">OPENING VAULTS…</span>
        ) : r.scoreYou < 0 ? (
          <span className="text-slate-500">cumulative score …</span>
        ) : (
          <span className="score-fly inline-block">
            You <strong className="text-slate-50">{r.scoreYou}</strong> · Opp{" "}
            <strong className="text-slate-50">{r.scoreOpp}</strong>
          </span>
        )}
      </span>
    </div>
  );
}

export default function RoundHistory({ history }: { history: RoundRecord[] }) {
  if (history.length === 0) return null;
  const latestRound = Math.max(...history.map((r) => r.round));
  return (
    <div className="mt-6 rounded-2xl border border-slate-800 bg-slate-900/90 p-5">
      <h3 className="mb-3 font-mono text-sm font-bold tracking-widest text-slate-300">
        ROUND HISTORY
      </h3>
      <div className="flex flex-col gap-3">
        {history.map((r) =>
          r.round === latestRound && r.alarmsKnown !== false ? (
            <RevealRow key={r.round} r={r} />
          ) : (
            <StaticRow key={r.round} r={r} />
          )
        )}
      </div>
    </div>
  );
}
