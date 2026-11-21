import { CheckCircle2, Loader2 } from "lucide-react";

// Indikator progres 4 tahap untuk aliran LOCK IN & START HEIST.
// Setiap tahap digerakkan oleh state async ASLI di GameArena.handleSubmit
// (enkripsi FHE -> tanda tangan MetaMask -> tx.wait() -> ambil hasil +
// publicDecrypt). Tidak ada timer palsu: tahap hanya maju saat langkah
// sebelumnya benar-benar selesai, dan berhenti total saat error/penolakan.
const STAGES = [
  { name: "Sealing Your Orders", sub: "Encrypting your crew allocation privately." },
  { name: "Confirm in Wallet", sub: "Waiting for your transaction approval." },
  { name: "Vault Security Evaluating", sub: "Encrypted orders are being processed." },
  { name: "Opening the Vault", sub: "Preparing the round results." },
] as const;

export default function TxProgress({ stage }: { stage: number }) {
  // stage: 1..4 = tahap yang sedang aktif; tahap sebelumnya tampil selesai.
  return (
    <div className="mt-5 rounded-xl border border-cyan-400/30 bg-slate-900 px-4 py-3.5">
      <div className="flex flex-col gap-3">
        {STAGES.map((s, i) => {
          const n = i + 1;
          const state = n < stage ? "done" : n === stage ? "active" : "todo";
          return (
            <div key={s.name} className="flex items-center gap-3">
              {state === "done" ? (
                <CheckCircle2 className="size-5 shrink-0 text-emerald-400" />
              ) : state === "active" ? (
                <Loader2 className="size-5 shrink-0 animate-spin text-cyan-300" />
              ) : (
                <span className="grid size-5 shrink-0 place-items-center rounded-full border border-slate-700 font-mono text-[10px] text-slate-500">
                  {n}
                </span>
              )}
              <div className="leading-tight">
                <div
                  className={`text-sm font-semibold ${
                    state === "todo" ? "text-slate-500" : "text-slate-100"
                  }`}
                >
                  {s.name}
                </div>
                <div className={`text-xs ${state === "todo" ? "text-slate-600" : "text-slate-400"}`}>
                  {s.sub}
                </div>
              </div>
              {state === "active" && (
                <span className="ml-auto font-mono text-[10px] font-bold tracking-widest text-cyan-300">
                  IN PROGRESS
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
