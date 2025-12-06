import {
  Board,
  CellValue,
  ROWS,
  COLS,
  Position,
  MoveResult,
  WinReason,
} from '../types/game';

export class GameLogic {
  static createEmptyBoard(): Board {
    return Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(CellValue.EMPTY));
  }

  static dropDisc(board: Board, column: number, player: CellValue): number {
    if (column < 0 || column >= COLS) {
      return -1;
    }

    for (let row = ROWS - 1; row >= 0; row--) {
      if (board[row][column] === CellValue.EMPTY) {
        board[row][column] = player;
        return row;
      }
    }

    return -1;
  }

  static checkWin(board: Board, row: number, col: number): { winReason: WinReason; winningCells: Position[] } | null {
    const player = board[row][col];
    if (player === CellValue.EMPTY) return null;

    const horizontalCells = this.getWinningCells(board, row, col, 0, 1, player);
    if (horizontalCells) {
      return { winReason: WinReason.HORIZONTAL, winningCells: horizontalCells };
    }

    const verticalCells = this.getWinningCells(board, row, col, 1, 0, player);
    if (verticalCells) {
      return { winReason: WinReason.VERTICAL, winningCells: verticalCells };
    }

    const diagonal1Cells = this.getWinningCells(board, row, col, -1, 1, player);
    if (diagonal1Cells) {
      return { winReason: WinReason.DIAGONAL, winningCells: diagonal1Cells };
    }

    const diagonal2Cells = this.getWinningCells(board, row, col, 1, 1, player);
    if (diagonal2Cells) {
      return { winReason: WinReason.DIAGONAL, winningCells: diagonal2Cells };
    }

    return null;
  }

  private static checkDirection(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): boolean {
    let count = 1;

    count += this.countInDirection(board, row, col, rowDir, colDir, player);
    count += this.countInDirection(board, row, col, -rowDir, -colDir, player);

    const isWin = count >= 4;
    if (count >= 3) {
      console.log(`🔍 Win check at (${row},${col}): direction(${rowDir},${colDir}) = ${count} discs, isWin: ${isWin}`);
    }

    return isWin;
  }

  private static countInDirection(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): number {
    let count = 0;
    let r = row + rowDir;
    let c = col + colDir;

    while (
      r >= 0 &&
      r < ROWS &&
      c >= 0 &&
      c < COLS &&
      board[r][c] === player
    ) {
      count++;
      r += rowDir;
      c += colDir;
    }

    return count;
  }

  private static getWinningCells(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): Position[] | null {
    const cells: Position[] = [{ row, col }];
    
    let r = row + rowDir;
    let c = col + colDir;
    while (
      r >= 0 && r < ROWS &&
      c >= 0 && c < COLS &&
      board[r][c] === player
    ) {
      cells.push({ row: r, col: c });
      r += rowDir;
      c += colDir;
    }
    
    r = row - rowDir;
    c = col - colDir;
    while (
      r >= 0 && r < ROWS &&
      c >= 0 && c < COLS &&
      board[r][c] === player
    ) {
      cells.push({ row: r, col: c });
      r -= rowDir;
      c -= colDir;
    }
    
    if (cells.length >= 4) {
      console.log(`🏆 Winning cells found: ${cells.length} cells in direction (${rowDir},${colDir})`);
      return cells;
    }
    
    return null;
  }

  static isBoardFull(board: Board): boolean {
    return board[0].every((cell) => cell !== CellValue.EMPTY);
  }

  static isColumnFull(board: Board, column: number): boolean {
    return board[0][column] !== CellValue.EMPTY;
  }

  static getValidMoves(board: Board): number[] {
    const validMoves: number[] = [];
    for (let col = 0; col < COLS; col++) {
      if (!this.isColumnFull(board, col)) {
        validMoves.push(col);
      }
    }
    return validMoves;
  }

  static makeMove(
    board: Board,
    column: number,
    player: CellValue
  ): MoveResult {
    if (column < 0 || column >= COLS) {
      return { success: false, error: 'Invalid column' };
    }

    if (this.isColumnFull(board, column)) {
      return { success: false, error: 'Column is full' };
    }

    const row = this.dropDisc(board, column, player);
    if (row === -1) {
      return { success: false, error: 'Failed to drop disc' };
    }

    const winResult = this.checkWin(board, row, column);
    if (winResult) {
      return {
        success: true,
        row,
        winReason: winResult.winReason,
        winningCells: winResult.winningCells,
        winner: player === CellValue.PLAYER1 ? 'player1' : 'player2',
      };
    }

    if (this.isBoardFull(board)) {
      return {
        success: true,
        row,
        isDraw: true,
        winReason: WinReason.DRAW,
      };
    }

    return { success: true, row };
  }

  static cloneBoard(board: Board): Board {
    return board.map((row) => [...row]);
  }
}
