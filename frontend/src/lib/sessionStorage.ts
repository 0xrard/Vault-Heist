import { CONTRACT_ADDRESS } from "./contracts";
import { SEPOLIA_CHAIN_ID } from "./fhe";

// ---------------------------------------------------------------------------
// Active-match session hint (Batch 6.3.8)
//
// Before this batch, App.tsx kept the current screen / matchId / signer
// only in React state, so every page refresh dropped the player back to
// the lobby and demanded a manual Connect click — even though the wallet
// still remembered the site authorization. Batch 6.3.8 persists a minimal
// session hint so a refresh can silently reconnect (eth_accounts, never a
// prompt) and offer to restore the arena.
//
// Principles (same discipline as lib/pendingTxStorage.ts):
// - localStorage here is ONLY a hint about where the player was. It is
//   never treated as proof of anything — on load, the hint is acted on
//   solely after the chain itself confirms the match is still Active,
//   and re-entry goes through the existing resume() path, which
//   re-validates participation and rebuilds scores/history from chain.
// - The key is bound to one context: (chainId, contractAddress). The
//   record itself carries the wallet address, and the restore path only
//   honors a hint whose address matches the silently reconnected
//   account; a hint left by another wallet is never used to enter a
//   match (it is discarded instead).
// - Only public session metadata is stored: { matchId, address }. There
//   is never a private key, signature, or wallet credential here.
// - All access is wrapped in try/catch and never throws: if localStorage
//   is unavailable (private mode / quota / blocked), every function
//   degrades to the pre-6.3.8 behavior — no hint, no restore, the app
//   behaves exactly as before.
// - A separate "user disconnected" marker (addendum to this batch)
//   records an EXPLICIT Disconnect click, so the silent reconnect
//   honors it on later page loads instead of quietly undoing the
//   user's choice. A manual Connect clears the marker: an explicit
//   connect is a fresh opt-in, and silent reconnect/restore resume
//   from that point on.
// ---------------------------------------------------------------------------

export interface SessionHint {
  matchId: number;
  address: string; // wallet address that was in the arena, lowercase
}

const PREFIX = "vaultheist:session:";
const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

export function sessionHintKey(): string {
  return `${PREFIX}${Number(SEPOLIA_CHAIN_ID)}:${CONTRACT_ADDRESS.toLowerCase()}`;
}

// A hint without a complete, valid identity cannot be trusted when read
// back, so it is not persisted at all (same rule as pendingTxStorage).
export function saveSessionHint(matchId: number, address: string): boolean {
  try {
    if (!Number.isInteger(matchId) || matchId <= 0) return false;
    if (typeof address !== "string" || !ADDRESS_RE.test(address)) return false;
    const rec: SessionHint = { matchId, address: address.toLowerCase() };
    localStorage.setItem(sessionHintKey(), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

// Full validation on read: the JSON must parse to an object whose
// matchId is a positive integer and whose address is a well-formed
// wallet address. Anything else (missing key, empty string, corrupt
// JSON, wrong shapes) reads as "no hint" — null. Note the raw value is
// compared against null, not falsiness: an empty string is a corrupt
// record, not an absent one (the Batch 6.3.3 lesson), and it fails
// validation through JSON.parse like any other corrupt value.
export function loadSessionHint(): SessionHint | null {
  try {
    const raw = localStorage.getItem(sessionHintKey());
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { matchId, address } = parsed as { matchId?: unknown; address?: unknown };
    if (typeof matchId !== "number" || !Number.isInteger(matchId) || matchId <= 0) return null;
    if (typeof address !== "string" || !ADDRESS_RE.test(address)) return null;
    return { matchId, address: address.toLowerCase() };
  } catch {
    return null;
  }
}

export function clearSessionHint(): void {
  try {
    localStorage.removeItem(sessionHintKey());
  } catch {
    /* storage unavailable — nothing to clear, ignore */
  }
}

// ---------------------------------------------------------------------------
// "User disconnected" opt-out marker (Batch 6.3.8 addendum)
//
// Silent reconnect exists to undo ACCIDENTAL disconnects (a refresh),
// never DELIBERATE ones. When the user clicks Disconnect, this marker
// is written under the same (chainId, contractAddress) context binding
// as the session hint; the mount-time silent reconnect checks it FIRST
// and stays disconnected while it is set. A manual Connect clears it
// (see ensureWallet in App.tsx). Same never-throw discipline as above:
// if storage is unavailable the marker simply cannot persist, and a
// disconnect degrades to lasting only for the current page session.
// ---------------------------------------------------------------------------

const DISCONNECTED_PREFIX = "vaultheist:disconnected:";

export function disconnectedMarkerKey(): string {
  return `${DISCONNECTED_PREFIX}${Number(SEPOLIA_CHAIN_ID)}:${CONTRACT_ADDRESS.toLowerCase()}`;
}

export function setDisconnectedMarker(): boolean {
  try {
    localStorage.setItem(disconnectedMarkerKey(), "1");
    return true;
  } catch {
    return false;
  }
}

export function isDisconnectedMarkerSet(): boolean {
  try {
    return localStorage.getItem(disconnectedMarkerKey()) === "1";
  } catch {
    return false;
  }
}

export function clearDisconnectedMarker(): void {
  try {
    localStorage.removeItem(disconnectedMarkerKey());
  } catch {
    /* storage unavailable — nothing to clear, ignore */
  }
}
