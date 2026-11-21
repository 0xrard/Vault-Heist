import { Eye, Lock, Play, Swords, X } from "lucide-react";

// Mission Briefing: onboarding 3 kartu untuk pengunjung pertama kali.
// Ditampilkan sekali (dismissal disimpan di localStorage oleh App) dan bisa
// dibuka lagi kapan saja lewat tombol "Briefing" di navbar.
interface Props {
  open: boolean;
  onClose: () => void;
}

const CARDS = [
  {
    icon: <Lock className="size-5 text-amber-400" />,
    title: "Hidden Vaults",
    body: "3 vaults with secret Loot (30–93) and secret Alarm Limits (6–13), generated and encrypted onchain. Nobody (not even your rival) can see them.",
  },
  {
    icon: <Eye className="size-5 text-cyan-400" />,
    title: "Private Intel (Scout)",
    body: "Spend 1 Agent to privately decrypt one vault stat. The result is revealed only on your screen, visible to your wallet alone.",
  },
  {
    icon: <Swords className="size-5 text-emerald-400" />,
    title: "Beat the Rival, Dodge the Alarm",
    body: "The highest crew wins each vault, unless the combined crew exceeds its hidden Alarm Limit. Trip the alarm, and both crews get 0.",
  },
];

export default function MissionBriefingModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="rise-in w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] font-bold tracking-widest text-amber-400">
              CLASSIFIED: EYES ONLY
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">Mission Briefing</h2>
            <p className="mt-1 text-sm text-slate-400">
              Three rounds. Three vaults. One rival crew. Here is how the heist works:
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close briefing"
            className="rounded-lg bg-slate-800 p-1.5 text-slate-300 transition hover:bg-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {CARDS.map((c, i) => (
            <div
              key={c.title}
              className="flex gap-3.5 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-800/80">
                {c.icon}
              </span>
              <div className="leading-snug">
                <div className="text-sm font-bold text-slate-100">
                  <span className="mr-1.5 font-mono text-xs text-slate-500">{i + 1}.</span>
                  {c.title}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{c.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3 text-base font-bold text-slate-950 transition hover:bg-amber-300"
        >
          <Play className="size-5" /> Start the Heist
        </button>
        <p className="mt-2.5 text-center text-xs text-slate-500">
          You can reopen this briefing anytime from the Briefing button in the top bar.
        </p>
      </div>
    </div>
  );
}
