// ---------------------------------------------------------------------------
// Unconfirmed-transaction persistence (Batch 6.3)
//
// Batch 6.1/6.2 stored the ambiguous-transaction record (hash exists,
// receipt not yet confirmed) only in GameArena state + a ref. A page
// refresh or a browser crash destroyed it, and post-reload verification
// fell back to relying only on event scans: a still-pending transaction
// has no event yet, so the Batch 6.1 duplicate-transaction window
// reopened just because of a reload. Batch 6.3 persists the same
// record to localStorage so the Batch 6.2 hash gate still applies
// after a reload.
//
// Principles:
// - localStorage here is ONLY a hint for finding the transaction.
//   Its contents are never treated as proof a transaction succeeded — the blockchain
//   remains the source of truth, and a record may only be deleted through the clear
//   path approved by the hash gate (status-0 receipt, matching event
//   in scan-strict mode, or a conclusive replacement branch).
// - The key AND the record contents are fully bound to one context:
//   (chainId, contractAddress, matchId, round, sender, kind). When
//   read back, every identity field inside the JSON is validated
//   against the requesting context; a record that does not match exactly
//   is ignored and left untouched — another wallet's / match's / round's record
//   is never read for this arena and never deleted by
//   this arena.
// - Only public transaction metadata is stored: { kind, hash, nonce,
//   matchId, round, sender, chainId, contractAddress, savedAt }. There is
//   never a private key, signature, or wallet credential here.
// - All access is wrapped in try/catch: if localStorage is unavailable
//   (private mode / quota), the degradation behavior is exactly Batch 6.2's
//   (the record lives only in session memory).
// ---------------------------------------------------------------------------

export interface PendingTxRecord {
  kind: "commit" | "scout";
  hash: string;
  nonce: number;
  matchId: number;
  round: number;
  sender: string; // sender wallet address, lowercase
  chainId: number;
  contractAddress: string; // game contract address, lowercase
  savedAt: number;
}

const PREFIX = "vaultheist:pendingtx:";

export function pendingTxKey(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): string {
  return `${PREFIX}${chainId}:${contractAddress.toLowerCase()}:${matchId}:${round}:${sender.toLowerCase()}:${kind}`;
}

// A record without a complete identity cannot be validated when read
// back, so it is not persisted at all; such a record
// lives only in session memory (Batch 6.2 behavior).
function hasCompleteIdentity(rec: PendingTxRecord): boolean {
  return (
    Number.isInteger(rec.chainId) &&
    rec.chainId > 0 &&
    typeof rec.sender === "string" &&
    /^0x[0-9a-f]{40}$/.test(rec.sender.toLowerCase())
  );
}

// Batch 6.3.1: the save result is now explicit (boolean). Previously this function
// silently swallowed every failure, so an ACTUAL per-record save
// failure (quota filled mid-session, or a capture identity that was
// incomplete) was invisible to the UI — the availability probe at arena
// start cannot detect it. true only if setItem truly
// succeeded; false if the identity is incomplete or the write failed.
// The caller (storeUnconfirmedTx in GameArena) uses this result to
// display a per-transaction persistence warning.
export function savePendingTx(rec: PendingTxRecord): boolean {
  if (!hasCompleteIdentity(rec)) return false;
  try {
    localStorage.setItem(
      pendingTxKey(rec.chainId, rec.contractAddress, rec.matchId, rec.round, rec.sender, rec.kind),
      JSON.stringify({
        ...rec,
        sender: rec.sender.toLowerCase(),
        contractAddress: rec.contractAddress.toLowerCase(),
      })
    );
    return true;
  } catch {
    /* localStorage unavailable / full: the record lives only in session memory (Batch 6.2) */
    return false;
  }
}

// Batch 6.3.1: a multi-result loader for the hydration path. The old loadPendingTx
// merged very different situations into the same null:
// "the storage read SUCCEEDED and there genuinely is no entry for this context"
// (conclusive: no record) and "the storage read itself FAILED"
// (getItem throws — storage unavailable). Hydration must distinguish
// the two: the first may proceed to the hash gate / event scan,
// the second must fail closed (unknown status), because a failed read
// is not proof that no record exists.
// Batch 6.3.2: "absent" is split further. An entry that EXISTS under this context key
// but is corrupt (JSON cannot be parsed) or fails identity
// validation is NOT proof that no transaction is pending — its contents cannot be
// trusted, and treating it as "no record" would open
// controls on top of something that cannot be verified. Classification:
//   "found"   — an entry exists and passes full identity validation.
//   "absent"  — the read succeeded; this context key genuinely has no
//               entry. Only this is conclusively "no record".
//   "invalid" — an entry EXISTS under this context key, but its JSON is corrupt or
//               even one of its identity fields fails validation.
//               Fail-closed: the entry is left untouched in storage (the loader
//               never deletes), the transaction status must not be
//               concluded from this apparent absence.
//   "error"   — getItem itself throws (storage unavailable).
export type PendingTxLoadResult =
  | { status: "found"; record: PendingTxRecord }
  | { status: "absent" }
  | { status: "invalid" }
  | { status: "error" };

export function loadPendingTxResult(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): PendingTxLoadResult {
  let raw: string | null;
  try {
    raw = localStorage.getItem(
      pendingTxKey(chainId, contractAddress, matchId, round, sender, kind)
    );
  } catch {
    return { status: "error" };
  }
  if (raw === null) return { status: "absent" };
  // An entry EXISTS under this context key. From this point, any failure
  // is NOT "absent": its contents cannot be trusted, so the result is "invalid"
  // and the caller (hydration) must fail closed. The entry is always left
  // untouched in storage; the loader never deletes.
  let o: any;
  try {
    o = JSON.parse(raw);
  } catch {
    return { status: "invalid" }; // corrupt JSON
  }
  // Validate ALL identity fields against the requesting context.
  // Even one mismatch -> the entry is invalid for this context.
  if (
    o?.kind === kind &&
    typeof o?.hash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(o.hash) &&
    Number.isInteger(o?.nonce) &&
    o.nonce >= 0 &&
    o?.matchId === matchId &&
    o?.round === round &&
    typeof o?.sender === "string" &&
    o.sender.toLowerCase() === sender.toLowerCase() &&
    o?.chainId === chainId &&
    typeof o?.contractAddress === "string" &&
    o.contractAddress.toLowerCase() === contractAddress.toLowerCase() &&
    typeof o?.savedAt === "number"
  ) {
    return {
      status: "found",
      record: {
        kind,
        hash: o.hash,
        nonce: o.nonce,
        matchId,
        round,
        sender: sender.toLowerCase(),
        chainId,
        contractAddress: contractAddress.toLowerCase(),
        savedAt: o.savedAt,
      },
    };
  }
  return { status: "invalid" };
}

export function loadPendingTx(
  chainId: number,
  contractAddress: string,
  matchId: number,
  round: number,
  sender: string,
  kind: "commit" | "scout"
): PendingTxRecord | null {
  // The old public behavior is kept for other callers: a record or
  // null. The hydration path uses loadPendingTxResult so it can fail closed.
  const res = loadPendingTxResult(chainId, contractAddress, matchId, round, sender, kind);
  return res.status === "found" ? res.record : null;
}

// Deletion is only called from the clear path approved by the Batch 6.2
// hash gate (via clearUnconfirmedTx in GameArena). There is no
// other removeItem path for this record.
export function clearPendingTx(rec: PendingTxRecord): void {
  try {
    localStorage.removeItem(
      pendingTxKey(rec.chainId, rec.contractAddress, rec.matchId, rec.round, rec.sender, rec.kind)
    );
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------
// Storage availability probe (Batch 6.3 addendum)
//
// savePendingTx silently swallows failures as a backstop, and
// that remains correct for the save path. But the UI must not imply
// that post-refresh recovery protection is active when persistence is
// actually dead (private mode, quota, storage disabled by the browser).
// This probe performs a REAL write + read-back + delete on a dedicated key
// and only returns true if that whole cycle succeeds. The result is
// cached at module level: storage availability does not change mid-
// session. The probe key is always deleted, so it leaves no residue.
// ---------------------------------------------------------------------------

const PROBE_KEY = "vaultheist:pendingtx:__probe__";
let storageAvailableCache: boolean | null = null;

export function isPendingTxStorageAvailable(): boolean {
  if (storageAvailableCache !== null) return storageAvailableCache;
  try {
    localStorage.setItem(PROBE_KEY, "1");
    const ok = localStorage.getItem(PROBE_KEY) === "1";
    localStorage.removeItem(PROBE_KEY);
    storageAvailableCache = ok;
  } catch {
    storageAvailableCache = false;
  }
  return storageAvailableCache;
}
