/** Default size for classic 2-player games */
export const ROWS = 6;
export const COLS = 7;

export enum CellValue {
  EMPTY = 0,
  PLAYER1 = 1,
  PLAYER2 = 2,
  PLAYER3 = 3,
  PLAYER4 = 4,
  PLAYER5 = 5,
  PLAYER6 = 6,
  PLAYER7 = 7,
  PLAYER8 = 8,
}

/** Max human (or human+bot) slots for one game; matches CellValue.PLAYER1..PLAYER8 */
export const MAX_PLAYERS_PER_GAME = 8;

/** Larger boards for 3+ players (still connect-four). Capped so UI stays reasonable. */
export function boardSizeForPlayerCount(playerCount: number): { rows: number; cols: number } {
  const n = Math.max(2, Math.min(MAX_PLAYERS_PER_GAME, Math.floor(playerCount)));
  const rows = Math.min(14, 6 + Math.ceil((n - 2) * 1.2));
  const cols = Math.min(16, 7 + (n - 2) * 2);
  return { rows, cols };
}

export function slotIndexToCellValue(index: number): CellValue {
  const v = index + 1;
  if (v < 1 || v > MAX_PLAYERS_PER_GAME) {
    throw new Error(`Invalid player slot ${index}`);
  }
  return v as CellValue;
}

export function cellValueToSlotIndex(cv: CellValue): number {
  return Number(cv) - 1;
}

export enum GameStatus {
  WAITING = 'waiting',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  FORFEITED = 'forfeited',
}

export enum WinReason {
  HORIZONTAL = 'horizontal',
  VERTICAL = 'vertical',
  DIAGONAL = 'diagonal',
  DRAW = 'draw',
  FORFEIT = 'forfeit',
  OPPONENT_DISCONNECT = 'opponent_disconnect',
  /** 3+ players: board full; one player has the highest 4-in-a-row count */
  MOST_POINTS = 'most_points',
  /** 3+ players: board full; top score is tied */
  SCORE_TIE = 'score_tie',
}

export type Board = CellValue[][];

export interface Position {
  row: number;
  col: number;
}

export interface Player {
  id: string;
  username: string;
  isBot: boolean;
  connected: boolean;
  disconnectedAt?: Date;
}

export interface GameState {
  id: string;
  board: Board;
  rows: number;
  cols: number;
  /** Turn order: index 0 = PLAYER1, 1 = PLAYER2, … */
  players: Player[];
  currentTurn: CellValue;
  status: GameStatus;
  winner: string | null;
  winReason: WinReason | null;
  moves: Move[];
  startedAt: Date;
  endedAt?: Date;
  /** Started from Play with Friends lobby (not random matchmaking) */
  isInviteGame?: boolean;
  /** Stable id for the same group across rematches (invite games only) */
  partyId?: string;
  /** When true (3+ human players), 4-in-a-rows add points; game ends when board is full */
  scoringMode?: boolean;
  /** Points per player index (same order as players); used when scoringMode */
  scores?: number[];
}

export interface Move {
  player: string;
  column: number;
  row: number;
  timestamp: Date;
}

export interface MoveResult {
  success: boolean;
  row?: number;
  /** Set when four-in-a-row is achieved for this disc color */
  winningPlayer?: CellValue;
  winReason?: WinReason;
  winningCells?: Position[];
  isDraw?: boolean;
  error?: string;
  /** Scoring mode: how many distinct lines of ≥4 this placement completed */
  linesScored?: number;
  /** Scoring mode: board is full — resolve winner by scores */
  scoringGameOver?: boolean;
}
