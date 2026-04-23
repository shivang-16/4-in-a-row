import { v4 as uuid } from 'uuid';

// ── Player ────────────────────────────────────────────────────
export interface WPPlayer {
  username: string;
  socketId: string;
  score: number;
  colorIndex: number; // 0-7 → maps to PLAYER_COLORS array
}

// ── Word ──────────────────────────────────────────────────────
export interface WPWord {
  id: string;
  word: string;
  cells: WPCell[]; // ordered list of cells that spell the word
  claimedBy: string | null; // username
  claimedAt: number | null; // ms timestamp
}

export interface WPCell {
  row: number;
  col: number;
}

// ── Game state (server-side) ───────────────────────────────────
export interface WPGameState {
  id: string;
  /** 2-D grid of uppercase letters */
  board: string[][];
  gridSize: number;
  words: WPWord[];
  players: WPPlayer[];
  wordCount: number;
  status: 'playing' | 'ended';
  startedAt: number;
  endedAt?: number;
  /** For rematch: same group of players */
  partyId?: string;
}

// ── Room (lobby) ───────────────────────────────────────────────
export interface WPRoom {
  code: string;
  hostUsername: string;
  members: Map<string, import('socket.io').Socket>;
  wordCount: number; // 10-20, configurable by host
}

// ── Socket event payloads (client → server) ───────────────────
export interface WPJoinPayload      { username: string }
export interface WPRoomCreatePayload { username: string }
export interface WPRoomJoinPayload  { username: string; roomCode: string }
export interface WPRoomStartPayload { wordCount?: number }
export interface WPWordCountPayload { wordCount: number }
export interface WPClaimPayload     { gameId: string; startRow: number; startCol: number; endRow: number; endCol: number }
export interface WPReconnectPayload { gameId: string; username: string }

// ── Utility: generate a 6-char room code ──────────────────────
export function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── Utility: fresh ID ─────────────────────────────────────────
export { uuid };

// ── Scoring ───────────────────────────────────────────────────
/** Points awarded when a player claims a word: length × 10 */
export function scoreForWord(word: string): number {
  return word.length * 10;
}

// ── Player colour palette (8 slots) ───────────────────────────
export const PLAYER_COLORS = [
  '#f87171', // red
  '#60a5fa', // blue
  '#4ade80', // green
  '#fbbf24', // yellow
  '#a78bfa', // purple
  '#f472b6', // pink
  '#34d399', // teal
  '#fb923c', // orange
] as const;
