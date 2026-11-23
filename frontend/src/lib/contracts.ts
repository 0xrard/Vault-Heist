import { Contract, JsonRpcProvider, type Signer } from "ethers";
import VaultHeistArtifact from "../abi/VaultHeist.json";
import HeistLootTokenArtifact from "../abi/HeistLootToken.json";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
export const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS as string | undefined;

// All onchain reads (view calls) go through the verified public RPC,
// NOT through the user's built-in MetaMask RPC — a broken custom/built-in wallet RPC
// makes eth_call return empty data ("missing revert
// data") as if the contract did not exist. The wallet is only used for signatures
// and sending transactions.
export const SEPOLIA_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
export const readProvider = new JsonRpcProvider(SEPOLIA_RPC_URL);

export function getGameContract(signer: Signer): Contract {
  return new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, signer);
}

export function getGameReadContract(): Contract {
  return new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, readProvider);
}

export function getTokenContract(signer: Signer): Contract | null {
  if (!TOKEN_ADDRESS) return null;
  return new Contract(TOKEN_ADDRESS, HeistLootTokenArtifact.abi, signer);
}

export function getTokenReadContract(): Contract | null {
  if (!TOKEN_ADDRESS) return null;
  return new Contract(TOKEN_ADDRESS, HeistLootTokenArtifact.abi, readProvider);
}

export interface MatchInfo {
  player1: string;
  player2: string;
  vsBot: boolean;
  currentRound: number;
  state: number; // 0 WaitingPlayer, 1 Active, 2 Finished
  score1Handle: string;
  score2Handle: string;
}

export async function fetchMatch(contract: Contract, matchId: number): Promise<MatchInfo> {
  const m = await contract.matches(matchId);
  return {
    player1: m.player1,
    player2: m.player2,
    vsBot: m.vsBot,
    currentRound: Number(m.currentRound),
    state: Number(m.state),
    score1Handle: m.score1,
    score2Handle: m.score2,
  };
}

export interface UserMatch {
  id: number;
  info: MatchInfo;
}

// List of one wallet's matches: enumerate IDs from nextMatchId (newest
// first, bounded by maxScan to keep RPC calls light), then filter to those whose
// player1/player2 is this wallet. No event scan — public RPC nodes
// prune old log history, so direct enumeration is always complete.
export async function fetchUserMatches(
  contract: Contract,
  userAddress: string,
  maxScan = 60
): Promise<UserMatch[]> {
  const total = Number(await contract.nextMatchId());
  const from = Math.max(0, total - maxScan);
  const ids: number[] = [];
  for (let id = total - 1; id >= from; id--) ids.push(id);
  const me = userAddress.toLowerCase();
  const results = await Promise.all(
    ids.map(async (id) => ({ id, info: await fetchMatch(contract, id) }))
  );
  return results.filter(
    ({ info }) => info.player1.toLowerCase() === me || info.player2.toLowerCase() === me
  );
}

export interface RoundRecord {
  matchId: number;
  round: number;
  alarms: [boolean, boolean, boolean]; // per Vault A/B/C: true = the alarm went off
  alarmsKnown?: boolean; // false = this round's alarm-status decryption has not succeeded yet (relayer)
  scoreYou: number;
  scoreOpp: number;
}

// ---------------------------------------------------------------------------
// Anchored onchain event scanning (Batch 4 — Gameplay Reliability).
//
// Public RPCs reject overly wide eth_getLogs ranges, so all
// scans run in chunks. The anchor is the block of the
// MatchCreated(matchId) event: there is no "last N blocks window" search that
// could conclude absence before the match's entire history is scanned.
// A null result / conclusive:false means INCONCLUSIVE (anchor not
// found, or a chunk failed) — the caller must not
// conclude anything from that result.
// ---------------------------------------------------------------------------
export const LOG_CHUNK_BLOCKS = 10000;
const MAX_ANCHOR_CHUNKS = 48; // ~480 thousand blocks back to search for MatchCreated

// ---------------------------------------------------------------------------
// MatchCreated anchor-block cache (Batch 6, P1).
//
// Without the cache, every arena load scans backward from the latest block to
// find MatchCreated. A found block is stored in
// localStorage under a key bound to chainId + contract address + matchId.
// The cache is NEVER trusted blindly: before use, its block is
// validated cheaply with a MatchCreated query at exactly that stored block
// (the filter is already bound to matchId via topic). If validation finds the event
// at that block -> the cache is valid. If the query succeeds but is empty -> the cache is
// wrong/stale, discarded, and the full scan runs as before.
// If the validation query itself fails (RPC) -> the result is inconclusive
// (null), like any other scan failure.
// ---------------------------------------------------------------------------
const ANCHOR_CACHE_PREFIX = "vaultheist:anchor:";

function anchorCacheKey(chainId: number, contractAddress: string, matchId: number): string {
  return `${ANCHOR_CACHE_PREFIX}${chainId}:${contractAddress.toLowerCase()}:${matchId}`;
}

function loadAnchorCache(chainId: number, contractAddress: string, matchId: number): number | null {
  try {
    const raw = localStorage.getItem(anchorCacheKey(chainId, contractAddress, matchId));
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}

function saveAnchorCache(chainId: number, contractAddress: string, matchId: number, block: number): void {
  try {
    localStorage.setItem(anchorCacheKey(chainId, contractAddress, matchId), String(block));
  } catch {
    /* storage unavailable — ignore, the scan is still correct */
  }
}

function dropAnchorCache(chainId: number, contractAddress: string, matchId: number): void {
  try {
    localStorage.removeItem(anchorCacheKey(chainId, contractAddress, matchId));
  } catch {
    /* ignore */
  }
}

// The block where this match was created (the MatchCreated event), searched backward from
// the latest block in chunks (or from the verified cache, see above).
// null = not found within reach / RPC failed (inconclusive).
export async function findMatchCreatedBlock(
  contract: Contract,
  matchId: number
): Promise<number | null> {
  try {
    const provider: any = contract.runner;
    if (!provider?.getBlockNumber) return null;
    const filter = contract.filters.MatchCreated(matchId);

    // Batch 6: try the anchor cache first, with one-block validation.
    let cacheScope: { chainId: number; address: string } | null = null;
    try {
      const network = await provider.getNetwork();
      cacheScope = { chainId: Number(network.chainId), address: String(contract.target) };
    } catch {
      cacheScope = null; // no chain/contract identity, skip the cache
    }
    if (cacheScope) {
      const cached = loadAnchorCache(cacheScope.chainId, cacheScope.address, matchId);
      if (cached !== null) {
        let validation: any[];
        try {
          validation = await contract.queryFilter(filter, cached, cached);
        } catch {
          return null; // cache validation failed at the RPC -> inconclusive
        }
        if (validation.length > 0) return cached;
        dropAnchorCache(cacheScope.chainId, cacheScope.address, matchId);
      }
    }

    const latest: number = await provider.getBlockNumber();
    for (let i = 0; i < MAX_ANCHOR_CHUNKS; i++) {
      const to = latest - i * LOG_CHUNK_BLOCKS;
      if (to < 0) break;
      const from = Math.max(0, to - LOG_CHUNK_BLOCKS + 1);
      let logs: any[];
      try {
        logs = await contract.queryFilter(filter, from, to);
      } catch {
        return null; // chunk rejected by the RPC -> anchor inconclusive
      }
      if (logs.length > 0) {
        const block = Number(logs[0].blockNumber);
        if (cacheScope) saveAnchorCache(cacheScope.chainId, cacheScope.address, matchId, block);
        return block;
      }
      if (from === 0) break;
    }
    return null;
  } catch {
    return null;
  }
}

// Unix timestamp (seconds) of the block that created this match, via
// the anchored MatchCreated lookup above. null = the anchor could not
// be determined (outside the RPC's log reach, or an RPC failure).
export async function fetchMatchCreatedAt(
  contract: Contract,
  matchId: number
): Promise<number | null> {
  const block = await findMatchCreatedBlock(contract, matchId);
  if (block === null) return null;
  try {
    const provider: any = contract.runner;
    if (!provider?.getBlock) return null;
    const b = await provider.getBlock(block);
    return b ? Number(b.timestamp) : null;
  } catch {
    return null;
  }
}

// Scan events from fromBlock to toBlock in sequential chunks.
// Returns null if ANY chunk fails: the range is incomplete,
// so a "no events" conclusion is not valid.
export async function scanEventLogs(
  contract: Contract,
  filter: any,
  fromBlock: number,
  toBlock: number
): Promise<any[] | null> {
  const logs: any[] = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_CHUNK_BLOCKS) {
    const end = Math.min(toBlock, start + LOG_CHUNK_BLOCKS - 1);
    try {
      const part: any[] = await contract.queryFilter(filter, start, end);
      logs.push(...part);
    } catch {
      return null;
    }
  }
  return logs;
}

export interface RoundCommitState {
  mine: boolean; // this wallet has already committed this round (AllocationCommitted event)
  opponent: boolean; // the opponent has already committed this round
  conclusive: boolean; // false = the scan is incomplete, do not conclude anything
}

// Both players' commit status for one round, from the
// AllocationCommitted(matchId, round, player) event since the MatchCreated block.
// Used by GameArena to restore status after a refresh: without this,
// a player who already committed would see the LOCK IN button again and their transaction
// would revert in the contract.
export async function findRoundCommits(
  contract: Contract,
  matchId: number,
  round: number,
  myAddress: string,
  opponentAddress: string | null
): Promise<RoundCommitState> {
  const inconclusive: RoundCommitState = { mine: false, opponent: false, conclusive: false };
  try {
    const provider: any = contract.runner;
    if (!provider?.getBlockNumber) return inconclusive;
    const anchor = await findMatchCreatedBlock(contract, matchId);
    if (anchor === null) return inconclusive;
    const latest: number = await provider.getBlockNumber();
    const logs = await scanEventLogs(
      contract,
      contract.filters.AllocationCommitted(matchId),
      anchor,
      latest
    );
    if (logs === null) return inconclusive;
    const me = myAddress.toLowerCase();
    const opp = opponentAddress?.toLowerCase() ?? null;
    let mine = false;
    let opponent = false;
    for (const l of logs) {
      if (Number(l?.args?.round) !== round) continue;
      const p = String(l?.args?.player ?? "").toLowerCase();
      if (p === me) mine = true;
      if (opp && p === opp) opponent = true;
    }
    return { mine, opponent, conclusive: true };
  } catch {
    return inconclusive;
  }
}
