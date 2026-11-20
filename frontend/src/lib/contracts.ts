import { Contract, type Signer } from "ethers";
import VaultHeistArtifact from "../abi/VaultHeist.json";
import HeistLootTokenArtifact from "../abi/HeistLootToken.json";

export const CONTRACT_ADDRESS = import.meta.env.VITE_CONTRACT_ADDRESS as string;
export const TOKEN_ADDRESS = import.meta.env.VITE_TOKEN_ADDRESS as string | undefined;

export function getGameContract(signer: Signer): Contract {
  return new Contract(CONTRACT_ADDRESS, VaultHeistArtifact.abi, signer);
}

export function getTokenContract(signer: Signer): Contract | null {
  if (!TOKEN_ADDRESS) return null;
  return new Contract(TOKEN_ADDRESS, HeistLootTokenArtifact.abi, signer);
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

export interface RoundRecord {
  round: number;
  alarms: [boolean, boolean, boolean]; // per Vault A/B/C: true = alarm berbunyi
  scoreYou: number;
  scoreOpp: number;
}
