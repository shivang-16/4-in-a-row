import { v4 as uuidv4 } from 'uuid';
import { SudokuGameState, SudokuPlayer, SudokuDifficulty } from '../types/sudoku';

// How many cells to REMOVE for each difficulty (out of 81)
const HOLES: Record<SudokuDifficulty, number> = {
  easy: 36,
  medium: 46,
  hard: 56,
};

// ── Puzzle generation ────────────────────────────────────────────────────────

function shuffleArr<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

/** Returns true if placing `num` at (r,c) is valid in grid */
function isValid(grid: number[][], r: number, c: number, num: number): boolean {
  // Row
  if (grid[r]!.includes(num)) return false;
  // Col
  for (let i = 0; i < 9; i++) if (grid[i]![c] === num) return false;
  // Box
  const br = Math.floor(r / 3) * 3;
  const bc = Math.floor(c / 3) * 3;
  for (let i = br; i < br + 3; i++)
    for (let j = bc; j < bc + 3; j++)
      if (grid[i]![j] === num) return false;
  return true;
}

/** Fill grid with a complete valid Sudoku solution using backtracking */
function fillGrid(grid: number[][]): boolean {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c] === 0) {
        const nums = shuffleArr([1, 2, 3, 4, 5, 6, 7, 8, 9]);
        for (const n of nums) {
          if (isValid(grid, r, c, n)) {
            grid[r]![c] = n;
            if (fillGrid(grid)) return true;
            grid[r]![c] = 0;
          }
        }
        return false;
      }
    }
  }
  return true;
}

/** Count solutions (cap at 2 to check uniqueness quickly) */
function countSolutions(grid: number[][], limit = 2): number {
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r]![c] === 0) {
        let count = 0;
        for (let n = 1; n <= 9; n++) {
          if (isValid(grid, r, c, n)) {
            grid[r]![c] = n;
            count += countSolutions(grid, limit - count);
            grid[r]![c] = 0;
            if (count >= limit) return count;
          }
        }
        return count;
      }
    }
  }
  return 1; // solved
}

function deepCopy(grid: number[][]): number[][] {
  return grid.map((r) => [...r]);
}

/** Generate a puzzle with a unique solution for the given difficulty */
export function generatePuzzle(difficulty: SudokuDifficulty): { solution: number[][]; puzzle: number[][] } {
  // Build full solution
  const solution = Array.from({ length: 9 }, () => new Array(9).fill(0));
  fillGrid(solution);

  const puzzle = deepCopy(solution);
  const positions = shuffleArr(
    Array.from({ length: 81 }, (_, i) => i)
  );

  let holes = HOLES[difficulty];
  for (const pos of positions) {
    if (holes === 0) break;
    const r = Math.floor(pos / 9);
    const c = pos % 9;
    const backup = puzzle[r]![c]!;
    puzzle[r]![c] = 0;

    // Ensure uniqueness
    const copy = deepCopy(puzzle);
    if (countSolutions(copy) !== 1) {
      puzzle[r]![c] = backup; // restore
    } else {
      holes--;
    }
  }

  return { solution, puzzle };
}

// ── Service ──────────────────────────────────────────────────────────────────

export interface SudokuMoveResult {
  success: boolean;
  error?: string;
  correct?: boolean;
  conflict?: boolean;
  completed?: boolean;
  gameOver?: boolean;
  winner?: string | null;
  rankings?: { username: string; rank: number; completedAt: number | null; hintsUsed: number }[];
}

export interface SudokuHintResult {
  success: boolean;
  error?: string;
  row?: number;
  col?: number;
  value?: number;
  hintsUsed?: number;
}

class SudokuService {
  private games: Map<string, SudokuGameState> = new Map();

  createGame(
    players: { username: string; isBot?: boolean }[],
    difficulty: SudokuDifficulty,
  ): SudokuGameState {
    const gameId = uuidv4();
    const { solution, puzzle } = generatePuzzle(difficulty);
    const givenCount = puzzle.flat().filter((v) => v !== 0).length;

    const gamePlayers: SudokuPlayer[] = players.map((p, i) => ({
      username: p.username,
      colorIndex: i % 8,
      isBot: !!p.isBot,
      rank: null,
      completedAt: null,
      hintsUsed: 0,
      moves: new Map(),
      filledCount: 0,
    }));

    const state: SudokuGameState = {
      id: gameId,
      players: gamePlayers,
      solution,
      puzzle,
      givenCount,
      difficulty,
      status: 'playing',
      winner: null,
      rankings: [],
      startedAt: new Date(),
      isBot: players.some((p) => p.isBot),
      botUsername: players.find((p) => p.isBot)?.username,
    };

    this.games.set(gameId, state);
    return state;
  }

  getGame(gameId: string): SudokuGameState | undefined {
    return this.games.get(gameId);
  }

  deleteGame(gameId: string): void {
    this.games.delete(gameId);
  }

  /** Player places a digit in a cell */
  placeDigit(
    gameId: string,
    username: string,
    row: number,
    col: number,
    digit: number, // 0 = erase
  ): SudokuMoveResult {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'playing') return { success: false, error: 'Game not active' };

    const player = game.players.find((p) => p.username === username);
    if (!player) return { success: false, error: 'Player not found' };
    if (player.rank !== null) return { success: false, error: 'You already finished' };

    // Validate bounds
    if (row < 0 || row > 8 || col < 0 || col > 8) return { success: false, error: 'Invalid position' };

    // Cannot overwrite a given cell
    if (game.puzzle[row]![col] !== 0) return { success: false, error: 'Cannot change a given cell' };

    if (digit === 0) {
      // Erase
      const key = `${row},${col}`;
      if (player.moves.has(key)) {
        player.moves.delete(key);
        player.filledCount = Math.max(0, player.filledCount - 1);
      }
      return { success: true, correct: true };
    }

    if (digit < 1 || digit > 9) return { success: false, error: 'Digit must be 1-9' };

    const correct = game.solution[row]![col] === digit;
    const key = `${row},${col}`;
    const wasEmpty = !player.moves.has(key);
    player.moves.set(key, digit);
    if (wasEmpty && correct) player.filledCount++;
    else if (!wasEmpty && correct) {/* replacing wrong with right — count already up */}
    else if (wasEmpty && !correct) {/* wrong placed — still count as filled attempt */}

    // Recalculate filledCount as correctly placed cells
    let correctCount = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (game.puzzle[r]![c] !== 0) continue; // given
        const mv = player.moves.get(`${r},${c}`);
        if (mv !== undefined && mv === game.solution[r]![c]) correctCount++;
      }
    }
    player.filledCount = correctCount;

    const totalBlanks = 81 - game.givenCount;
    const completed = correctCount === totalBlanks;

    if (completed && player.rank === null) {
      const rank = game.rankings.length + 1;
      player.rank = rank;
      player.completedAt = Date.now();
      game.rankings.push({
        username,
        rank,
        completedAt: player.completedAt,
        hintsUsed: player.hintsUsed,
      });
      if (!game.winner) game.winner = username;
    }

    // Game ends when all human players finish OR one human finishes (vs bot)
    const humanPlayers = game.players.filter((p) => !p.isBot);
    const allDone = humanPlayers.every((p) => p.rank !== null);
    const gameOver = allDone || (game.isBot && completed);

    if (gameOver && game.status === 'playing') {
      // Assign ranks to remaining
      let remaining = game.rankings.length + 1;
      for (const p of game.players) {
        if (p.rank === null) {
          p.rank = remaining++;
          game.rankings.push({
            username: p.username,
            rank: p.rank,
            completedAt: p.completedAt,
            hintsUsed: p.hintsUsed,
          });
        }
      }
      game.status = 'completed';
      game.endedAt = new Date();
    }

    return {
      success: true,
      correct,
      completed,
      gameOver: game.status === 'completed',
      winner: game.winner,
      rankings: game.rankings,
    };
  }

  /** Reveal the correct value for one blank cell (costs a hint) */
  getHint(gameId: string, username: string): SudokuHintResult {
    const game = this.games.get(gameId);
    if (!game) return { success: false, error: 'Game not found' };
    if (game.status !== 'playing') return { success: false, error: 'Game not active' };

    const player = game.players.find((p) => p.username === username);
    if (!player) return { success: false, error: 'Player not found' };
    if (player.rank !== null) return { success: false, error: 'You already finished' };

    const maxHints = 3;
    if (player.hintsUsed >= maxHints) return { success: false, error: `Max ${maxHints} hints per game` };

    // Find a blank cell that the player hasn't correctly filled yet
    const blanks: [number, number][] = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (game.puzzle[r]![c] !== 0) continue;
        const mv = player.moves.get(`${r},${c}`);
        if (mv !== game.solution[r]![c]) blanks.push([r, c]);
      }
    }
    if (blanks.length === 0) return { success: false, error: 'Board already complete' };

    const [row, col] = blanks[Math.floor(Math.random() * blanks.length)]!;
    const value = game.solution[row]![col]!;

    // Apply hint as a move
    player.moves.set(`${row},${col}`, value);
    player.hintsUsed++;

    // Recount
    let correctCount = 0;
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (game.puzzle[r]![c] !== 0) continue;
        const mv = player.moves.get(`${r},${c}`);
        if (mv === game.solution[r]![c]) correctCount++;
      }
    }
    player.filledCount = correctCount;

    return { success: true, row, col, value, hintsUsed: player.hintsUsed };
  }

  /** Bot fills its entire board instantly */
  botComplete(gameId: string, botUsername: string): void {
    const game = this.games.get(gameId);
    if (!game) return;
    const bot = game.players.find((p) => p.username === botUsername);
    if (!bot) return;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (game.puzzle[r]![c] === 0) {
          bot.moves.set(`${r},${c}`, game.solution[r]![c]!);
        }
      }
    }
    bot.filledCount = 81 - game.givenCount;
  }

  /** Serialize player moves for a specific player (for client sync) */
  getPlayerGrid(gameId: string, username: string): number[][] | null {
    const game = this.games.get(gameId);
    if (!game) return null;
    const player = game.players.find((p) => p.username === username);
    if (!player) return null;

    const grid = deepCopy(game.puzzle);
    for (const [key, val] of player.moves) {
      const [r, c] = key.split(',').map(Number);
      grid[r!]![c!] = val;
    }
    return grid;
  }
}

export const sudokuService = new SudokuService();
