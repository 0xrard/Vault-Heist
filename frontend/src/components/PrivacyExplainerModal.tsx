import { Eye, KeyRound, Lock, Scale, X } from "lucide-react";

// "How Privacy Works": a layperson's explanation of FHE using the
// Sealed Envelope & Blind Referee analogy.
// No blockchain jargon — a lay player should understand it in 30 seconds.
interface Props {
  open: boolean;
  onClose: () => void;
}

const POINTS = [
  {
    icon: <Lock className="size-5 text-amber-400" />,
    title: "Your orders travel in a sealed envelope",
    body: "When you lock in your agents, your browser seals your numbers inside a locked envelope before anything leaves your device. Even the network only ever sees the envelope, never what's inside.",
  },
  {
    icon: <Scale className="size-5 text-cyan-400" />,
    title: "The referee never opens it",
    body: "A smart contract (the Zama FHE referee) acts as a blind referee: it can add up the sealed orders, compare them against the sealed alarm limits, and declare who won each vault, all without ever opening your envelope.",
  },
  {
    icon: <KeyRound className="size-5 text-emerald-400" />,
    title: "Only you hold a key to your intel",
    body: "When you Scout, the contract grants decryption access to your wallet only. A gas-free signature unlocks that one stat on your screen. It is never posted publicly for others to read.",
  },
  {
    icon: <Eye className="size-5 text-violet-300" />,
    title: "Only the results go public",
    body: "After each round, just the alarm outcomes and the scores are revealed, so both players can verify the result. Your allocations themselves stay sealed forever.",
  },
];

export default function PrivacyExplainerModal({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="rise-in w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[11px] font-bold tracking-widest text-cyan-400">
              NO TRUST REQUIRED
            </div>
            <h2 className="mt-1 text-2xl font-bold tracking-tight">How Privacy Works</h2>
            <p className="mt-1 text-sm text-slate-400">
              Think of it as a sealed envelope and a blind referee:
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close privacy explainer"
            className="rounded-lg bg-slate-800 p-1.5 text-slate-300 transition hover:bg-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-5 flex flex-col gap-3">
          {POINTS.map((p) => (
            <div
              key={p.title}
              className="flex gap-3.5 rounded-xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-slate-800/80">
                {p.icon}
              </span>
              <div className="leading-snug">
                <div className="text-sm font-bold text-slate-100">{p.title}</div>
                <p className="mt-0.5 text-sm leading-relaxed text-slate-400">{p.body}</p>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={onClose}
          className="mt-6 w-full rounded-xl bg-cyan-400 py-3 text-base font-bold text-slate-950 transition hover:bg-cyan-300"
        >
          Got It
        </button>
      </div>
    </div>
  );
}
