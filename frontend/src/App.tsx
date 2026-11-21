import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { Signer } from "ethers";
import Navbar from "./components/Navbar";
import Lobby from "./components/Lobby";
import GameArena from "./components/GameArena";
import RoundHistory from "./components/RoundHistory";
import MatchSummaryModal from "./components/MatchSummaryModal";
import MissionBriefingModal from "./components/MissionBriefingModal";
import PrivacyExplainerModal from "./components/PrivacyExplainerModal";
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
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);

  // Mission Briefing: tampil sekali untuk pengunjung pertama kali;
  // dismissal disimpan sebagai boolean di localStorage.
  useEffect(() => {
    try {
      if (!localStorage.getItem("vaultheist:briefingSeen")) setBriefingOpen(true);
    } catch {
      /* abaikan */
    }
  }, []);

  function closeBriefing() {
    setBriefingOpen(false);
    try {
      localStorage.setItem("vaultheist:briefingSeen", "1");
    } catch {
      /* abaikan */
    }
  }

  const showError = useCallback((msg: string) => setError(msg), []);

  // Banner error tidak boleh basi: hilang otomatis setelah 10 detik.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 10000);
    return () => clearTimeout(t);
  }, [error]);

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
      setError(null);
      await ensureWallet();
    } catch (err: any) {
      showError(friendlyError(err));
    }
  }

  async function handleSwitch() {
    try {
      setError(null);
      await ensureSepolia();
      setChainId(await currentChainId());
    } catch (err: any) {
      showError(friendlyError(err));
    }
  }

  function enterArena(id: number, info: MatchInfo, player: 1 | 2, sc: { you: number; opp: number }, hist: RoundRecord[]) {
    setError(null);
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
    setError(null);
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
    setError(null);
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
    setError(null);
    try {
      await ensureWallet();
      const info = await fetchMatch(getGameReadContract(), waitingMatchId);
      if (info.state === 0) {
        showError("Your opponent hasn't joined yet. Share the Match ID with them, then check again.");
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
    setError(null);
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
    setError(null);
    try {
      const s = await ensureWallet();
      const me = (await s.getAddress()).toLowerCase();
      const contract = getGameReadContract();
      const info = await fetchMatch(contract, id);
      const player: 1 | 2 | null =
        info.player1.toLowerCase() === me ? 1 : info.player2.toLowerCase() === me ? 2 : null;
      if (!player) {
        showError("This wallet is not a participant in that match.");
        return;
      }
      if (info.state === 0) {
        setWaitingMatchId(id);
        showError("This match is still waiting for an opponent. Share the Match ID with them.");
        return;
      }

      // Skor hanya bisa didekripsi publik setelah ronde pertama beres.
      // Setiap langkah dekripsi diisolasi: satu kegagalan relayer TIDAK boleh
      // membatalkan seluruh resume — ronde yang gagal tampil sebagai "syncing".
      let sc = { you: 0, opp: 0 };
      let scoresKnown = false;
      const hist: RoundRecord[] = [];
      const completedRounds = info.state === 2 ? 3 : info.currentRound - 1;
      if (completedRounds > 0) {
        try {
          const clear = await publicDecryptHandles([info.score1Handle, info.score2Handle]);
          const s1 = Number(clear[info.score1Handle] as any);
          const s2 = Number(clear[info.score2Handle] as any);
          sc = player === 1 ? { you: s1, opp: s2 } : { you: s2, opp: s1 };
          scoresKnown = true;
        } catch {
          /* skor belum bisa dibaca — arena tetap dibuka, polling akan menyinkronkan */
        }

        // Riwayat alarm per ronde yang sudah selesai (skor per-ronde tidak tersimpan
        // onchain, jadi progres skor ditandai -1 = tidak diketahui untuk match resume)
        for (let r = 1; r <= completedRounds; r++) {
          try {
            const alarmHandles: string[] = [];
            for (let i = 0; i < 3; i++) {
              const [, , tripped] = await contract.getVaultHandles(id, r, i);
              alarmHandles.push(tripped);
            }
            const ac = await publicDecryptHandles(alarmHandles);
            hist.push({
              round: r,
              alarms: alarmHandles.map((h) => Boolean(ac[h])) as [boolean, boolean, boolean],
              alarmsKnown: true,
              scoreYou: r === completedRounds && scoresKnown ? sc.you : -1,
              scoreOpp: r === completedRounds && scoresKnown ? sc.opp : -1,
            });
          } catch {
            hist.push({
              round: r,
              alarms: [false, false, false],
              alarmsKnown: false,
              scoreYou: -1,
              scoreOpp: -1,
            });
          }
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
      // Backfill: ronde-ronde sebelumnya yang catatannya hilang (pengambilan
      // hasilnya sempat gagal) diisi ulang dari kontrak agar RoundHistory
      // selalu lengkap 1..ronde terakhir, bukan hanya ronde terbaru.
      if (matchId !== null && record.round > 1) {
        const id = matchId;
        void (async () => {
          const contract = getGameReadContract();
          for (let r = 1; r < record.round; r++) {
            let rec: RoundRecord;
            try {
              const alarmHandles: string[] = [];
              for (let i = 0; i < 3; i++) {
                const [, , tripped] = await contract.getVaultHandles(id, r, i);
                alarmHandles.push(tripped);
              }
              const ac = await publicDecryptHandles(alarmHandles);
              rec = {
                round: r,
                alarms: alarmHandles.map((h) => Boolean(ac[h])) as [boolean, boolean, boolean],
                alarmsKnown: true,
                scoreYou: -1,
                scoreOpp: -1,
              };
            } catch {
              rec = { round: r, alarms: [false, false, false], alarmsKnown: false, scoreYou: -1, scoreOpp: -1 };
            }
            setHistory((h) => (h.some((x) => x.round === r) ? h : [...h, rec].sort((a, b) => a.round - b.round)));
          }
        })();
      }
    },
    [matchId]
  );

  // Auto-sync arena: polling ringan membandingkan state onchain vs lokal.
  // Bila berbeda (ronde/match berubah di luar aliran UI — mis. pengambilan
  // hasil sempat gagal), bangun ulang seluruh tampilan dari kontrak via
  // resume(): riwayat lengkap, skor terbaru, dan modal akhir bila Finished.
  const resumeRef = useRef(resume);
  resumeRef.current = resume;
  const syncingRef = useRef(false);
  useEffect(() => {
    if (screen !== "arena" || matchId === null || !matchInfo || showSummary) return;
    const localState = matchInfo.state;
    const localRound = matchInfo.currentRound;
    const t = setInterval(async () => {
      if (syncingRef.current) return;
      try {
        const info = await fetchMatch(getGameReadContract(), matchId);
        if (info.state !== localState || info.currentRound !== localRound) {
          syncingRef.current = true;
          await resumeRef.current(matchId);
          syncingRef.current = false;
        }
      } catch {
        /* abaikan — interval berikutnya mencoba lagi */
      }
    }, 20000);
    return () => clearInterval(t);
  }, [screen, matchId, matchInfo?.state, matchInfo?.currentRound, showSummary]);

  return (
    <div className="blueprint-bg min-h-screen bg-slate-950">
      <Navbar
        signer={signer}
        address={address}
        chainId={chainId}
        onConnect={handleConnect}
        onSwitchNetwork={handleSwitch}
        onError={showError}
        onShowBriefing={() => setBriefingOpen(true)}
        onShowPrivacy={() => setPrivacyOpen(true)}
        lootRefreshKey={lootRefreshKey}
      />

      {error && (
        <div className="mx-auto mt-4 flex max-w-6xl items-start gap-3 px-4">
          <div className="flex w-full items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            <button onClick={() => setError(null)} aria-label="Dismiss error">
              <X className="size-4" />
            </button>
          </div>
        </div>
      )}

      {screen === "lobby" || matchId === null || !matchInfo || !signer ? (
        <Lobby
          busy={busy}
          waitingMatchId={waitingMatchId}
          address={address}
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
            onResync={() => void resume(matchId)}
          />
          <div className="mx-auto w-full max-w-6xl px-4 pb-10">
            <RoundHistory history={history} />
          </div>
        </main>
      )}

      <footer className="border-t border-slate-800/70 px-4 py-4 text-center text-xs text-slate-500">
        This project is not audited, endorsed or operated by Zama. Use at your own risk.
      </footer>

      <MissionBriefingModal open={briefingOpen} onClose={closeBriefing} />
      <PrivacyExplainerModal open={privacyOpen} onClose={() => setPrivacyOpen(false)} />

      {showSummary && signer && matchInfo && (
        <MatchSummaryModal
          signer={signer}
          scoreYou={scores.you}
          scoreOpp={scores.opp}
          oppLabel={matchInfo.vsBot ? "Syndicate AI" : myPlayer === 1 ? "Player 2" : "Player 1"}
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
