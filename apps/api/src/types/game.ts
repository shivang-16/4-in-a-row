export const ROWS = 6;
export const COLS = 7;

export enum CellValue {
  EMPTY = 0,
  PLAYER1 = 1,
  PLAYER2 = 2,
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
  player1: Player;
  player2: Player;
  currentTurn: CellValue;
  status: GameStatus;
  winner: string | null;
  winReason: WinReason | null;
  moves: Move[];
  startedAt: Date;
  endedAt?: Date;
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
  winner?: string;
  winReason?: WinReason;
  isDraw?: boolean;
  error?: string;
}
