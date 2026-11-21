import { useState } from "react";
import { BookOpen, Coins, Eye, EyeOff, HelpCircle, Loader2, Lock, Vault, Wallet } from "lucide-react";
import type { Signer } from "ethers";
import { getTokenContract, getTokenReadContract, TOKEN_ADDRESS } from "../lib/contracts";
import { friendlyError, isZeroHandle, userDecryptHandle } from "../lib/fhe";

interface Props {
  signer: Signer | null;
  address: string | null;
  chainId: bigint | null;
  onConnect: () => void;
  onSwitchNetwork: () => void;
  onError: (msg: string) => void;
  onShowBriefing: () => void;
  onShowPrivacy: () => void;
  lootRefreshKey: number; // naik setiap match selesai -> saldo disembunyikan lagi agar user me-reveal ulang
}

export default function Navbar({
  signer,
  address,
  chainId,
  onConnect,
  onSwitchNetwork,
  onError,
  onShowBriefing,
  onShowPrivacy,
  lootRefreshKey,
}: Props) {
  const [loot, setLoot] = useState<bigint | null>(null);
  const [revealing, setRevealing] = useState(false);
  const [sigNote, setSigNote] = useState(false);
  const [shownKey, setShownKey] = useState(0);

  const wrongNetwork = chainId !== null && chainId !== 11155111n;

  async function handleReveal() {
    if (!signer) return;
    const token = getTokenReadContract();
    if (!token || !TOKEN_ADDRESS) return;
    setRevealing(true);
    setSigNote(true);
    try {
      const userAddress = await signer.getAddress();
      const handle = await token.confidentialBalanceOf(userAddress);
      // Saldo yang belum pernah menerima mint masih zero handle -> tampilkan 0
      // tanpa memanggil relayer (request dekripsi atas zero handle pasti gagal).
      if (isZeroHandle(handle)) {
        setLoot(0n);
      } else {
        setLoot(await userDecryptHandle(handle, TOKEN_ADDRESS, signer));
      }
      setShownKey(lootRefreshKey);
    } catch (err: any) {
      onError(friendlyError(err));
    } finally {
      setRevealing(false);
      setSigNote(false);
    }
  }

  const lootVisible = loot !== null && shownKey === lootRefreshKey;

  return (
    <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-lg bg-amber-400/15 text-amber-400">
            <Vault className="size-5" />
          </span>
          <div className="leading-tight">
            <div className="font-mono text-lg font-bold tracking-widest">VAULT HEIST</div>
            <div className="text-[11px] font-medium tracking-wide text-cyan-400">
              Zama FHEVM • Sepolia
            </div>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <button
            onClick={onShowBriefing}
            className="flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-amber-400/50 hover:text-amber-300"
          >
            <BookOpen className="size-3.5" /> Briefing
          </button>
          <button
            onClick={onShowPrivacy}
            className="flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-200 transition hover:border-cyan-400/50 hover:text-cyan-300"
          >
            <HelpCircle className="size-3.5" /> ? How Privacy Works
          </button>

          {signer && getTokenContract(signer) && (
            <div className="flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 py-1 pr-1 pl-3">
              <Coins className="size-4 text-amber-400" />
              {lootVisible ? (
                <span className="font-mono text-sm font-semibold text-amber-300">
                  cLOOT: {loot!.toLocaleString()}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 font-mono text-sm text-amber-200/80">
                  cLOOT: <Lock className="size-3.5" /> Encrypted
                </span>
              )}
              {lootVisible ? (
                <button
                  onClick={() => setLoot(null)}
                  className="flex items-center gap-1 rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition hover:bg-slate-700"
                >
                  <EyeOff className="size-3.5" /> Hide
                </button>
              ) : (
                <button
                  onClick={handleReveal}
                  disabled={revealing}
                  className="flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-xs font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60"
                >
                  {revealing ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
                  Reveal
                </button>
              )}
            </div>
          )}

          {wrongNetwork ? (
            <button
              onClick={onSwitchNetwork}
              className="rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-400"
            >
              Switch to Sepolia
            </button>
          ) : signer && address ? (
            <div className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-800/80 px-3.5 py-2">
              <span className="size-2 rounded-full bg-emerald-400" />
              <span className="font-mono text-sm">
                {address.slice(0, 6)}…{address.slice(-4)}
              </span>
              <span className="text-xs text-slate-400">Sepolia</span>
            </div>
          ) : (
            <button
              onClick={onConnect}
              className="flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            >
              <Wallet className="size-4" /> Connect Wallet
            </button>
          )}
        </div>
      </div>

      {sigNote && (
        <div className="mx-auto max-w-6xl px-4 pb-3">
          <p className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs leading-relaxed text-cyan-200">
            This is a gas-free signature to privately reveal your encrypted cLOOT balance. It does
            not transfer tokens or spend your funds.
          </p>
        </div>
      )}
    </header>
  );
}
