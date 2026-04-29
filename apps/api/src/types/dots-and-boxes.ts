import { Socket } from 'socket.io';
import { v4 as uuid } from 'uuid';

export type LineOwner = number | null; // 0-based player index, or null if not yet drawn

export const DAB_PLAYER_COLORS = [
  '#f87171', // red
  '#60a5fa', // blue
  '#4ade80', // green
  '#fbbf24', // yellow
  '#a78bfa', // purple
  '#f472b6', // pink
  '#34d399', // teal
  '#fb923c', // orange
] as const;

export interface DABRoom {
  code: string;
  hostUsername: string;
  members: Map<string, Socket>;
  gridRows: number;   // number of box-rows
  gridCols: number;   // number of box-cols
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'ended';
  // Active game state
  gameId?: string;
  partyId?: string;
  players?: string[];       // usernames in turn-order
  hLines?: LineOwner[][];   // (rows+1) x cols — horizontal edges
  vLines?: LineOwner[][];   // rows x (cols+1) — vertical edges
  boxes?: LineOwner[][];    // rows x cols — who claimed each box
  scores?: number[];        // per-player score (boxes claimed)
  currentTurn?: number;     // index into players[]
  winner?: string | null;   // username or 'tie'
}

// Room code generator (shared with word-puzzle pattern)
export function generateDABRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export { uuid };

export function initDABGame(rows: number, cols: number, numPlayers: number): {
  gameId: string;
  hLines: LineOwner[][];
  vLines: LineOwner[][];
  boxes: LineOwner[][];
  scores: number[];
  currentTurn: number;
} {
  const hLines: LineOwner[][] = Array.from({ length: rows + 1 }, () =>
    new Array(cols).fill(null)
  );
  const vLines: LineOwner[][] = Array.from({ length: rows }, () =>
    new Array(cols + 1).fill(null)
  );
  const boxes: LineOwner[][] = Array.from({ length: rows }, () =>
    new Array(cols).fill(null)
  );
  return {
    gameId: uuid(),
    hLines,
    vLines,
    boxes,
    scores: new Array(numPlayers).fill(0),
    currentTurn: 0,
  };
}
