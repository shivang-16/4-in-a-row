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
  private static dims(board: Board): { rows: number; cols: number } {
    const rows = board.length;
    const cols = board[0]?.length ?? 0;
    return { rows, cols };
  }

  static createEmptyBoard(rows: number = ROWS, cols: number = COLS): Board {
    return Array(rows)
      .fill(null)
      .map(() => Array(cols).fill(CellValue.EMPTY));
  }

  static dropDisc(board: Board, column: number, player: CellValue): number {
    const { rows, cols } = this.dims(board);
    if (column < 0 || column >= cols) {
      return -1;
    }

    for (let row = rows - 1; row >= 0; row--) {
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

  private static countInDirection(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue,
    rows: number,
    cols: number
  ): number {
    let count = 0;
    let r = row + rowDir;
    let c = col + colDir;

    while (
      r >= 0 &&
      r < rows &&
      c >= 0 &&
      c < cols &&
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
    const { rows, cols } = this.dims(board);
    const cells: Position[] = [{ row, col }];

    let r = row + rowDir;
    let c = col + colDir;
    while (
      r >= 0 && r < rows &&
      c >= 0 && c < cols &&
      board[r][c] === player
    ) {
      cells.push({ row: r, col: c });
      r += rowDir;
      c += colDir;
    }

    r = row - rowDir;
    c = col - colDir;
    while (
      r >= 0 && r < rows &&
      c >= 0 && c < cols &&
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
    const { cols } = this.dims(board);
    const validMoves: number[] = [];
    for (let col = 0; col < cols; col++) {
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
    const { cols } = this.dims(board);
    if (column < 0 || column >= cols) {
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
        winningPlayer: player,
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
