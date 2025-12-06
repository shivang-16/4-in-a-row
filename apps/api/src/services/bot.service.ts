import { Board, CellValue, COLS } from '../types/game';
import { GameLogic } from './game-logic.service';

export class BotService {
  private botPlayer: CellValue;
  private humanPlayer: CellValue;

  constructor(botPlayer: CellValue) {
    this.botPlayer = botPlayer;
    this.humanPlayer =
      botPlayer === CellValue.PLAYER1 ? CellValue.PLAYER2 : CellValue.PLAYER1;
  }

  getBestMove(board: Board): number {
    const validMoves = GameLogic.getValidMoves(board);

    if (validMoves.length === 0) {
      return -1;
    }

    const winningMove = this.findWinningMove(board, this.botPlayer);
    if (winningMove !== -1) {
      console.log('🤖 Bot: Taking winning move at column', winningMove);
      return winningMove;
    }

    const blockingMove = this.findWinningMove(board, this.humanPlayer);
    if (blockingMove !== -1) {
      console.log('🤖 Bot: Blocking opponent at column', blockingMove);
      return blockingMove;
    }

    const strategicMove = this.findStrategicMove(board);
    if (strategicMove !== -1) {
      console.log('🤖 Bot: Making strategic move at column', strategicMove);
      return strategicMove;
    }

    const centerMoves = validMoves.filter((col) => col >= 2 && col <= 4);
    if (centerMoves.length > 0) {
      const move = centerMoves[Math.floor(Math.random() * centerMoves.length)];
      console.log('🤖 Bot: Choosing center column', move);
      return move;
    }

    const move = validMoves[Math.floor(Math.random() * validMoves.length)];
    console.log('🤖 Bot: Random move at column', move);
    return move;
  }

  private findWinningMove(board: Board, player: CellValue): number {
    for (let col = 0; col < COLS; col++) {
      if (GameLogic.isColumnFull(board, col)) continue;

      const testBoard = GameLogic.cloneBoard(board);
      const row = GameLogic.dropDisc(testBoard, col, player);

      if (row !== -1) {
        const winReason = GameLogic.checkWin(testBoard, row, col);
        if (winReason) {
          return col;
        }
      }
    }
    return -1;
  }

  private findStrategicMove(board: Board): number {
    const strategicScores: { col: number; score: number }[] = [];

    for (let col = 0; col < COLS; col++) {
      if (GameLogic.isColumnFull(board, col)) continue;

      const testBoard = GameLogic.cloneBoard(board);
      const row = GameLogic.dropDisc(testBoard, col, this.botPlayer);

      if (row !== -1) {
        const score = this.evaluatePosition(testBoard, row, col);
        strategicScores.push({ col, score });
      }
    }

    if (strategicScores.length > 0) {
      strategicScores.sort((a, b) => b.score - a.score);
      if (strategicScores[0].score > 0) {
        return strategicScores[0].col;
      }
    }

    return -1;
  }

  private evaluatePosition(board: Board, row: number, col: number): number {
    let score = 0;
    const player = board[row][col];

    const directions = [
      { dr: 0, dc: 1 },
      { dr: 1, dc: 0 },
      { dr: 1, dc: 1 },
      { dr: -1, dc: 1 },
    ];

    for (const { dr, dc } of directions) {
      const count = this.countConsecutive(board, row, col, dr, dc, player);
      if (count === 2) score += 5;
      if (count === 3) score += 20;
    }

    return score;
  }

  private countConsecutive(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): number {
    let count = 1;

    let r = row + rowDir;
    let c = col + colDir;
    while (
      r >= 0 &&
      r < board.length &&
      c >= 0 &&
      c < COLS &&
      board[r][c] === player
    ) {
      count++;
      r += rowDir;
      c += colDir;
    }

    r = row - rowDir;
    c = col - colDir;
    while (
      r >= 0 &&
      r < board.length &&
      c >= 0 &&
      c < COLS &&
      board[r][c] === player
    ) {
      count++;
      r -= rowDir;
      c -= colDir;
    }

    return count;
  }
}
