import {
  Board,
  CellValue,
  ROWS,
  COLS,
  Position,
  MoveResult,
  WinReason,
  cellValueToSlotIndex,
  slotIndexToCellValue,
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

  static checkWin(
    board: Board,
    row: number,
    col: number,
    winStreak: number = 4
  ): { winReason: WinReason; winningCells: Position[] } | null {
    const player = board[row][col];
    if (player === CellValue.EMPTY) return null;

    const horizontal = this.getWinningCells(board, row, col, 0, 1, player, winStreak);
    if (horizontal) return { winReason: WinReason.HORIZONTAL, winningCells: horizontal };

    const vertical = this.getWinningCells(board, row, col, 1, 0, player, winStreak);
    if (vertical) return { winReason: WinReason.VERTICAL, winningCells: vertical };

    const diag1 = this.getWinningCells(board, row, col, -1, 1, player, winStreak);
    if (diag1) return { winReason: WinReason.DIAGONAL, winningCells: diag1 };

    const diag2 = this.getWinningCells(board, row, col, 1, 1, player, winStreak);
    if (diag2) return { winReason: WinReason.DIAGONAL, winningCells: diag2 };

    return null;
  }

  private static getWinningCells(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue,
    winStreak: number = 4
  ): Position[] | null {
    const { rows, cols } = this.dims(board);
    const cells: Position[] = [{ row, col }];

    let r = row + rowDir;
    let c = col + colDir;
    while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
      cells.push({ row: r, col: c });
      r += rowDir;
      c += colDir;
    }

    r = row - rowDir;
    c = col - colDir;
    while (r >= 0 && r < rows && c >= 0 && c < cols && board[r][c] === player) {
      cells.push({ row: r, col: c });
      r -= rowDir;
      c -= colDir;
    }

    if (cells.length >= winStreak) {
      console.log(`🏆 Winning cells: ${cells.length} in direction (${rowDir},${colDir})`);
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
    player: CellValue,
    winStreak: number = 4
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

    const winResult = this.checkWin(board, row, column, winStreak);
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

  /** Pack non-empty cells to the bottom of the column (gravity after player removal). */
  static gravityColumn(board: Board, col: number): void {
    const { rows } = this.dims(board);
    const stack: CellValue[] = [];
    for (let r = rows - 1; r >= 0; r--) {
      const v = board[r][col];
      if (v !== CellValue.EMPTY) stack.push(v);
    }
    let i = 0;
    for (let r = rows - 1; r >= 0; r--) {
      board[r][col] = i < stack.length ? stack[i++]! : CellValue.EMPTY;
    }
  }

  /**
   * Remove one seat from the board: clear that color, renumber higher player colors down by one, then gravity.
   */
  static remapBoardRemovePlayer(board: Board, removedSlotIndex: number): void {
    const { rows, cols } = this.dims(board);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const v = board[r][c];
        if (v === CellValue.EMPTY) continue;
        const oldSlot = cellValueToSlotIndex(v);
        if (oldSlot === removedSlotIndex) {
          board[r][c] = CellValue.EMPTY;
        } else {
          const newSlot = oldSlot > removedSlotIndex ? oldSlot - 1 : oldSlot;
          board[r][c] = slotIndexToCellValue(newSlot);
        }
      }
    }
    for (let c = 0; c < cols; c++) {
      this.gravityColumn(board, c);
    }
  }

  static cloneBoard(board: Board): Board {
    return board.map((row) => [...row]);
  }
}
