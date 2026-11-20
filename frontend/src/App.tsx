import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Signer } from "ethers";
import Navbar from "./components/Navbar";
import Lobby from "./components/Lobby";
import GameArena from "./components/GameArena";
import RoundHistory from "./components/RoundHistory";
import MatchSummaryModal from "./components/MatchSummaryModal";
import {
  connectSepoliaWallet,
  currentChainId,
  ensureSepolia,
  friendlyError,
  publicDecryptHandles,
} from "./lib/fhe";
import {
  fetchMatch,
  getGameContract,
  getGameReadContract,
  type MatchInfo,
  type RoundRecord,
} from "./lib/contracts";

export default function App() {
  const [signer, setSigner] = useState<Signer | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [screen, setScreen] = useState<"lobby" | "arena">("lobby");
  const [busy, setBusy] = useState<string | null>(null);
  const [waitingMatchId, setWaitingMatchId] = useState<number | null>(null);

  const [matchId, setMatchId] = useState<number | null>(null);
  const [matchInfo, setMatchInfo] = useState<MatchInfo | null>(null);
  const [myPlayer, setMyPlayer] = useState<1 | 2>(1);
  const [scores, setScores] = useState({ you: 0, opp: 0 });
  const [history, setHistory] = useState<RoundRecord[]>([]);
  const [showSummary, setShowSummary] = useState(false);
  const [lootRefreshKey, setLootRefreshKey] = useState(0);

  const showError = useCallback((msg: string) => setError(msg), []);

  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth?.on) return;
    const onChain = () => currentChainId().then(setChainId).catch(() => {});
    const onAccounts = () => {
      setSigner(null);
      setAddress(null);
      setScreen("lobby");
    };
    eth.on("chainChanged", onChain);
    eth.on("accountsChanged", onAccounts);
    return () => {
      eth.removeListener?.("chainChanged", onChain);
      eth.removeListener?.("accountsChanged", onAccounts);
    };
  }, []);

  async function ensureWallet(): Promise<Signer> {
    if (signer) {
      await ensureSepolia();
      setChainId(await currentChainId());
      return signer;
    }
    const s = await connectSepoliaWallet();
    setSigner(s);
    setAddress(await s.getAddress());
    setChainId(await currentChainId());
    return s;
  }

  async function handleConnect() {
    try {
      await ensureWallet();
    } catch (err: any) {
      showError(friendlyError(err));
    }
  }

  async function handleSwitch() {
    try {
      await ensureSepolia();
      setChainId(await currentChainId());
    } catch (err: any) {
      showError(friendlyError(err));
    }
  }

  function enterArena(id: number, info: MatchInfo, player: 1 | 2, sc: { you: number; opp: number }, hist: RoundRecord[]) {
    setMatchId(id);
    setMatchInfo(info);
    setMyPlayer(player);
    setScores(sc);
    setHistory(hist);
    setScreen("arena");
    if (info.state === 2) {
      setShowSummary(true);
      setLootRefreshKey((k) => k + 1);
    }
  }

  async function startSolo() {
    setBusy("solo");
    try {
      const s = await ensureWallet();
      const contract = getGameContract(s);
      const id = Number(await contract.nextMatchId());
      const tx = await contract.createMatch(true);
      await tx.wait();
      const info = await fetchMatch(getGameReadContract(), id);
      enterArena(id, info, 1, { you: 0, opp: 0 }, []);
    } catch (err: any) {
      showError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function createPvp() {
    setBusy("create");
    try {
      const s = await ensureWallet();
      const contract = getGameContract(s);
      const id = Number(await contract.nextMatchId());
      const tx = await contract.createMatch(false);
      await tx.wait();
      setWaitingMatchId(id);
    } catch (err: any) {
      showError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function enterWaiting() {
    if (waitingMatchId === null) return;
    setBusy("enter");
    try {
      await ensureWallet();
      const info = await fetchMatch(getGameReadContract(), waitingMatchId);
      if (info.state === 0) {
        showError("Opponent belum join. Bagikan Match ID-nya, lalu cek lagi.");
        return;
      }
      enterArena(waitingMatchId, info, 1, { you: 0, opp: 0 }, []);
    } catch (err: any) {
      showError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function joinPvp(id: number) {
    setBusy("join");
    try {
      const s = await ensureWallet();
      const contract = getGameContract(s);
      const tx = await contract.joinMatch(id);
      await tx.wait();
      const info = await fetchMatch(getGameReadContract(), id);
      enterArena(id, info, 2, { you: 0, opp: 0 }, []);
    } catch (err: any) {
      showError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  async function resume(id: number) {
    setBusy("resume");
    try {
      const s = await ensureWallet();
      const me = (await s.getAddress()).toLowerCase();
      const contract = getGameReadContract();
      const info = await fetchMatch(contract, id);
      const player: 1 | 2 | null =
        info.player1.toLowerCase() === me ? 1 : info.player2.toLowerCase() === me ? 2 : null;
      if (!player) {
        showError("Wallet ini bukan peserta match tersebut.");
        return;
      }
      if (info.state === 0) {
        setWaitingMatchId(id);
        showError("Match masih menunggu opponent. Bagikan Match ID-nya ke lawanmu.");
        return;
      }

      // Skor hanya bisa didekripsi publik setelah ronde pertama beres
      let sc = { you: 0, opp: 0 };
      const hist: RoundRecord[] = [];
      const completedRounds = info.state === 2 ? 3 : info.currentRound - 1;
      if (completedRounds > 0) {
        const clear = await publicDecryptHandles([info.score1Handle, info.score2Handle]);
        const s1 = Number(clear[info.score1Handle] as any);
        const s2 = Number(clear[info.score2Handle] as any);
        sc = player === 1 ? { you: s1, opp: s2 } : { you: s2, opp: s1 };

        // Riwayat alarm per ronde yang sudah selesai (skor per-ronde tidak tersimpan
        // onchain, jadi progres skor ditandai -1 = tidak diketahui untuk match resume)
        for (let r = 1; r <= completedRounds; r++) {
          const alarmHandles: string[] = [];
          for (let i = 0; i < 3; i++) {
            const [, , tripped] = await contract.getVaultHandles(id, r, i);
            alarmHandles.push(tripped);
          }
          const ac = await publicDecryptHandles(alarmHandles);
          hist.push({
            round: r,
            alarms: alarmHandles.map((h) => Boolean(ac[h])) as [boolean, boolean, boolean],
            scoreYou: r === completedRounds ? sc.you : -1,
            scoreOpp: r === completedRounds ? sc.opp : -1,
          });
        }
      }
      enterArena(id, info, player, sc, hist);
    } catch (err: any) {
      showError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  }

  const handleRoundResolved = useCallback(
    (record: RoundRecord, updated: MatchInfo, mapped: { you: number; opp: number }) => {
      setHistory((h) => [...h.filter((r) => r.round !== record.round), record]);
      setMatchInfo(updated);
      setScores(mapped);
      if (updated.state === 2) {
        setShowSummary(true);
        setLootRefreshKey((k) => k + 1);
      }
    },
    []
  );

  return (
    <div className="blueprint-bg min-h-screen bg-slate-950">
      <Navbar
        signer={signer}
        address={address}
        chainId={chainId}
        onConnect={handleConnect}
        onSwitchNetwork={handleSwitch}
        onError={showError}
        lootRefreshKey={lootRefreshKey}
      />

      {error && (
        <div className="mx-auto mt-4 flex max-w-6xl items-start gap-3 px-4">
          <div className="flex w-full items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Tutup error">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {screen === "lobby" || matchId === null || !matchInfo || !signer ? (
        <Lobby
          busy={busy}
          waitingMatchId={waitingMatchId}
          onStartSolo={startSolo}
          onCreatePvp={createPvp}
          onJoinPvp={joinPvp}
          onResume={resume}
          onEnterWaiting={enterWaiting}
        />
      ) : (
        <main>
          <GameArena
            key={`${matchId}-${matchInfo.currentRound}`}
            signer={signer}
            matchId={matchId}
            matchInfo={matchInfo}
            myPlayer={myPlayer}
            scores={scores}
            onRoundResolved={handleRoundResolved}
            onError={showError}
          />
          <div className="mx-auto w-full max-w-6xl px-4 pb-10">
            <RoundHistory history={history} />
          </div>
        </main>
      )}

      <footer className="border-t border-slate-800/70 px-4 py-4 text-center text-xs text-slate-500">
        This project is not audited, endorsed or operated by Zama. Use at your own risk.
      </footer>

      {showSummary && signer && matchInfo && (
        <MatchSummaryModal
          signer={signer}
          scoreYou={scores.you}
          scoreOpp={scores.opp}
          oppLabel={matchInfo.vsBot ? "Onchain Bot" : "Player 2"}
          onPlayAgain={() => {
            setShowSummary(false);
            startSolo();
          }}
          onClose={() => {
            setShowSummary(false);
            setScreen("lobby");
          }}
          onError={showError}
          onLootRevealed={() => setLootRefreshKey((k) => k + 1)}
        />
      )}
    </div>
  );
}
