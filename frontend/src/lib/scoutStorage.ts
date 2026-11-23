import type { Contract } from "ethers";
import { findMatchCreatedBlock, scanEventLogs } from "./contracts";

// ---------------------------------------------------------------------------
// Scout persistence (Batch 1, deliverable 7)
//
// Stores Scout decryption results in localStorage so they are not lost when
// the page is refreshed. Security principles:
// - localStorage is ONLY a browser convenience — not a replacement for the FHE ACL. A cached
//   value is not displayed before the Scout status is verified against the onchain state
//   (the VaultScouted event) via findScoutOnchain().
// - ONLY scout-result metadata is stored: { vaultIdx, checkAlarm, value,
//   savedAt }. There is never a private key, EIP-712 signature, or
//   wallet credential here.
// - value === null means the Scout transaction is already recorded onchain but
//   its decryption has not succeeded yet (slow relayer) — the user can retry the decryption
//   for free without a new transaction.
// ---------------------------------------------------------------------------

export interface ScoutCacheEntry {
  vaultIdx: number;
  checkAlarm: boolean;
  value: number | null;
  savedAt: number;
}

const PREFIX = "vaultheist:scout:";
const MAX_ENTRIES = 20;
const TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export function scoutStorageKey(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): string {
  return `${PREFIX}${contractAddress.toLowerCase()}:${matchId}:${round}:${walletAddress.toLowerCase()}`;
}

function allScoutKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
  } catch {
    /* localStorage unavailable */
  }
  return keys;
}

function parseEntry(raw: string | null): ScoutCacheEntry | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (
      typeof o?.vaultIdx === "number" &&
      o.vaultIdx >= 0 &&
      o.vaultIdx <= 2 &&
      typeof o?.checkAlarm === "boolean" &&
      (o?.value === null || typeof o?.value === "number") &&
      typeof o?.savedAt === "number"
    ) {
      return o as ScoutCacheEntry;
    }
  } catch {
    /* corrupt entry -> ignore */
  }
  return null;
}

export function loadScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): ScoutCacheEntry | null {
  try {
    return parseEntry(
      localStorage.getItem(scoutStorageKey(contractAddress, matchId, round, walletAddress))
    );
  } catch {
    return null;
  }
}

export function saveScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string,
  data: { vaultIdx: number; checkAlarm: boolean; value: number | null }
): void {
  try {
    const entry: ScoutCacheEntry = { ...data, savedAt: Date.now() };
    localStorage.setItem(
      scoutStorageKey(contractAddress, matchId, round, walletAddress),
      JSON.stringify(entry)
    );
    enforceRetention();
  } catch {
    /* quota / unavailable — ignore, the Scout is still recorded onchain */
  }
}

export function clearScout(
  contractAddress: string,
  matchId: number,
  round: number,
  walletAddress: string
): void {
  try {
    localStorage.removeItem(scoutStorageKey(contractAddress, matchId, round, walletAddress));
  } catch {
    /* ignore */
  }
}

// Delete all Scout entries (all rounds) for one match + wallet — called
// when the match reaches Finished (state === 2).
export function pruneMatchScouts(
  contractAddress: string,
  matchId: number,
  walletAddress: string
): void {
  const c = contractAddress.toLowerCase();
  const w = walletAddress.toLowerCase();
  try {
    for (const k of allScoutKeys()) {
      const parts = k.split(":"); // [vaultheist, scout, contract, matchId, round, wallet]
      if (parts.length === 6 && parts[2] === c && Number(parts[3]) === matchId && parts[5] === w) {
        localStorage.removeItem(k);
      }
    }
  } catch {
    /* ignore */
  }
}

// Global retention bound: drop expired entries (TTL) and cap the total number of
// entries (oldest dropped first) so storage does not grow without bound.
export function enforceRetention(): void {
  try {
    const now = Date.now();
    const entries: { key: string; savedAt: number }[] = [];
    for (const k of allScoutKeys()) {
      const e = parseEntry(localStorage.getItem(k));
      if (!e || now - e.savedAt > TTL_MS) {
        localStorage.removeItem(k);
      } else {
        entries.push({ key: k, savedAt: e.savedAt });
      }
    }
    entries.sort((a, b) => b.savedAt - a.savedAt);
    for (const extra of entries.slice(MAX_ENTRIES)) {
      localStorage.removeItem(extra.key);
    }
  } catch {
    /* ignore */
  }
}

// Migration of the old format (`vh-scout-${matchId}-${round}` -> { scouted | pendingScout })
// to the new format scoped per contract + wallet. The old key is always deleted;
// the onchain verification afterwards decides whether the migrated value is trusted.
export function migrateLegacyScout(
  matchId: number,
  round: number,
  contractAddress: string,
  walletAddress: string
): void {
  const legacyKey = `vh-scout-${matchId}-${round}`;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    localStorage.removeItem(legacyKey);
    if (loadScout(contractAddress, matchId, round, walletAddress)) return;
    const saved = JSON.parse(raw);
    if (saved?.scouted) {
      saveScout(contractAddress, matchId, round, walletAddress, {
        vaultIdx: Number(saved.scouted.vaultIdx),
        checkAlarm: saved.scouted.kind === "alarm",
        value: Number(saved.scouted.value),
      });
    } else if (saved?.pendingScout) {
      saveScout(contractAddress, matchId, round, walletAddress, {
        vaultIdx: Number(saved.pendingScout.vaultIdx),
        checkAlarm: saved.pendingScout.kind === "alarm",
        value: null,
      });
    }
  } catch {
    /* old format invalid — ignore */
  }
}

// ---------------------------------------------------------------------------
// Onchain verification: the only public proof that this wallet actually
// performed a Scout in this round is the event
//   VaultScouted(matchId, round, player, vaultIdx, isAlarm)
// (the RoundData.p1Scouted/p2Scouted state in the contract is private; there is no
// public getter).
//
// Batch 4 (P0-B): the scan is ANCHORED at the MatchCreated block and walks
// forward to the latest block in chunks (see lib/contracts.ts). Previously
// the search used a shrinking trailing-block window and concluded
// "not found" as soon as one query succeeded empty — even though the Scout event could
// be older than that window while the cache was still valid (14-day
// TTL), so a valid cache was deleted and Scout looked unused.
// Now { found: false } is only returned after the ENTIRE range
// since MatchCreated has been scanned successfully. Returns:
//   { found: true, vaultIdx, checkAlarm } — event found, the chain wins
//   { found: false }                      — CONCLUSIVE: the entire range since
//                                           MatchCreated was scanned, there is no
//                                           Scout event for this round
//   null                                  — INCONCLUSIVE (anchor not
//                                           found / an RPC chunk
//                                           failed) -> the caller MUST fall
//                                           back to the cache, must not delete
//                                           the cache, must not conclude Scout is
//                                           unused yet
// ---------------------------------------------------------------------------
export type ScoutChainResult =
  | { found: true; vaultIdx: number; checkAlarm: boolean }
  | { found: false }
  | null;

export async function findScoutOnchain(
  readContract: Contract,
  matchId: number,
  round: number,
  walletAddress: string
): Promise<ScoutChainResult> {
  try {
    const provider: any = readContract.runner;
    if (!provider?.getBlockNumber) return null;
    const anchor = await findMatchCreatedBlock(readContract, matchId);
    if (anchor === null) return null; // no anchor, no valid conclusion
    const latest: number = await provider.getBlockNumber();
    const logs = await scanEventLogs(
      readContract,
      // Batch 6.3.5 (P0): Ethers v6 filter arguments are POSITIONAL across ALL
      // event parameters, not only the indexed ones. The original signature:
      // VaultScouted(matchId indexed, round, player indexed, vaultIdx,
      // isAlarm) — so the wallet address must be in the third position with
      // null for round (non-indexed) in the second position:
      // (matchId, null, walletAddress). The two-argument form
      // (matchId, walletAddress) puts the address in the round slot and Ethers
      // throws "cannot filter non-indexed parameters" — that is why
      // Scout verification was always inconclusive since Batch 6. Round
      // filtering is still done from the log args below.
      readContract.filters.VaultScouted(matchId, null, walletAddress),
      anchor,
      latest
    );
    if (logs === null) return null; // incomplete range -> inconclusive
    const mine = logs.filter((l) => Number(l?.args?.round) === round);
    if (mine.length > 0) {
      const a = mine[mine.length - 1].args;
      return { found: true, vaultIdx: Number(a.vaultIdx), checkAlarm: Boolean(a.isAlarm) };
    }
    return { found: false };
  } catch {
    return null;
  }
}
