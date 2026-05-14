import { Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';

export type SudokuDifficulty = 'easy' | 'medium' | 'hard';

export interface SudokuPlayer {
  username: string;
  colorIndex: number;
  isBot: boolean;
  rank: number | null;
  completedAt: number | null;
  hintsUsed: number;
  // Sparse map of cell overrides: "r,c" → digit (1-9)
  moves: Map<string, number>;
  // How many cells player has correctly filled
  filledCount: number;
}

export interface SudokuGameState {
  id: string;
  players: SudokuPlayer[];
  /** The full solved grid (9×9, 1-9) */
  solution: number[][];
  /** The puzzle given cells — 0 means blank */
  puzzle: number[][];
  /** Total pre-filled cells */
  givenCount: number;
  difficulty: SudokuDifficulty;
  status: 'playing' | 'completed';
  winner: string | null;
  rankings: { username: string; rank: number; completedAt: number | null; hintsUsed: number }[];
  startedAt: Date;
  endedAt?: Date;
  isBot: boolean;
  botUsername?: string;
}

export interface SudokuRoom {
  code: string;
  hostUsername: string;
  members: Map<string, Socket>;
  maxPlayers: number;
  difficulty: SudokuDifficulty;
  status: 'lobby' | 'playing' | 'ended';
  gameId?: string;
  gameState?: SudokuGameState;
}

export function generateSudokuRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export { uuid };
