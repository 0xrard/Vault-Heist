import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Eye, Loader2, Lock, RefreshCw, Send } from "lucide-react";
import type { Signer } from "ethers";
import VaultCard, { type ScoutedStat } from "./VaultCard";
import { encryptBids, friendlyError, publicDecryptHandles, userDecryptHandle } from "../lib/fhe";
import { CONTRACT_ADDRESS, fetchMatch, getGameContract, getGameReadContract, type MatchInfo, type RoundRecord } from "../lib/contracts";

interface Props {
  signer: Signer;
  matchId: number;
  matchInfo: MatchInfo;
  myPlayer: 1 | 2;
  scores: { you: number; opp: number };
  onRoundResolved: (record: RoundRecord, updated: MatchInfo, scores: { you: number; opp: number }) => void;
  onError: (msg: string) => void;
  onResync: () => void;
}

const BASE_BUDGET = 10;

export default function GameArena({
  signer,
  matchId,
  matchInfo,
  myPlayer,
  scores,
  onRoundResolved,
  onError,
  onResync,
}: Props) {
  const round = matchInfo.currentRound;
  const [bids, setBids] = useState<[number, number, number]>([4, 3, 3]);
  const [scouted, setScouted] = useState<ScoutedStat | null>(null);
  const [pendingScout, setPendingScout] = useState<{ vaultIdx: number; kind: "loot" | "alarm" } | null>(null);
  const [handles, setHandles] = useState<{ loot: string; alarm: string }[] | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitingOpp, setWaitingOpp] = useState(false);

  const contract = useMemo(() => getGameContract(signer), [signer]);
  const readContract = useMemo(() => getGameReadContract(), []);

  // Status Scout dipulihkan dari localStorage: transaksi Scout bisa berhasil
  // onchain sementara dekripsinya gagal (relayer lambat) — tanpa ini, UI tidak
  // tahu Scout sudah terpakai dan budget-nya tidak sinkron dengan kontrak.
  const storageKey = `vh-scout-${matchId}-${round}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved.scouted) setScouted(saved.scouted);
        else if (saved.pendingScout) setPendingScout(saved.pendingScout);
      }
    } catch {
      /* abaikan */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => {
    try {
      if (scouted) localStorage.setItem(storageKey, JSON.stringify({ scouted }));
      else if (pendingScout) localStorage.setItem(storageKey, JSON.stringify({ pendingScout }));
    } catch {
      /* abaikan */
    }
  }, [storageKey, scouted, pendingScout]);

  const scoutUsed = scouted !== null || pendingScout !== null;
  const maxBudget = scoutUsed ? BASE_BUDGET - 1 : BASE_BUDGET;
  const total = bids[0] + bids[1] + bids[2];
  const overBudget = total > maxBudget;
  const finished = matchInfo.state === 2;
  const oppLabel = matchInfo.vsBot ? "Onchain Bot" : "Player 2";

  // Ambil handle ciphertext brankas ronde ini (hanya untuk pratinjau terpotong di UI)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows: { loot: string; alarm: string }[] = [];
        for (let i = 0; i < 3; i++) {
          const [loot, alarm] = await readContract.getVaultHandles(matchId, round, i);
          rows.push({ loot, alarm });
        }
        if (!cancelled) setHandles(rows);
      } catch {
        /* pratinjau handle bersifat opsional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readContract, matchId, round]);

  const phase = waitingOpp || busy ? 3 : scoutUsed || total !== 10 ? 2 : 1;

  function setBid(idx: number, value: number) {
    setBids((prev) => {
      const next: [number, number, number] = [...prev];
      next[idx] = value;
      return next;
    });
  }

  // Dekripsi hasil Scout yang transaksinya SUDAH tercatat onchain.
  // Dipisah dari handleScout agar bisa di-retry tanpa transaksi baru.
  async function decryptPending(p: { vaultIdx: number; kind: "loot" | "alarm" }) {
    setStep("Sign the EIP-712 request to privately decrypt this stat…");
    const [lootHandle, alarmHandle] = await readContract.getVaultHandles(matchId, round, p.vaultIdx);
    const value = await userDecryptHandle(
      p.kind === "alarm" ? alarmHandle : lootHandle,
      CONTRACT_ADDRESS,
      signer
    );
    setScouted({ vaultIdx: p.vaultIdx, kind: p.kind, value: Number(value) });
    setPendingScout(null);
  }

  // Kontrak menolak karena status match di onchain sudah berubah (mis. sudah
  // Finished) sementara UI masih memegang tampilan lama: sinkronkan ulang dari
  // chain alih-alih menampilkan error yang membingungkan.
  function isStaleStateError(err: any): boolean {
    const msg = String(err?.reason ?? err?.message ?? err ?? "");
    return /Match tidak aktif|Match sudah dimulai|Match penuh/.test(msg);
  }

  async function handleScout(idx: number, kind: "loot" | "alarm") {
    setBusy(true);
    try {
      setStep("Sending Scout transaction — granting ACL only to your wallet…");
      const tx = await contract.scoutVault(matchId, idx, kind === "alarm");
      await tx.wait();
      // Sejak transaksi ini tercatat, budget onchain = 9. Tandai SEKARANG,
      // sebelum dekripsi dicoba, agar UI tidak pernah desync dari kontrak.
      const p = { vaultIdx: idx, kind };
      setPendingScout(p);
      await decryptPending(p);
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  async function handleRetryDecrypt() {
    if (!pendingScout) return;
    setBusy(true);
    try {
      await decryptPending(pendingScout);
    } catch (err: any) {
      onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  // Setelah commit: baca ulang match; bila ronde sudah beres, dekripsi publik hasilnya
  const collectResolution = useCallback(
    async (playedRound: number): Promise<boolean> => {
      const updated = await fetchMatch(readContract, matchId);
      const resolved = updated.currentRound !== playedRound || updated.state === 2;
      if (!resolved) return false;

      setStep("Decrypting public round results (alarms & scores)…");
      const alarmHandles: string[] = [];
      for (let i = 0; i < 3; i++) {
        const [, , alarmTripped] = await readContract.getVaultHandles(matchId, playedRound, i);
        alarmHandles.push(alarmTripped);
      }
      const clear = await publicDecryptHandles([
        ...alarmHandles,
        updated.score1Handle,
        updated.score2Handle,
      ]);
      const alarms = alarmHandles.map((h) => Boolean(clear[h])) as [boolean, boolean, boolean];
      const s1 = Number(clear[updated.score1Handle] as any);
      const s2 = Number(clear[updated.score2Handle] as any);
      const mapped = myPlayer === 1 ? { you: s1, opp: s2 } : { you: s2, opp: s1 };
      onRoundResolved({ round: playedRound, alarms, scoreYou: mapped.you, scoreOpp: mapped.opp }, updated, mapped);
      return true;
    },
    [contract, matchId, myPlayer, onRoundResolved]
  );

  async function handleSubmit() {
    setBusy(true);
    try {
      const userAddress = await signer.getAddress();
      setStep("Encrypting your crew allocation in browser (FHE WASM)…");
      const { handles: encHandles, inputProof } = await encryptBids(CONTRACT_ADDRESS, userAddress, bids);

      setStep("Please confirm the transaction in MetaMask…");
      const tx = await contract.submitAllocation(matchId, encHandles, inputProof);
      setStep("Waiting for Sepolia confirmation & homomorphic resolution…");
      await tx.wait();

      let done = false;
      try {
        done = await collectResolution(round);
      } catch {
        // Transaksi commit SUDAH tercatat onchain; yang gagal hanya mengambil
        // hasilnya dari relayer. Jangan tinggalkan arena mati: tampilkan panel
        // pemulihan agar hasil bisa diambil ulang tanpa transaksi baru.
        done = false;
      }
      if (!done) {
        setWaitingOpp(true);
        setStep(null);
      }
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
      setStep(null);
    } finally {
      setBusy(false);
    }
  }

  async function handleRefresh() {
    setBusy(true);
    try {
      const done = await collectResolution(round);
      if (!done) onError("Round results are not available yet. Try again in a moment.");
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
    } finally {
      setBusy(false);
      setStep(null);
    }
  }

  const steps = ["1. Scout (Optional)", "2. Allocate Crew", "3. Resolve Round"];

  return (
    <div className="rise-in mx-auto w-full max-w-6xl px-4 py-6">
      {/* Indikator fase */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {steps.map((label, i) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1.5 font-mono text-xs font-semibold ${
                phase === i + 1
                  ? "bg-cyan-400 text-slate-950"
                  : phase > i + 1
                    ? "bg-emerald-400/15 text-emerald-400"
                    : "bg-slate-800 text-slate-400"
              }`}
            >
              {label}
            </span>
            {i < 2 && <span className="text-slate-600">→</span>}
          </div>
        ))}
        <span className="ml-auto font-mono text-xs text-slate-500">Match #{matchId}</span>
      </div>

      {/* HUD */}
      <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-slate-800 bg-slate-900/90 px-5 py-4">
        <div>
          <div className="text-[11px] tracking-widest text-slate-500">ROUND</div>
          <div className="font-mono text-xl font-bold">
            {Math.min(round, 3)} <span className="text-slate-500">/ 3</span>
          </div>
        </div>
        <div className="h-9 w-px bg-slate-800" />
        <div>
          <div className="text-[11px] tracking-widest text-slate-500">SCOREBOARD</div>
          <div className="font-mono text-xl font-bold">
            You <span className="text-cyan-300">{scores.you}</span>
            <span className="mx-2 text-slate-600">vs</span>
            {oppLabel} <span className="text-slate-100">{scores.opp}</span>
          </div>
        </div>
        <div className="ml-auto min-w-56">
          <div className="mb-1.5 flex items-center justify-between text-[11px] tracking-widest text-slate-500">
            <span>CREW BUDGET</span>
            <span className={`font-mono text-xs font-bold ${overBudget ? "text-rose-400" : "text-slate-300"}`}>
              {total} / {maxBudget}
              {scoutUsed ? " (Scout used)" : ""}
            </span>
          </div>
          <div className="flex gap-1">
            {Array.from({ length: BASE_BUDGET }).map((_, i) => (
              <span
                key={i}
                className={`h-2.5 flex-1 rounded-full ${
                  i < total
                    ? overBudget
                      ? "bg-rose-500"
                      : "bg-amber-400"
                    : i < maxBudget
                      ? "bg-slate-700"
                      : "bg-slate-800 opacity-40"
                }`}
              />
            ))}
          </div>
          {overBudget && (
            <p className="mt-1.5 text-xs text-rose-400">
              Total exceeds this round's budget ({maxBudget}). Reduce your allocation first.
            </p>
          )}
          {total === 0 && !finished && (
            <p className="mt-1.5 text-xs text-slate-500">Allocate at least 1 crew to commit.</p>
          )}
        </div>
      </div>

      {/* Kartu brankas */}
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((idx) => {
          const others = total - bids[idx];
          return (
            <VaultCard
              key={`${matchId}-${round}-${idx}`}
              idx={idx}
              bid={bids[idx]}
              maxBid={maxBudget - others}
              lootHandle={handles?.[idx]?.loot ?? null}
              alarmHandle={handles?.[idx]?.alarm ?? null}
              scouted={scouted?.vaultIdx === idx ? scouted : null}
              scoutUsed={scoutUsed}
              busy={busy}
              locked={waitingOpp || finished}
              onBidChange={setBid}
              onScout={handleScout}
            />
          );
        })}
      </div>

      {/* Scout tercatat onchain tapi dekripsi belum berhasil -> tawarkan retry gratis */}
      {pendingScout && !scouted && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <Eye className="size-4 shrink-0" />
          <span>
            Your Scout is recorded onchain (this round's budget is now {maxBudget}), but the
            private decryption hasn't succeeded yet — the relayer is usually just slow.
          </span>
          <button
            onClick={handleRetryDecrypt}
            disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
          >
            <RefreshCw className="size-4" /> Retry Decryption (no new transaction)
          </button>
        </div>
      )}

      {/* Banner langkah / status */}
      {step && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span className="font-mono">{step}</span>
        </div>
      )}

      {waitingOpp && !finished ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <CheckCircle2 className="size-5 text-emerald-400" />
          <span className="text-sm text-slate-200">
            {matchInfo.vsBot
              ? "Allocation committed & encrypted — this round's results are still syncing from the relayer…"
              : "Allocation committed & encrypted. Waiting for your opponent to commit…"}
          </span>
          <button
            onClick={handleRefresh}
            disabled={busy}
            className="ml-auto flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold transition hover:bg-slate-700 disabled:opacity-60"
          >
            <RefreshCw className="size-4" /> {matchInfo.vsBot ? "Fetch Round Results" : "Check Resolution"}
          </button>
        </div>
      ) : (
        !finished && (
          <button
            onClick={handleSubmit}
            disabled={busy || overBudget || total === 0}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3.5 text-base font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            Encrypt &amp; Commit Allocation
          </button>
        )
      )}

      {finished && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          <Lock className="size-4" /> Match finished — rewards were minted as confidential cLOOT
          (score × 100). Reveal your balance from the top bar.
        </div>
      )}
    </div>
  );
}
