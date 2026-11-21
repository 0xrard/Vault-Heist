import { useEffect, useRef, useState } from "react";
import { AlarmClock, Coins, Eye, Lock, Minus, Plus, User } from "lucide-react";
import VaultDoor from "./VaultDoor";
import { playTick } from "../lib/sfx";

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
  outcome?: "safe" | "alarm" | null; // hasil ronde ini bila sudah diketahui (pintu terbuka)
  scoutAnimate?: boolean; // true hanya untuk reveal Scout segar, bukan hasil restore cache/F5
  onBidChange: (idx: number, value: number) => void;
  onScout: (idx: number, kind: "loot" | "alarm") => void;
}

function truncateHandle(h: string | null): string {
  if (!h) return "0x••••••••";
  return `${h.slice(0, 6)}…${h.slice(-4)}`;
}

// Cipher scramble (Batch 2 #3): murni animasi tampilan selama 0,8 detik,
// lalu terkunci ke nilai asli. Hanya berjalan bila `animate` true (reveal
// Scout segar); nilai dari cache/restore (mis. setelah F5) langsung tampil.
function ScrambleValue({ value, animate }: { value: number; animate: boolean }) {
  const [scrambled, setScrambled] = useState<string | null>(() =>
    animate ? "•".repeat(String(value).length) : null
  );

  useEffect(() => {
    if (!animate) {
      setScrambled(null);
      return;
    }
    const chars = "0123456789ABCDEF#%";
    const len = String(value).length;
    const start = performance.now();
    setScrambled("•".repeat(len));
    const iv = window.setInterval(() => {
      if (performance.now() - start >= 800) {
        window.clearInterval(iv);
        setScrambled(null);
      } else {
        setScrambled(
          Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
        );
      }
    }, 45);
    return () => window.clearInterval(iv);
  }, [animate, value]);

  if (scrambled === null) return <>{value}</>;
  return (
    <span className="relative inline-block overflow-hidden">
      <span className="text-cyan-200/80">{scrambled}</span>
      <span className="scanline" />
    </span>
  );
}

function StatRow({
  icon,
  label,
  range,
  handle,
  revealed,
  animateReveal = false,
}: {
  icon: React.ReactNode;
  label: string;
  range: string;
  handle: string | null;
  revealed: number | null;
  animateReveal?: boolean;
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
        <span className="font-mono text-lg font-bold text-cyan-300">
          <ScrambleValue value={revealed} animate={animateReveal} />
        </span>
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
  outcome = null,
  scoutAnimate = false,
  onBidChange,
  onScout,
}: Props) {
  const name = String.fromCharCode(65 + idx);
  const lootRevealed = scouted?.kind === "loot" ? scouted.value : null;
  const alarmRevealed = scouted?.kind === "alarm" ? scouted.value : null;

  // Animasi pop hanya untuk ikon agen yang BARU ditambahkan (Batch 2 #2).
  const prevBid = useRef(bid);
  const [popNonce, setPopNonce] = useState(0);
  useEffect(() => {
    if (bid > prevBid.current) setPopNonce((n) => n + 1);
    prevBid.current = bid;
  }, [bid]);

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/90 p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-base font-bold tracking-widest">VAULT {name}</h3>
        <span className="rounded-full border border-slate-700 px-2 py-0.5 font-mono text-[10px] tracking-wide text-slate-400">
          FHE ENCRYPTED
        </span>
      </div>

      {/* Pintu brankas: tersegel selama alokasi; terbuka bila hasil ronde diketahui */}
      <div
        className={`flex justify-center rounded-xl py-1 ${
          outcome === "alarm" ? "alarm-pulse" : outcome === "safe" ? "decrypted-glow" : ""
        }`}
      >
        <VaultDoor variant={outcome ?? "sealed"} open={outcome !== null} className="w-32" />
      </div>

      <StatRow
        icon={<Coins className="size-4 text-amber-400" />}
        label="Loot"
        range="30–93"
        handle={lootHandle}
        revealed={lootRevealed}
        animateReveal={scoutAnimate}
      />
      <StatRow
        icon={<AlarmClock className="size-4 text-rose-400" />}
        label="Alarm Limit"
        range="6–13"
        handle={alarmHandle}
        revealed={alarmRevealed}
        animateReveal={scoutAnimate}
      />

      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => onScout(idx, "loot")}
          disabled={busy || locked || scoutUsed}
          className="flex items-center justify-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye className="size-3.5" /> Scout Loot (-1 Agent)
        </button>
        <button
          onClick={() => onScout(idx, "alarm")}
          disabled={busy || locked || scoutUsed}
          className="flex items-center justify-center gap-1 rounded-lg border border-cyan-400/40 bg-cyan-400/10 px-2 py-2 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Eye className="size-3.5" /> Scout Alarm (-1 Agent)
        </button>
      </div>

      <div className="mt-auto border-t border-slate-800 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium tracking-wide text-slate-400">AGENTS ASSIGNED</span>
          <span className="font-mono text-2xl font-bold text-slate-50">{bid}</span>
        </div>
        {/* Ikon agen kru yang sudah masuk ke brankas ini (Batch 2 #2) */}
        <div className="mb-2 flex min-h-5 flex-wrap items-center gap-1" aria-hidden>
          {bid === 0 ? (
            <span className="text-[11px] text-slate-600">No agents assigned</span>
          ) : (
            Array.from({ length: bid }).map((_, i) => {
              const isNewest = i === bid - 1 && popNonce > 0;
              return (
                <span
                  key={isNewest ? `newest-${popNonce}` : i}
                  className={`inline-flex ${isNewest ? "agent-pop text-amber-300" : "text-amber-400/70"}`}
                >
                  <User className="size-4" />
                </span>
              );
            })
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              playTick(false);
              onBidChange(idx, Math.max(0, bid - 1));
            }}
            disabled={busy || locked || bid <= 0}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 disabled:opacity-40"
            aria-label="Remove one agent"
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
            onClick={() => {
              playTick(true);
              onBidChange(idx, Math.min(maxBid, bid + 1));
            }}
            disabled={busy || locked || bid >= maxBid}
            className="grid size-8 shrink-0 place-items-center rounded-lg bg-slate-800 transition hover:bg-slate-700 disabled:opacity-40"
            aria-label="Add one agent"
          >
            <Plus className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
