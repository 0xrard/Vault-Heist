import { useEffect, useState } from "react";
import VaultDoor from "./VaultDoor";
import { usePrefersReducedMotion } from "../lib/usePrefersReducedMotion";

// Cinematic reveal overlay (Batch 5 #2): momen utama resolusi ronde.
// MURNI presentasi di atas data yang SUDAH didekripsi collectResolution
// yang lama: tidak ada dekripsi/transaksi baru, tidak menyentuh sinkronisasi
// state, TxProgress, atau jalur recovery. Hanya dipicu jalur submit
// langsung di GameArena; kedatangan hasil via resume/polling/backfill
// tidak pernah memicunya (lihat hand-off di bawah).
//
// Hand-off lintas remount: App me-remount GameArena tiap ronde (key berisi
// currentRound), jadi state overlay di instance lama hilang tepat saat
// resolusi ronde 1-2 selesai dan instance ronde berikutnya masuk. Data
// reveal karena itu diserahkan lewat variabel modul sekali-konsumsi ini:
// instance baru mengambilnya saat mount. Refresh halaman membersihkan
// memori modul, jadi jalur resume tidak bisa memutar overlay. Jendela
// kesegaran 20 detik membuang serah-terima basi (mis. arena ditinggalkan
// lama sebelum instance berikutnya mount).

export interface CinematicRevealData {
  round: number;
  alarms: [boolean, boolean, boolean];
  deltaYou: number;
  deltaOpp: number;
  totalYou: number;
  totalOpp: number;
  oppLabel: string;
}

let pendingReveal: { matchId: number; at: number; data: CinematicRevealData } | null = null;

export function stashPendingReveal(matchId: number, data: CinematicRevealData): void {
  pendingReveal = { matchId, at: Date.now(), data };
}

export function consumePendingReveal(matchId: number): CinematicRevealData | null {
  if (!pendingReveal || pendingReveal.matchId !== matchId) return null;
  const { at, data } = pendingReveal;
  pendingReveal = null;
  return Date.now() - at <= 20000 ? data : null;
}

const STEP_MS = 950;

export default function CinematicReveal({
  data,
  onDone,
}: {
  data: CinematicRevealData;
  onDone: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [step, setStep] = useState(() => (reduced ? 3 : 0));
  const [doorOpen, setDoorOpen] = useState(false);

  // Urutan: vault A, B, C (satu per ~0,95 dtk), lalu kartu ringkasan,
  // lalu tutup otomatis. Total ~4 detik. Reduced motion: langsung
  // ringkasan, tutup lebih cepat, tanpa goyangan/flash (CSS juga mati).
  useEffect(() => {
    const timers: number[] = [];
    if (reduced) {
      timers.push(window.setTimeout(onDone, 2800));
    } else {
      for (let i = 1; i <= 3; i++) {
        timers.push(window.setTimeout(() => setStep(i), STEP_MS * i));
      }
      timers.push(window.setTimeout(onDone, STEP_MS * 3 + 1100));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [reduced, onDone]);

  // Pintu dibuka sesaat setelah vault fokus tampil agar transisi
  // geser/putar CSS terlihat (mount langsung terbuka = tanpa transisi).
  useEffect(() => {
    if (step >= 3) return;
    setDoorOpen(false);
    const t = window.setTimeout(() => setDoorOpen(true), 160);
    return () => window.clearTimeout(t);
  }, [step]);

  const vaultName = (i: number) => String.fromCharCode(65 + i);
  const fmtDelta = (d: number) => (d > 0 ? `+${d}` : `${d}`);
  const alarmNow = step < 3 && data.alarms[step];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/90 backdrop-blur-sm"
      onClick={onDone}
      role="presentation"
    >
      {step < 3 ? (
        <div
          key={step}
          className={`relative flex flex-col items-center px-4 ${alarmNow && !reduced ? "vault-shake" : ""}`}
        >
          {alarmNow && !reduced && (
            <div className="cine-flash pointer-events-none absolute -inset-12 rounded-full bg-rose-500/25" />
          )}
          <div className="font-mono text-sm font-bold tracking-[0.3em] text-slate-400">
            VAULT {vaultName(step)}
          </div>
          <VaultDoor
            variant={data.alarms[step] ? "alarm" : "safe"}
            open={doorOpen}
            className="mt-2 w-60 md:w-80"
          />
          {data.alarms[step] ? (
            <span className="alarm-stamp absolute top-1/2 left-1/2 z-10 rounded border-4 border-rose-500 bg-slate-950/80 px-4 py-1.5 font-mono text-2xl font-black tracking-widest whitespace-nowrap text-rose-500 md:text-3xl">
              ALARM TRIPPED
            </span>
          ) : (
            <div className="mt-3 font-mono text-lg font-bold tracking-[0.3em] text-emerald-300">
              SECURED
            </div>
          )}
          <div className="mt-6 flex gap-2">
            {data.alarms.map((a, i) => (
              <span
                key={i}
                className={`rounded-full px-3 py-1 font-mono text-xs font-bold ${
                  i < step
                    ? a
                      ? "bg-rose-500/20 text-rose-300"
                      : "bg-emerald-400/15 text-emerald-300"
                    : i === step
                      ? "bg-slate-100 text-slate-950"
                      : "bg-slate-800 text-slate-500"
                }`}
              >
                {vaultName(i)}
              </span>
            ))}
          </div>
          <p className="mt-4 text-xs text-slate-500">Tap anywhere to skip</p>
        </div>
      ) : (
        <div className="rise-in mx-4 w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center shadow-2xl">
          <div className="font-mono text-xs font-bold tracking-[0.3em] text-slate-400">
            ROUND {data.round} RESULTS
          </div>
          <div className="mt-4 flex items-start justify-center gap-10 font-mono">
            <div>
              <div className="text-3xl font-bold text-cyan-300">{fmtDelta(data.deltaYou)}</div>
              <div className="mt-1 text-[11px] tracking-widest text-slate-500">YOU THIS ROUND</div>
            </div>
            <div>
              <div className="text-3xl font-bold text-slate-200">{fmtDelta(data.deltaOpp)}</div>
              <div className="mt-1 text-[11px] tracking-widest text-slate-500">
                {data.oppLabel.toUpperCase()} THIS ROUND
              </div>
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-3 font-mono text-sm text-slate-300">
            You <span className="font-bold text-cyan-300">{data.totalYou}</span>
            <span className="mx-2 text-slate-600">vs</span>
            {data.oppLabel} <span className="font-bold text-slate-100">{data.totalOpp}</span>
          </div>
          <p className="mt-3 text-xs text-slate-500">Tap anywhere to continue</p>
        </div>
      )}
    </div>
  );
}
