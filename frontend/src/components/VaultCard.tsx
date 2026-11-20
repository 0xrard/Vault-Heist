import { AlarmClock, Coins, Eye, Lock, Minus, Plus } from "lucide-react";

export interface ScoutedStat {
  vaultIdx: number;
  kind: "loot" | "alarm";
  value: number;
}

interface Props {
  idx: number;
  bid: number;
  maxBid: number;
  lootHandle: string | null;
  alarmHandle: string | null;
  scouted: ScoutedStat | null; // stat yang sudah di-scout di brankas ini (jika ada)
  scoutUsed: boolean; // scout sudah dipakai di ronde ini (di brankas mana pun)
  busy: boolean;
  locked: boolean; // sudah commit / ronde selesai
  onBidChange: (idx: number, value: number) => void;
  onScout: (idx: number, kind: "loot" | "alarm") => void;
}

function truncateHandle(h: string | null): string {
  if (!h) return "0x••••••••";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

function StatRow({
  icon,
  label,
  range,
  handle,
  revealed,
}: {
  icon: React.ReactNode;
  label: string;
  range: string;
  handle: string | null;
  revealed: number | null;
}) {
  if (revealed !== null) {
    return (
      <div className="decrypted-glow flex items-center justify-between rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-cyan-200">
          {icon} {label}
          <span className="rounded bg-cyan-400 px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-slate-950">
            PRIVATE • ONLY YOU
          </span>
        </span>
        <span className="font-mono text-lg font-bold text-cyan-300">{revealed}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2">
      <span className="flex items-center gap-1.5 text-xs font-medium text-slate-400">
        {icon} {label} <span className="font-mono text-[10px] text-slate-600">{range}</span>
      </span>
      <span className="flex items-center gap-1.5 font-mono text-xs text-slate-500">
        <Lock className="size-3.5" /> {truncateHandle(handle)}
      </span>
    </div>
  );
}

export default function VaultCard({
  idx,
  bid,
  maxBid,
  lootHandle,
  alarmHandle,
  scouted,
  scoutUsed,
  busy,
  locked,
  onBidChange,
  onScout,
}: Props) {
  const name = String.fromCharCode(65 + idx);
  const lootRevealed = scouted?.kind === "loot" ? scouted.value : null;
  const alarmRevealed = scouted?.kind === "alarm" ? scouted.value : null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-base font-bold tracking-widest">VAULT {name}</h3>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[10px] tracking-wide text-slate-400">
          FHE ENCRYPTED
        </span>
      </div>

      <StatRow
        icon={<Coins className="size-4 text-amber-400" />}
        label="Loot"
        range="30–93"
        handle={lootHandle}
        revealed={lootRevealed}
      />
      <StatRow
        icon={<AlarmClock className="size-4 text-rose-400" />}
        label="Alarm Limit"
        range="6–13"
        handle={alarmHandle}
        revealed={alarmRevealed}
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onScout(idx, "loot")}
          disabled={busy || locked || scoutUsed}
          className="flex items-center justify-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye className="size-3.5" /> Scout Loot (-1)
        </button>
        <button
          onClick={() => onScout(idx, "alarm")}
          disabled={busy || locked || scoutUsed}
          className="flex items-center justify-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye className="size-3.5" /> Scout Alarm (-1)
        </button>
      </div>

      <div className="mt-auto border-t border-slate-800 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium tracking-wide text-slate-400">CREW ALLOCATED</span>
          <span className="font-mono text-2xl font-bold text-slate-50">{bid}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onBidChange(idx, Math.max(0, bid - 1))}
            disabled={busy || locked || bid <= 0}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 disabled:opacity-40"
            aria-label="Kurangi kru"
          >
            <Minus className="size-4" />
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(maxBid, bid)}
            value={bid}
            disabled={busy || locked}
            onChange={(e) => onBidChange(idx, Number(e.target.value))}
            className="w-full accent-amber-400"
          />
          <button
            onClick={() => onBidChange(idx, Math.min(maxBid, bid + 1))}
            disabled={busy || locked || bid >= maxBid}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 disabled:opacity-40"
            aria-label="Tambah kru"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
