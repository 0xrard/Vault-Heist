import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, Loader2, Lock, RefreshCw, Send, TriangleAlert } from "lucide-react";
import type { Signer } from "ethers";
import VaultCard, { type ScoutedStat } from "./VaultCard";
import TxProgress from "./TxProgress";
import SyndicateBar from "./SyndicateBar";
import CinematicReveal, {
  consumePendingReveal,
  stashPendingReveal,
  type CinematicRevealData,
} from "./CinematicReveal";
import { loadMatchResults } from "../lib/streakStorage";
import {
  clearPendingTx,
  isPendingTxStorageAvailable,
  loadPendingTxResult,
  savePendingTx,
  type PendingTxRecord,
} from "../lib/pendingTxStorage";
import {
  clearScout,
  enforceRetention,
  findScoutOnchain,
  loadScout,
  migrateLegacyScout,
  pruneMatchScouts,
  saveScout,
} from "../lib/scoutStorage";
import { encryptBids, friendlyError, publicDecryptHandles, userDecryptHandle } from "../lib/fhe";
import { playClick, playCoin, playLock, playReveal, playSonar } from "../lib/sfx";
import { CONTRACT_ADDRESS, fetchMatch, findRoundCommits, getGameContract, getGameReadContract, readProvider, type MatchInfo, type RoundRecord } from "../lib/contracts";

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

// Batch 6: explicit sync status. The principle: the UI may only
// conclude "done / not done" from a CONCLUSIVE scan result. An RPC
// failure is its own status ("unknown"), not "not done".
type ScoutSyncStatus = "syncing" | "verified-unused" | "verified-used" | "unknown";
type CommitSyncStatus = "checking" | "verified-uncommitted" | "committed" | "unknown";

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
  const [dialogue, setDialogue] = useState<string | null>(null);
  const [submitStage, setSubmitStage] = useState(0); // 0 = idle, 1..4 = commit progress stages
  const [cachedScoutUsed, setCachedScoutUsed] = useState(false); // local cache: scout used, value awaiting onchain verification
  const [scoutStatus, setScoutStatus] = useState<ScoutSyncStatus>("syncing"); // Batch 6: three-state Scout gate (verified-unused / verified-used / unknown), replacing the Batch 4 boolean that opened the gate on every outcome including failure
  const [commitStatus, setCommitStatus] = useState<CommitSyncStatus>("checking"); // Batch 6: four-state commit status, replacing the Batch 4 boolean that also became true when the scan failed
  const [oppCommitted, setOppCommitted] = useState<boolean | null>(null); // Batch 4 (P0-A): has the opponent committed this round? null = not yet known / inconclusive
  // Batch 6.1: the tx was sent (hash exists) but the receipt is unconfirmed;
  // the related status is forced to "unknown" and the hash is displayed as an
  // Etherscan link. Batch 6.2: the record now also stores the sender nonce, and
  // verification must check this hash's status BEFORE an event-scan conclusion
  // may open controls or delete the record (see consultTxHashGate).
  // Batch 6.3: the record carries the full context identity (matchId, round,
  // sender, chainId, contractAddress) and is persisted to localStorage
  // through the same store/clear gateway (lib/pendingTxStorage.ts), so
  // the hash gate still applies after a refresh / browser crash. Storage
  // is only a hint for finding the transaction; the blockchain remains the source
  // of truth and its contents are never treated as proof of success.
  type UnconfirmedTx = PendingTxRecord;
  const [unconfirmedTx, setUnconfirmedTx] = useState<UnconfirmedTx | null>(null);
  // Batch 6.3 addendum: a localStorage availability probe, computed once
  // per arena mount (its result is itself cached at module level). If
  // storage is unavailable, pending-record persistence is dead and the player
  // must KNOW from the start that post-refresh recovery protection
  // is not active — not find out only after a transaction is hanging.
  const [pendingTxStorageAvailable] = useState(() => isPendingTxStorageAvailable());
  const [unconfirmedTxPending, setUnconfirmedTxPending] = useState(false); // Batch 6.2: the last hash check found the tx still pending (known to the provider, no receipt yet)
  // Batch 6.3.1 (P1): PER-TRANSACTION persistence warning. The probe at arena
  // start only proves storage was usable at that moment; the actual record
  // save can still fail afterwards (quota, an incomplete capture
  // identity). storeUnconfirmedTx raises the related kind's flag when
  // savePendingTx reports failure, and the unconfirmedTx panel displays
  // an extra note for that transaction. Cleared through the same clear path
  // as its record.
  const [txPersistenceWarning, setTxPersistenceWarning] = useState<{
    commit: boolean;
    scout: boolean;
  }>({ commit: false, scout: false });
  // Batch 6.3.2: recovery warning for a persisted record that EXISTS
  // but fails validation ("invalid"). Raised per kind by
  // the verification function when that kind's hydration fails closed due to
  // invalid-record, and cleared when that kind's hydration later
  // succeeds. One note displays in the arena if either kind is active.
  const [hydrationWarning, setHydrationWarning] = useState<{
    commit: boolean;
    scout: boolean;
  }>({ commit: false, scout: false });
  // Batch 6.2: a ref mirror of unconfirmedTx so the async verification functions
  // always read the latest record, not stale closure state.
  // Batch 6.3: this mirror is per-kind (one slot per kind), exactly like
  // its persistent key — the commit record and the Scout record are two independent
  // records in storage, so the ref must not sacrifice either;
  // the `unconfirmedTx` state stays a single record for the panel (the last one
  // stored / the hydration result).
  const unconfirmedTxByKindRef = useRef<{
    commit: UnconfirmedTx | null;
    scout: UnconfirmedTx | null;
  }>({ commit: null, scout: null });
  const pendingTxHydrationRef = useRef<Promise<HydrationOutcome> | null>(null); // Batch 6.3: persistent-record hydration runs once per arena instance; both verification functions await it before the hash gate is consulted. Batch 6.3.1: only a FULLY successful hydration stays cached here — a failed result is cleared so a retry re-runs hydration
  const commitCheckSeq = useRef(0); // Batch 6.1: checkCommitStatus sequence guard — only the latest invocation may write state
  const scoutCheckSeq = useRef(0); // Batch 6.1: restoreScoutStatus sequence guard (independent of commit)
  const [scoutAnimate, setScoutAnimate] = useState(false); // Batch 2: cipher scramble only for a fresh Scout reveal
  const [outcomes, setOutcomes] = useState<[boolean, boolean, boolean] | null>(null); // Batch 2: alarm per vault this round (door open)
  const [cineReveal, setCineReveal] = useState<CinematicRevealData | null>(null); // Batch 5: cinematic reveal overlay (direct submit path only)
  const resolutionRef = useRef<{
    round: number;
    alarms: [boolean, boolean, boolean];
    mapped: { you: number; opp: number };
  } | null>(null); // Batch 5: the latest resolution result from collectResolution, read by handleSubmit for the overlay
  const closeReveal = useCallback(() => setCineReveal(null), []);

  // Batch 6.2: store / clear the ambiguous-tx record through one gateway so the React
  // state and the ref mirror never diverge.
  // Batch 6.3: the same gateway now also writes / deletes the persisted
  // record in localStorage, so state, ref, and storage always move
  // together and never drift. Persistent deletion only
  // happens from the clear path already approved by the 6.2 hash gate
  // (status-0 receipt, matching event in scan-strict, a conclusive replacement
  // branch) — a blocked / inconclusive / RPC-error result never
  // calls this function, so the persisted record survives too.
  function storeUnconfirmedTx(rec: UnconfirmedTx) {
    unconfirmedTxByKindRef.current[rec.kind] = rec;
    // Batch 6.3.1 (P1): the actual save result is now read. If this record
    // fails to persist (storage refuses, or the capture identity
    // is incomplete), the session gate still works from memory, but
    // the player must know THIS transaction's record will not survive a
    // refresh — raise the per-transaction warning for its kind.
    const saved = savePendingTx(rec);
    setTxPersistenceWarning((prev) => ({ ...prev, [rec.kind]: !saved }));
    setUnconfirmedTx(rec);
    setUnconfirmedTxPending(false);
  }

  function clearUnconfirmedTx(kind: "commit" | "scout") {
    const rec = unconfirmedTxByKindRef.current[kind];
    if (!rec) return;
    unconfirmedTxByKindRef.current[kind] = null;
    clearPendingTx(rec);
    setTxPersistenceWarning((prev) => ({ ...prev, [kind]: false }));
    // The panel displays one record: if the one being cleared is the one
    // displayed, show the other kind's record if one still exists.
    setUnconfirmedTx((prev) =>
      prev?.kind === kind
        ? (unconfirmedTxByKindRef.current.commit ?? unconfirmedTxByKindRef.current.scout)
        : prev
    );
    setUnconfirmedTxPending(false);
  }

  // Batch 6.3: the full record form from an ambiguous transaction response.
  // The context identity (sender + chainId) is read from the signer / provider
  // at capture time; if that read fails, the record is still formed
  // with an empty identity: this session's hash gate still works from
  // hash + nonce, but savePendingTx refuses to persist it
  // (an incomplete identity cannot be validated when read back),
  // so its behavior degrades exactly to Batch 6.2.
  async function captureUnconfirmedTx(
    kind: "commit" | "scout",
    tx: any
  ): Promise<UnconfirmedTx> {
    let sender = "";
    let chainId = 0;
    try {
      sender = (await signer.getAddress()).toLowerCase();
      chainId = Number((await readProvider.getNetwork()).chainId);
    } catch {
      /* identity unreadable: the record lives only in this session's memory */
    }
    return {
      kind,
      hash: tx.hash,
      nonce: tx.nonce,
      matchId,
      round,
      sender,
      chainId,
      contractAddress: CONTRACT_ADDRESS,
      savedAt: Date.now(),
    };
  }

  // Batch 6.3: hydration of persisted records for this arena's context
  // (chain + contract + matchId + round + connected wallet, per kind).
  // Runs once per arena instance — App remounts GameArena per
  // `${matchId}-${round}`, so the context is always fresh. Both verification
  // functions AWAIT this promise before consultTxHashGate is called,
  // so a reloaded record is already in the ref before any event
  // conclusion is taken — the same order as the active 6.2 session.
  // Records belonging to another context are never loaded (key + identity-field
  // validation in loadPendingTxResult) and never touched in storage.
  //
  // Batch 6.3.1 (P0): hydration is now FAIL-CLOSED and returns an explicit
  // result per kind. Version 6.3 swallowed every failure in a try/catch and
  // resolved the promise as if successful: if signer.getAddress()
  // or getNetwork() failed transiently, the caller proceeded to the hash gate
  // with an empty ref, the gate saw "no record", and a bare event scan
  // could open controls on top of a transaction that was in fact still
  // pending — exactly the hole Batch 6.3 was supposed to close. Worse,
  // the failed promise was cached, so a retry never
  // re-ran hydration for the life of the arena instance. Now:
  //   - identity unreadable -> both kinds { ok: false,
  //     reason: "identity-unavailable" }.
  //   - a per-kind storage read throws (loadPendingTxResult "error")
  //     -> that kind { ok: false, reason: "storage-unavailable" }.
  //     A successful read with no entry ("absent") or with a valid entry
  //     ("found") is ok: conclusively there is no persisted
  //     record for that context.
  //   - Batch 6.3.2: an entry EXISTS but is corrupt / fails validation
  //     (loadPendingTxResult "invalid") -> that kind { ok: false,
  //     reason: "invalid-record" }. Contents that cannot be trusted are not
  //     proof that no transaction is pending, so the treatment is the same
  //     as any other failure: fail-closed + a recovery warning.
  //   - only a FULLY ok result stays cached; a failed result
  //     clears the cache as soon as the promise settles, so the next check or
  //     retry re-runs hydration.
  // A hydration failure is never interpreted as proof that no
  // record exists: both verification functions check this result per kind and
  // stop at the "unknown" status without touching the gate or the scan.
  type HydrationResult =
    | { ok: true }
    | {
        ok: false;
        reason: "identity-unavailable" | "storage-unavailable" | "invalid-record";
      };
  type HydrationOutcome = { commit: HydrationResult; scout: HydrationResult };

  function ensurePendingTxHydrated(): Promise<HydrationOutcome> {
    if (!pendingTxHydrationRef.current) {
      const p = (async (): Promise<HydrationOutcome> => {
        let sender: string;
        let chainId: number;
        try {
          sender = (await signer.getAddress()).toLowerCase();
          chainId = Number((await readProvider.getNetwork()).chainId);
        } catch {
          const fail: HydrationResult = { ok: false, reason: "identity-unavailable" };
          return { commit: fail, scout: fail };
        }
        const outcome = {} as HydrationOutcome;
        for (const kind of ["commit", "scout"] as const) {
          if (unconfirmedTxByKindRef.current[kind]) {
            // This session's record is fresher than storage; this kind does not
            // depend on the storage read result at all.
            outcome[kind] = { ok: true };
            continue;
          }
          const res = loadPendingTxResult(chainId, CONTRACT_ADDRESS, matchId, round, sender, kind);
          if (res.status === "error") {
            outcome[kind] = { ok: false, reason: "storage-unavailable" };
          } else if (res.status === "invalid") {
            // Batch 6.3.2: an entry exists but cannot be validated.
            // Fail-closed exactly like a read failure: an entry that
            // cannot be trusted must not be treated as
            // "no record".
            outcome[kind] = { ok: false, reason: "invalid-record" };
          } else {
            if (res.status === "found") unconfirmedTxByKindRef.current[kind] = res.record;
            outcome[kind] = { ok: true };
          }
        }
        const display =
          unconfirmedTxByKindRef.current.commit ?? unconfirmedTxByKindRef.current.scout;
        if (display) setUnconfirmedTx((prev) => prev ?? display);
        return outcome;
      })();
      pendingTxHydrationRef.current = p;
      // The cache is only for full success. This handler is registered
      // before the callers' continuations (which await the same
      // promise), so the ref is already cleared before the next check
      // begins; the current caller still receives its failed result and
      // fails closed on the related kind.
      void p.then((outcome) => {
        if (
          (!outcome.commit.ok || !outcome.scout.ok) &&
          pendingTxHydrationRef.current === p
        ) {
          pendingTxHydrationRef.current = null;
        }
      });
    }
    return pendingTxHydrationRef.current;
  }

  // Batch 6.2 — hash gate (closes the pending-transaction hole from the Batch
  // 6.1 review). Batch 6.1 forced the "unknown" status when tx.wait() failed
  // after broadcast, but retry/mount verification only read event scans
  // up to the latest block: if the original transaction is STILL PENDING, its event
  // does not exist yet, the scan conclusively reported "not found",
  // and the controls reopened even though the old transaction could still
  // execute. Now, while an unconfirmedTx record exists for this kind,
  // the transaction status is checked by HASH first and the event-scan
  // result must not contradict it:
  //   "scan"        — no record, OR the receipt proves the tx failed
  //                   (status 0): the record is cleared (clearRecord) and a normal
  //                   event scan decides the real status.
  //   "scan-strict" — a successful receipt (status 1), OR the nonce was consumed by
  //                   another mined tx (possibly a replacement tx from a
  //                   wallet speed-up): the event scan still runs, but
  //                   ONLY a "found" result may settle
  //                   the status and clear the record. A not-found result
  //                   (even a conclusive one) means INCONSISTENT with
  //                   the receipt: the status stays "unknown", the record is kept.
  //   "blocked"     — the tx is still pending, or the tx is not found while
  //                   its nonce is not yet consumed, or the hash check
  //                   itself failed at the RPC: the status stays "unknown", the record is
  //                   kept, and the event scan is not run at all.
  // This function writes no state except through its return value; the caller
  // checks it after isLatest() so the Batch 6.1 sequence guard still
  // covers all these new awaits.
  // Batch 6.3: the record this function reads can come from the active session
  // or from localStorage hydration after a reload — its source does not
  // change the gate logic at all; a hydrated record passes through
  // exactly the same scan / scan-strict / blocked decision.
  type TxHashGate = "scan" | "scan-strict" | "blocked";

  async function consultTxHashGate(
    kind: "commit" | "scout",
    sender: string
  ): Promise<{ gate: TxHashGate; pending: boolean; clearRecord: boolean }> {
    const rec = unconfirmedTxByKindRef.current[kind];
    if (!rec) return { gate: "scan", pending: false, clearRecord: false };
    try {
      const receipt = await readProvider.getTransactionReceipt(rec.hash);
      if (receipt) {
        if (receipt.status === 1) return { gate: "scan-strict", pending: false, clearRecord: false };
        if (receipt.status === 0) return { gate: "scan", pending: false, clearRecord: true };
        return { gate: "blocked", pending: false, clearRecord: false }; // unknown receipt status: do not guess
      }
      const tx = await readProvider.getTransaction(rec.hash);
      if (tx) return { gate: "blocked", pending: true, clearRecord: false }; // known to the provider, no receipt yet: still pending
      // Hash not found: dropped or replaced. The nonce decides:
      // nonce consumed by a mined transaction -> possibly a replacement tx,
      // let the conclusive event scan (strict mode) decide. Nonce
      // not yet consumed -> the tx is just not visible yet; do not treat it as failed.
      if (!Number.isInteger(rec.nonce)) return { gate: "blocked", pending: false, clearRecord: false };
      const minedCount = await readProvider.getTransactionCount(sender);
      return minedCount > rec.nonce
        ? { gate: "scan-strict", pending: false, clearRecord: false }
        : { gate: "blocked", pending: false, clearRecord: false };
    } catch {
      return { gate: "blocked", pending: false, clearRecord: false }; // RPC failed while checking the hash: stay unknown
    }
  }

  const contract = useMemo(() => getGameContract(signer), [signer]);
  const readContract = useMemo(() => getGameReadContract(), []);

  // Scout persistence (Batch 1 #7, see lib/scoutStorage.ts): a Scout transaction
  // can succeed onchain while its decryption fails (slow relayer) — without
  // a cache, the UI would not know Scout was used and the budget would desync from the contract.
  // But the cache is NEVER trusted blindly: when the arena loads, the Scout
  // status is verified against the onchain VaultScouted event first. The "scout used" flag
  // from the cache is applied immediately so the budget is right from the first paint, but
  // its decrypted VALUE is only displayed after the chain confirms the same vault +
  // stat kind (or the verification is inconclusive -> cache fallback).
  async function persistScout(entry: { vaultIdx: number; checkAlarm: boolean; value: number | null }) {
    try {
      const wallet = (await signer.getAddress()).toLowerCase();
      saveScout(CONTRACT_ADDRESS, matchId, round, wallet, entry);
    } catch {
      /* ignore — the Scout is still recorded onchain */
    }
  }

  // Batch 6: Scout restore is now a named function so it can be re-run
  // via the retry button when its result is "unknown". The final status is always one
  // of three explicit states — there is no longer a boolean gate that
  // opened on EVERY outcome (Batch 4 opened the gate even when the scan
  // failed, so an RPC failure masqueraded as "Scout not used yet").
  async function restoreScoutStatus() {
    // Batch 6.1: sequence guard. The mount effect, StrictMode double-effects,
    // and the retry button can run this check concurrently; without
    // a guard, an older scan finishing later could overwrite a newer
    // scan's result. Only the invocation with the latest sequence number
    // may write state.
    const seq = ++scoutCheckSeq.current;
    const isLatest = () => seq === scoutCheckSeq.current;
    setScoutStatus("syncing");
    try {
      enforceRetention();
      const wallet = (await signer.getAddress()).toLowerCase();
      if (!isLatest()) return;
      migrateLegacyScout(matchId, round, CONTRACT_ADDRESS, wallet);
      const cached = loadScout(CONTRACT_ADDRESS, matchId, round, wallet);
      if (cached) setCachedScoutUsed(true);

      // Batch 6.3: await persistent-record hydration first, so
      // the hash gate below sees the reloaded record (if any),
      // not a still-empty ref.
      // Batch 6.3.1 (P0): its result is now checked. If hydration for
      // the Scout kind FAILED (identity / storage read) and there is no
      // session record in the ref, the check STOPS at "unknown": the
      // hash gate is not consulted and the event scan is not run,
      // because an empty ref at this point proves nothing.
      // A retry re-runs this check, and a failed hydration
      // is not cached, so the retry truly attempts hydration again.
      const hydration = await ensurePendingTxHydrated();
      if (!isLatest()) return;
      // Batch 6.3.2: the recovery warning follows this kind's hydration
      // result — on only for an invalid-record failure, off as soon as
      // this kind's hydration succeeds.
      if (hydration.scout.ok) {
        setHydrationWarning((w) => (w.scout ? { ...w, scout: false } : w));
      } else if (
        !unconfirmedTxByKindRef.current.scout &&
        hydration.scout.reason === "invalid-record"
      ) {
        setHydrationWarning((w) => (w.scout ? w : { ...w, scout: true }));
      }
      if (!unconfirmedTxByKindRef.current.scout && !hydration.scout.ok) {
        setScoutStatus("unknown");
        return;
      }

      // Batch 6.2: the hash gate first. While a Scout tx for this round is
      // unconfirmed, an event-scan conclusion must not
      // open Scout or clear the record before the hash status is known:
      // a still-pending tx has no event yet, so "not
      // found" at that point is not proof of anything.
      const gateRes = await consultTxHashGate("scout", wallet);
      if (!isLatest()) return;
      if (gateRes.clearRecord) clearUnconfirmedTx("scout"); // status-0 receipt: the tx provably failed, the record is done
      setUnconfirmedTxPending(gateRes.pending);
      const chain =
        gateRes.gate === "blocked"
          ? null // the gate holds: do not run the event scan at all
          : await findScoutOnchain(readContract, matchId, round, wallet);
      if (!isLatest()) return;

      if (chain && chain.found) {
        const kind = chain.checkAlarm ? ("alarm" as const) : ("loot" as const);
        if (
          cached &&
          cached.vaultIdx === chain.vaultIdx &&
          cached.checkAlarm === chain.checkAlarm &&
          cached.value !== null
        ) {
          // Verified: the cache matches the onchain event -> display the value.
          setScoutAnimate(false);
          setScouted({ vaultIdx: cached.vaultIdx, kind, value: cached.value });
          setPendingScout(null);
        } else {
          // The chain wins: Scout was used on this vault (possibly from another
          // browser / a stale cache) — its value is not in this browser yet, offer
          // a free re-decryption via the pending panel.
          setScouted(null);
          setPendingScout({ vaultIdx: chain.vaultIdx, kind });
          if (!cached || cached.vaultIdx !== chain.vaultIdx || cached.checkAlarm !== chain.checkAlarm) {
            saveScout(CONTRACT_ADDRESS, matchId, round, wallet, {
              vaultIdx: chain.vaultIdx,
              checkAlarm: chain.checkAlarm,
              value: null,
            });
          }
        }
        setCachedScoutUsed(false);
        setScoutStatus("verified-used");
        clearUnconfirmedTx("scout"); // Batch 6.1/6.2: the Scout event is consistent with the receipt -> the ambiguous-tx record is done
      } else if (chain && !chain.found && gateRes.gate !== "scan-strict") {
        // Conclusive: the entire range since MatchCreated was scanned and there is
        // no Scout event for this round. Only a result this conclusive may
        // discard the cache and declare Scout unused.
        if (cached) clearScout(CONTRACT_ADDRESS, matchId, round, wallet);
        setCachedScoutUsed(false);
        setScouted(null);
        setPendingScout(null);
        setScoutStatus("verified-unused");
        clearUnconfirmedTx("scout"); // "scan" mode: no record, or a status-0 receipt already cleared it at the hash gate
      } else {
        // Inconclusive — RPC failed / incomplete range, OR the Batch 6.2
        // hash gate holds the conclusion: the Scout tx is still pending
        // ("blocked", the scan was not even run), or a successful receipt
        // but its event is not visible ("scan-strict" + not
        // found = inconsistent). In all these cases the cache is NOT
        // discarded, the tx record is NOT deleted, and Scout is NOT declared
        // unused. The cached value
        // (if any) is still displayed as a view fallback, but
        // the sync status is "unknown": the Scout buttons stay disabled
        // and the player is offered a verification retry. The rest of the game (allocation,
        // LOCK IN) is unaffected.
        if (cached) {
          if (cached.value !== null) {
            setScoutAnimate(false);
            setScouted({
              vaultIdx: cached.vaultIdx,
              kind: cached.checkAlarm ? "alarm" : "loot",
              value: cached.value,
            });
          } else {
            setPendingScout({
              vaultIdx: cached.vaultIdx,
              kind: cached.checkAlarm ? "alarm" : "loot",
            });
          }
          setCachedScoutUsed(false);
        }
        setScoutStatus("unknown");
      }
    } catch {
      if (isLatest()) setScoutStatus("unknown");
    }
  }

  useEffect(() => {
    void restoreScoutStatus();
    // Batch 6.1: the cleanup cancels a check still in flight when
    // the match/round changes or the component unmounts (incrementing the sequence
    // number makes in-flight results stale and ignored).
    return () => {
      scoutCheckSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, round]);

  // Batch 4 (P0-A) + Batch 6: restore the commit status from the
  // AllocationCommitted event when the arena loads. Without this, a player who already
  // committed and then refreshed would see the LOCK IN button again (waitingOpp always
  // starts false) and could attempt a second commit that would certainly revert in
  // the contract. Batch 6 replaced the Batch 4 boolean (which became true on
  // EVERY outcome, including a failed scan — so a broken RPC
  // reopened LOCK IN for a player who had actually already committed)
  // with a four-state status:
  //   checking              -> controls locked, check in progress
  //   verified-uncommitted  -> conclusive scan, not committed: LOCK IN active
  //   committed             -> conclusive scan, already committed: the
  //                            ORDERS LOCKED / WAITING FOR OPPONENT panel
  //                            that already exists takes over (waitingOpp)
  //   unknown               -> scan failed / inconclusive: controls STAY
  //                            locked + the RETRY STATUS CHECK button.
  // An RPC failure is never again equated with "not committed yet".
  async function checkCommitStatus() {
    // Batch 6.1: the same sequence guard as restoreScoutStatus,
    // independent: only the latest invocation may write state,
    // an older scan finishing later is ignored.
    const seq = ++commitCheckSeq.current;
    const isLatest = () => seq === commitCheckSeq.current;
    setCommitStatus("checking");
    try {
      if (finished || matchInfo.state !== 1) {
        // The arena is not in a commit phase (match finished / not yet active):
        // the check does not apply, do not block the UI because of it.
        setCommitStatus("verified-uncommitted");
        return;
      }
      const me = await signer.getAddress();
      if (!isLatest()) return;
      // Batch 6.3: await persistent-record hydration first, so
      // the hash gate below sees the reloaded record (if any),
      // not a still-empty ref.
      // Batch 6.3.1 (P0): the same fail-closed as Scout. A commit
      // hydration that fails with no session record in the ref -> stays "unknown",
      // with no hash gate and no event scan; LOCK IN must not be
      // opened by an absence of information. A retry re-runs hydration because
      // a failed result is not cached.
      const hydration = await ensurePendingTxHydrated();
      if (!isLatest()) return;
      // Batch 6.3.2: per-kind recovery warning, same as Scout.
      if (hydration.commit.ok) {
        setHydrationWarning((w) => (w.commit ? { ...w, commit: false } : w));
      } else if (
        !unconfirmedTxByKindRef.current.commit &&
        hydration.commit.reason === "invalid-record"
      ) {
        setHydrationWarning((w) => (w.commit ? w : { ...w, commit: true }));
      }
      if (!unconfirmedTxByKindRef.current.commit && !hydration.commit.ok) {
        setCommitStatus("unknown");
        return;
      }
      // Batch 6.2: the hash gate first, same as Scout. A commit tx
      // that is still pending has no AllocationCommitted event yet, so
      // a scan concluding "not committed" at that moment would open
      // LOCK IN on top of a transaction that can still execute.
      const gateRes = await consultTxHashGate("commit", me);
      if (!isLatest()) return;
      if (gateRes.clearRecord) clearUnconfirmedTx("commit"); // status-0 receipt: the tx provably failed, the record is done
      setUnconfirmedTxPending(gateRes.pending);
      if (gateRes.gate === "blocked") {
        // Tx still pending / not found with the nonce not yet consumed /
        // hash check failed: stay unknown, the record is kept, LOCK IN
        // stays locked, the event scan is not run.
        setCommitStatus("unknown");
        return;
      }
      const oppAddress = myPlayer === 1 ? matchInfo.player2 : matchInfo.player1;
      const res = await findRoundCommits(readContract, matchId, round, me, oppAddress);
      if (!isLatest()) return;
      if (!res.conclusive) {
        setCommitStatus("unknown");
        return;
      }
      if (gateRes.gate === "scan-strict" && !res.mine) {
        // The receipt proves the commit tx succeeded (or its nonce was consumed
        // by a mined replacement tx), but this round's commit event is not
        // visible: inconsistent. Do not open LOCK IN, do not delete
        // the record; the next retry re-checks the hash, then the event.
        setCommitStatus("unknown");
        return;
      }
      setOppCommitted(res.opponent);
      clearUnconfirmedTx("commit"); // Batch 6.1/6.2: a conclusive verification (consistent with the receipt if any) settles the formerly ambiguous commit-tx record
      if (res.mine) {
        setWaitingOpp(true);
        setCommitStatus("committed");
      } else {
        setCommitStatus("verified-uncommitted");
      }
    } catch {
      if (isLatest()) setCommitStatus("unknown");
    }
  }

  useEffect(() => {
    void checkCommitStatus();
    // Batch 6.1: the cleanup cancels an in-flight check when
    // the match/round changes or the component unmounts.
    return () => {
      commitCheckSeq.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, round]);

  // Batch 5: pick up the cinematic-reveal hand-off from the previous arena
  // instance (App remounts the arena every round). Only the direct submit
  // path hands off data; resume/polling/backfill never
  // write it, and a page refresh wipes it (module memory).
  useEffect(() => {
    const data = consumePendingReveal(matchId);
    if (data) setCineReveal(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  const scoutUsed = scouted !== null || pendingScout !== null || cachedScoutUsed;
  // Batch 6.1 (P0): conservative budget. The contract sets the budget to 9 if
  // Scout was used (BASE_CREW - 1) and _validateBudget zeroes
  // ALL bids whose total exceeds the cap, while the transaction itself still
  // succeeds — an allocation of 10 sent while the Scout status is actually
  // "already used" would silently vanish. So while the Scout status
  // is unverified ("syncing" / "unknown"), the UI cap is 9 even if
  // the local cache is empty: only "verified-unused" opens the budget of 10.
  // The price of this uncertainty is at most one agent temporarily; the price
  // of guessing the other way is the entire round's allocation.
  const scoutBudgetUncertain = scoutStatus === "syncing" || scoutStatus === "unknown";
  const maxBudget = scoutUsed || scoutBudgetUncertain ? BASE_BUDGET - 1 : BASE_BUDGET;
  const showConservativeBudgetNote = scoutBudgetUncertain && !scoutUsed;
  const total = bids[0] + bids[1] + bids[2];
  const overBudget = total > maxBudget;
  const finished = matchInfo.state === 2;
  const oppLabel = matchInfo.vsBot ? "Syndicate AI" : myPlayer === 1 ? "Player 2" : "Player 1";

  // Syndicate AI dialogue — round opener (Solo mode only; the component is remounted
  // every round by App, so this effect runs once per round).
  useEffect(() => {
    if (!matchInfo.vsBot || finished) return;
    setDialogue(
      round === 1 ? "Another crew thinks they can outsmart us?" : "Three vaults. Don't get greedy."
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Syndicate AI reaction when the match ends + pruning this match's Scout cache
  // (contract: entries are cleaned once the match is Finished / state === 2).
  useEffect(() => {
    if (!finished) return;
    if (matchInfo.vsBot) {
      setDialogue(
        scores.you > scores.opp
          ? "Impossible... You cracked our vault!"
          : scores.you === scores.opp
            ? "A standoff. Neither crew walks away clean."
            : "The Syndicate always collects its dues."
      );
    }
    (async () => {
      try {
        const wallet = (await signer.getAddress()).toLowerCase();
        pruneMatchScouts(CONTRACT_ADDRESS, matchId, wallet);
        // Batch 5: Syndicate AI streak-milestone dialogue (Solo only, only
        // if THIS match was won by the player). The streak is computed ending
        // exactly at this match's entry in streakStorage, so the number is
        // the streak this match produced, not the current session's streak.
        // The match result is recorded by App before the arena sees the Finished state
        // (live path) or before the arena mounts (resume path), and
        // the recording dedupes per matchId.
        if (matchInfo.vsBot && scores.you > scores.opp) {
          const entries = loadMatchResults(wallet);
          const ix = entries.findIndex((e) => e.matchId === matchId);
          if (ix >= 0 && entries[ix].outcome === "win") {
            let streak = 0;
            for (let i = ix; i >= 0; i--) {
              if (entries[i].outcome !== "win") break;
              streak++;
            }
            if (streak === 3)
              setDialogue("Three in a row. Enjoy it while it lasts, the vaults learn fast.");
            else if (streak === 5)
              setDialogue("Five straight hits on my vaults? Nobody is that lucky. Nobody.");
            else if (streak === 10)
              setDialogue("TEN in a row?! Impossible. Someone on my crew is getting fired tonight.");
          }
        }
      } catch {
        /* ignore */
      }
    })();
  }, [finished, scores.you, scores.opp, matchInfo.vsBot, matchId, signer]);

  // Fetch this round's vault ciphertext handles (only for the technical tooltip on the CLASSIFIED / SEALED stamp in the UI)
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
        /* the handle preview is optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readContract, matchId, round]);

  // Batch 6.1: phase 1 ("ready to lock in") compares the total against this round's
  // effective cap (maxBudget), not an assumed fixed 10 —
  // with the conservative budget of 9, a total of 9 is a complete allocation.
  const phase = waitingOpp || busy ? 3 : scoutUsed || total !== maxBudget ? 2 : 1;

  function setBid(idx: number, value: number) {
    setBids((prev) => {
      const next: [number, number, number] = [...prev];
      next[idx] = value;
      return next;
    });
  }

  // Decrypt the result of a Scout whose transaction is ALREADY recorded onchain.
  // Separated from handleScout so it can be retried without a new transaction.
  async function decryptPending(p: { vaultIdx: number; kind: "loot" | "alarm" }) {
    setStep(
      "This is a gas-free signature to privately reveal your scouted intelligence. It does not transfer tokens or spend your funds."
    );
    const [lootHandle, alarmHandle] = await readContract.getVaultHandles(matchId, round, p.vaultIdx);
    const value = await userDecryptHandle(
      p.kind === "alarm" ? alarmHandle : lootHandle,
      CONTRACT_ADDRESS,
      signer
    );
    // A fresh reveal from direct decryption: run the cipher scramble + blip.
    setScoutAnimate(true);
    playReveal();
    setScouted({ vaultIdx: p.vaultIdx, kind: p.kind, value: Number(value) });
    setPendingScout(null);
    void persistScout({ vaultIdx: p.vaultIdx, checkAlarm: p.kind === "alarm", value: Number(value) });
  }

  // The contract rejects because the match status onchain has already changed (e.g. already
  // Finished) while the UI still holds the old view: re-sync from
  // the chain instead of showing a confusing error.
  function isStaleStateError(err: any): boolean {
    const msg = String(err?.reason ?? err?.message ?? err ?? "");
    return /Match tidak aktif|Match sudah dimulai|Match penuh/.test(msg);
  }

  async function handleScout(idx: number, kind: "loot" | "alarm") {
    if (scoutStatus !== "verified-unused") return; // Batch 6: Scout only from the verified-unused status; "unknown" is never treated as unused
    setBusy(true);
    playClick(); // Batch 5: interaction click only; the sonar confirmation comes after the tx succeeds
    try {
      setStep("Sending Scout transaction (needs Sepolia gas), granting decryption access only to your wallet…");
      // Batch 6.1: separate failures BEFORE broadcast (wallet rejects /
      // send fails: no hash yet, the old behavior is kept)
      // from ambiguity AFTER broadcast (a hash exists but
      // tx.wait() failed to read the receipt: the transaction may already be in
      // a block). In the second condition the Scout status is forced to "unknown" and
      // the hash is stored for display; the UI never guesses Scout is
      // unused and never resends. The onchain event verification
      // (the Retry check button) decides the real status,
      // including if the tx turns out to have reverted (a conclusive not-found ->
      // verified-unused).
      let tx: any = null;
      try {
        tx = await contract.scoutVault(matchId, idx, kind === "alarm");
        await tx.wait();
      } catch (txErr: any) {
        if (tx) {
          setScoutStatus("unknown");
          storeUnconfirmedTx(await captureUnconfirmedTx("scout", tx)); // Batch 6.2: the nonce is stored so the hash gate can recognize a replacement tx. Batch 6.3: the record carries the full context identity and is persisted via storeUnconfirmedTx
          return;
        }
        throw txErr;
      }
      playSonar(); // Batch 5: confirmation, the Scout transaction is recorded onchain
      setScoutStatus("verified-used"); // Batch 6: this session transaction's receipt is conclusive proof Scout was used
      // From the moment this transaction is recorded, the onchain budget = 9. Mark it NOW,
      // before decryption is attempted, so the UI never desyncs from the contract.
      const p = { vaultIdx: idx, kind };
      setPendingScout(p);
      void persistScout({ vaultIdx: idx, checkAlarm: kind === "alarm", value: null });
      if (matchInfo.vsBot) setDialogue("Trying to peek behind our doors?");
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

  // After the commit: re-read the match; if the round is done, publicly decrypt its result
  const collectResolution = useCallback(
    async (playedRound: number, quiet = false): Promise<boolean> => {
      const updated = await fetchMatch(readContract, matchId);
      const resolved = updated.currentRound !== playedRound || updated.state === 2;
      if (!resolved) return false;

      if (!quiet) setStep("Decrypting public round results (alarms & scores)…");
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
      setOutcomes(alarms); // the vault doors open per this round's outcome (presentation only)
      const s1 = Number(clear[updated.score1Handle] as any);
      const s2 = Number(clear[updated.score2Handle] as any);
      const mapped = myPlayer === 1 ? { you: s1, opp: s2 } : { you: s2, opp: s1 };
      // Batch 5: store this resolution result so handleSubmit can trigger
      // the cinematic overlay. The refresh/recovery paths also fill this ref,
      // but never read it for the overlay.
      resolutionRef.current = { round: playedRound, alarms, mapped };
      // A coin chime if the player's score rose this round. `scores` here is
      // the round-start score (the arena remounts every round), the right baseline.
      if (mapped.you > scores.you) playCoin();
      onRoundResolved({ matchId, round: playedRound, alarms, scoreYou: mapped.you, scoreOpp: mapped.opp }, updated, mapped);
      return true;
    },
    [contract, matchId, myPlayer, onRoundResolved]
  );

  // Batch 6.3.6: a gas floor for submitAllocation. A commit that triggers
  // round resolution (the second commit, or Solo mode, which always resolves)
  // executes far more than an ordinary commit: measured on
  // Sepolia, an ordinary commit estimates ~1,87 million gas while a
  // resolution-triggering commit uses ~5,4 million. The wallet's estimation runs against
  // the state at click time; if the opponent's commit lands first in the same
  // block, our transaction switches to the resolution branch with the old estimate's
  // limit and dies out of gas mid-way (proven twice
  // in the live QA of match #13 rounds 2 and 3, 23 Nov 2026: limit
  // 1.867.323, reverted; the retry estimated 8.193.696, succeeded).
  // This explicit floor closes that estimation race; what the player
  // pays remains the gas used, not the limit.
  const SUBMIT_ALLOCATION_GAS_LIMIT = 10_000_000;

  async function handleSubmit() {
    setBusy(true);
    playClick(); // Batch 5: interaction click only; the steel-lock confirmation comes after the tx succeeds
    try {
      const userAddress = await signer.getAddress();
      // Four-stage progress (Batch 1 #6) — driven by real async state, not a timer:
      // 1 FHE encryption running -> 2 awaiting the MetaMask signature ->
      // 3 awaiting tx.wait() -> 4 fetch state + publicDecrypt the round result.
      setSubmitStage(1);
      const { handles: encHandles, inputProof } = await encryptBids(CONTRACT_ADDRESS, userAddress, bids);

      setSubmitStage(2);
      // Batch 6.1: receipt ambiguity, same as handleScout. A failure
      // before a hash exists (wallet rejects / send fails) is passed to
      // the outer catch with the old behavior. A hash exists but tx.wait()
      // failed: the commit status is forced to "unknown" (LOCK IN stays locked,
      // the RETRY STATUS CHECK panel appears), the hash is stored for display
      // as an Etherscan link, and there is no automatic resubmission.
      // The AllocationCommitted event decides the real status.
      let tx: any = null;
      try {
        tx = await contract.submitAllocation(matchId, encHandles, inputProof, {
          gasLimit: SUBMIT_ALLOCATION_GAS_LIMIT,
        });
        setSubmitStage(3);
        await tx.wait();
      } catch (txErr: any) {
        if (tx) {
          setCommitStatus("unknown");
          storeUnconfirmedTx(await captureUnconfirmedTx("commit", tx)); // Batch 6.2: the nonce is stored so the hash gate can recognize a replacement tx. Batch 6.3: the record carries the full context identity and is persisted via storeUnconfirmedTx
          return;
        }
        throw txErr;
      }
      playLock(); // Batch 5: confirmation, the allocation is recorded onchain
      if (matchInfo.vsBot) setDialogue("Orders received. Let's see who's smarter.");

      setSubmitStage(4);
      let done = false;
      try {
        done = await collectResolution(round, true);
      } catch {
        // The commit transaction IS recorded onchain; only fetching
        // its result from the relayer failed. Do not leave a dead arena: show the recovery
        // panel so the result can be fetched again without a new transaction.
        done = false;
      }
      if (!done) {
        setWaitingOpp(true);
        setCommitStatus("committed"); // Batch 6: this session's commit transaction is recorded onchain
        setStep(null);
      } else {
        // Batch 5: cinematic reveal overlay, ONLY from this direct submit
        // path (handleRefresh/recovery never trigger it).
        // Its data is purely the just-completed collectResolution decryption result;
        // the delta is computed against the round-start score (the `scores` prop of this
        // round's arena instance).
        const res = resolutionRef.current;
        if (res && res.round === round) {
          const data: CinematicRevealData = {
            round,
            alarms: res.alarms,
            deltaYou: res.mapped.you - scores.you,
            deltaOpp: res.mapped.opp - scores.opp,
            totalYou: res.mapped.you,
            totalOpp: res.mapped.opp,
            oppLabel,
          };
          setCineReveal(data);
          // App remounts the arena when the round changes (the key contains the round):
          // hand the data to the next instance via the consume-once
          // hand-off. The final round does not change key because the match is
          // Finished, so the overlay displays from this instance's local state.
          if (round < 3) stashPendingReveal(matchId, data);
        }
      }
    } catch (err: any) {
      if (isStaleStateError(err)) onResync();
      else onError(friendlyError(err));
      setStep(null);
    } finally {
      setSubmitStage(0);
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

  const steps = ["1. Scout (Optional)", "2. Assign Agents", "3. Resolve Round"];

  return (
    <div className="rise-in mx-auto w-full max-w-6xl px-4 py-6">
      {/* Phase indicator */}
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
        <span className="ml-auto font-mono text-xs text-slate-500">OPERATION #{matchId}</span>
      </div>

      {/* Batch 6.3 addendum: storage-unavailable warning. Displayed
          for as long as the arena is open and the probe reports localStorage dead, so
          the player knows BEFORE sending a transaction that persistence is dead in
          this browser. Batch 6.3.2: the copy is aligned with the Batch 6.3.1
          fail-closed behavior — if the storage read fails, hydration
          fails, transaction-status verification cannot proceed
          safely, and actions that need verification stay locked at
          "unknown". This warning itself locks nothing; what
          locks is that fail-closed hydration path. */}
      {!pendingTxStorageAvailable && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            Browser storage is unavailable in this browser. Transaction status cannot be
            verified safely, so actions that need verification stay locked, and refreshing
            while a transaction is confirming is unsafe.
          </span>
        </div>
      )}

      {/* Batch 6.3.2: recovery warning for a persisted record that exists
          but fails validation. While this note is shown, the related kind
          stops at "unknown" (fail-closed): the hash gate and
          event scan are not run for it until hydration succeeds. */}
      {(hydrationWarning.commit || hydrationWarning.scout) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <TriangleAlert className="size-4 shrink-0" />
          <span>
            A saved transaction recovery record could not be validated, so actions stay
            locked for safety until it can be verified.
          </span>
        </div>
      )}

      {/* Syndicate AI dialogue (Solo mode only) */}
      {matchInfo.vsBot && dialogue && <SyndicateBar line={dialogue} />}

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
            <span>AGENTS READY</span>
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
              Total exceeds this round's agent budget ({maxBudget}). Reduce your assignment first.
            </p>
          )}
          {showConservativeBudgetNote && (
            <p className="mt-1.5 text-xs text-amber-300/90">
              Scout status is unverified. A conservative 9-agent budget is applied until synchronization completes.
            </p>
          )}
          {total === 0 && !finished && (
            <p className="mt-1.5 text-xs text-slate-500">Assign at least 1 agent to lock in.</p>
          )}
        </div>
      </div>

      {/* Vault cards */}
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
              scoutGate={
                scoutStatus === "syncing"
                  ? "syncing"
                  : scoutStatus === "unknown"
                    ? "unknown"
                    : "ready"
              }
              onRetryScoutSync={() => void restoreScoutStatus()}
              busy={busy}
              locked={waitingOpp || finished || commitStatus !== "verified-uncommitted"}
              outcome={outcomes ? (outcomes[idx] ? "alarm" : "safe") : null}
              scoutAnimate={scoutAnimate}
              onBidChange={setBid}
              onScout={handleScout}
            />
          );
        })}
      </div>

      {/* Scout recorded onchain but decryption has not succeeded yet -> offer a free retry */}
      {pendingScout && !scouted && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <Eye className="size-4 shrink-0" />
          <span>
            Your Scout is recorded onchain (this round's budget is now {maxBudget}), but the
            private decryption hasn't succeeded yet, the relayer is usually just slow.
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

      {/* Four-stage commit transaction progress (real async state, not a timer) */}
      {submitStage > 0 && <TxProgress stage={submitStage} />}

      {/* Step / status banner */}
      {step && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-cyan-400/30 bg-cyan-400/10 px-4 py-3 text-sm text-cyan-200">
          <Loader2 className="size-4 shrink-0 animate-spin" />
          <span className="font-mono">{step}</span>
        </div>
      )}

      {/* Batch 6: commit status unverified (RPC failed / scan
          inconclusive). Allocation controls stay locked so a player who
          has actually already committed is not tempted to attempt a second commit that would
          certainly revert; retry re-runs the event verification. */}
      {commitStatus === "unknown" && !finished && !waitingOpp && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <RefreshCw className="size-4 shrink-0" />
          <span>
            Your commit status could not be verified onchain, the RPC did not answer
            conclusively. Allocation stays locked until the check succeeds, so a round you
            already committed can never be committed twice by accident.
          </span>
          <button
            onClick={() => void checkCommitStatus()}
            className="ml-auto flex items-center gap-2 rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
          >
            <RefreshCw className="size-4" /> RETRY STATUS CHECK
          </button>
        </div>
      )}

      {/* Batch 6.1: the transaction was sent (hash exists) but the receipt
          is unconfirmed. The related status has been forced to "unknown" by
          the handler, so LOCK IN / Scout stay locked; this panel only
          explains and links the hash to Etherscan. The player is directed to
          the event-verification retry, not to resending the transaction.
          Batch 6.2: while the hash gate has not given certainty, the retry
          checks that hash's status first; if the last check
          found the transaction still pending, the panel copy says so
          explicitly. */}
      {unconfirmedTx && (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          <Send className="size-4 shrink-0" />
          <span>
            Your {unconfirmedTx.kind === "commit" ? "commit" : "Scout"} transaction{" "}
            {unconfirmedTxPending
              ? "is still pending and has not been mined yet"
              : "was sent but could not be confirmed yet"}:{" "}
            <a
              href={`https://sepolia.etherscan.io/tx/${unconfirmedTx.hash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-cyan-300 underline"
            >
              {unconfirmedTx.hash.slice(0, 10)}…{unconfirmedTx.hash.slice(-8)}
            </a>
            . Do not send it again. Use the retry status check instead; the onchain events
            decide the real status.
          </span>
          {/* Batch 6.3.1 (P1): per-transaction persistence warning.
              savePendingTx reported THIS transaction's record failed to save
              (storage refused at the time, or the capture identity was
              incomplete), so unlike the general probe warning above
              the arena: this specific transaction will not survive a
              refresh, even though the probe reported storage available. */}
          {txPersistenceWarning[unconfirmedTx.kind] && (
            <span className="flex items-center gap-2 font-semibold">
              <TriangleAlert className="size-4 shrink-0" />
              This transaction's recovery record could not be saved in this browser. Do not
              refresh until its status is confirmed.
            </span>
          )}
        </div>
      )}

      {waitingOpp && !finished ? (
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 py-3">
          <CheckCircle2 className="size-5 text-emerald-400" />
          <span className="text-sm text-slate-200">
            <span className="font-bold tracking-widest text-emerald-300">ORDERS LOCKED</span>
            {" · "}
            {matchInfo.vsBot
              ? "Allocation committed & encrypted. This round's results are still syncing from the relayer…"
              : oppCommitted === true
                ? "Both crews have committed. Round results are still syncing from the relayer…"
                : oppCommitted === false
                  ? "WAITING FOR OPPONENT: your opponent has not committed yet."
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
            disabled={busy || overBudget || total === 0 || commitStatus !== "verified-uncommitted"}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 py-3.5 text-base font-bold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
            LOCK IN &amp; START HEIST
          </button>
        )
      )}

      {finished && (
        <div className="mt-5 flex items-center gap-3 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-200">
          <Lock className="size-4" /> Match finished. Rewards were minted as confidential cLOOT
          (score × 100). Reveal your balance from the top bar.
        </div>
      )}

      {/* Batch 5: cinematic reveal overlay (pure presentation, see CinematicReveal.tsx) */}
      {cineReveal && <CinematicReveal data={cineReveal} onDone={closeReveal} />}
    </div>
  );
}
