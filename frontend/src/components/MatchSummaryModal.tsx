import { useState } from "react";
import { Coins, Eye, Loader2, Play, Trophy } from "lucide-react";
import type { Signer } from "ethers";
import { getTokenContract } from "../lib/contracts";
import { friendlyError, isZeroHandle, userDecryptHandle } from "../lib/fhe";

interface Props {
  signer: Signer;
  scoreYou: number;
  scoreOpp: number;
  oppLabel: string;
  onPlayAgain: () => void;
  onClose: () => void;
  onError: (msg: string) => void;
  onLootRevealed: () => void;
}

export default function MatchSummaryModal({
  signer,
  scoreYou,
  scoreOpp,
  oppLabel,
  onPlayAgain,
  onClose,
  onError,
  onLootRevealed,
}: Props) {
  const [loot, setLoot] = useState<bigint | null>(null);
  const [revealing, setRevealing] = useState(false);

  const won = scoreYou > scoreOpp;
  const draw = scoreYou === scoreOpp;

  async function handleReveal() {
    const token = getTokenContract(signer);
    if (!token) return;
    setRevealing(true);
    try {
      const userAddress = await signer.getAddress();
      const handle = await token.confidentialBalanceOf(userAddress);
      if (isZeroHandle(handle)) {
        setLoot(0n);
      } else {
        setLoot(await userDecryptHandle(handle, await token.getAddress(), signer));
      }
      onLootRevealed();
    } catch (err: any) {
      onError(friendlyError(err));
    } finally {
      setRevealing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="rise-in w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">
        <div className="text-center">
          <Trophy className={`mx-auto size-12 ${won ? "text-amber-400" : draw ? "text-slate-300" : "text-slate-500"}`} />
          <h2 className="mt-3 text-2xl font-bold">
            {won ? "Heist Successful!" : draw ? "Split the Take — Draw" : "The Bot Got Away"}
          </h2>
          <p className="mt-1 text-sm text-slate-400">Final score after 3 rounds</p>
          <div className="mt-4 flex items-center justify-center gap-6 font-mono">
            <div>
              <div className="text-3xl font-bold text-cyan-300">{scoreYou}</div>
              <div className="text-xs tracking-wide text-slate-400">YOU</div>
            </div>
            <div className="text-xl text-slate-600">—</div>
            <div>
              <div className="text-3xl font-bold text-slate-200">{scoreOpp}</div>
              <div className="text-xs tracking-wide text-slate-400">{oppLabel.toUpperCase()}</div>
            </div>
          </div>
        </div>

        {getTokenContract(signer) && (
          <div className="mt-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-semibold text-amber-300">
              <Coins className="size-4" /> ERC-7984 Confidential Reward
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-amber-100/80">
              Your confidential <span className="font-mono font-semibold">cLOOT</span> reward has
              been minted onchain via ERC-7984 — your score × 100, encrypted as{" "}
              <span className="font-mono">euint64</span>.
            </p>
            {loot !== null ? (
              <div className="mt-3 font-mono text-xl font-bold text-amber-300">
                Balance: {loot.toLocaleString()} cLOOT
              </div>
            ) : (
              <button
                onClick={handleReveal}
                disabled={revealing}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
              >
                {revealing ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                Reveal Updated cLOOT Balance
              </button>
            )}
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            onClick={onPlayAgain}
            className="flex items-center justify-center gap-2 rounded-lg bg-cyan-400 py-3 text-sm font-bold text-slate-950 transition hover:bg-cyan-300"
          >
            <Play className="size-4" /> Play Again (Solo)
          </button>
          <button
            onClick={onClose}
            className="rounded-lg bg-slate-800 py-3 text-sm font-semibold transition hover:bg-slate-700"
          >
            Back to Lobby
          </button>
        </div>
      </div>
    </div>
  );
}
