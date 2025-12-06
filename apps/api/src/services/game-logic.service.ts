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
  /**
   * Create an empty game board
   */
  static createEmptyBoard(): Board {
    return Array(ROWS)
      .fill(null)
      .map(() => Array(COLS).fill(CellValue.EMPTY));
  }

  /**
   * Drop a disc in the specified column
   * Returns the row where the disc landed, or -1 if column is full
   */
  static dropDisc(board: Board, column: number, player: CellValue): number {
    if (column < 0 || column >= COLS) {
      return -1;
    }

    // Find the lowest empty row in this column
    for (let row = ROWS - 1; row >= 0; row--) {
      if (board[row][column] === CellValue.EMPTY) {
        board[row][column] = player;
        return row;
      }
    }

    return -1; // Column is full
  }

  /**
   * Check if a move results in a win
   * Returns win reason and the winning cells for highlighting
   */
  static checkWin(board: Board, row: number, col: number): { winReason: WinReason; winningCells: Position[] } | null {
    const player = board[row][col];
    if (player === CellValue.EMPTY) return null;

    // Check horizontal
    const horizontalCells = this.getWinningCells(board, row, col, 0, 1, player);
    if (horizontalCells) {
      return { winReason: WinReason.HORIZONTAL, winningCells: horizontalCells };
    }

    // Check vertical
    const verticalCells = this.getWinningCells(board, row, col, 1, 0, player);
    if (verticalCells) {
      return { winReason: WinReason.VERTICAL, winningCells: verticalCells };
    }

    // Check diagonal (bottom-left to top-right)
    const diagonal1Cells = this.getWinningCells(board, row, col, -1, 1, player);
    if (diagonal1Cells) {
      return { winReason: WinReason.DIAGONAL, winningCells: diagonal1Cells };
    }

    // Check diagonal (top-left to bottom-right)
    const diagonal2Cells = this.getWinningCells(board, row, col, 1, 1, player);
    if (diagonal2Cells) {
      return { winReason: WinReason.DIAGONAL, winningCells: diagonal2Cells };
    }

    return null;
  }

  /**
   * Check if there are 4 in a row in a specific direction
   */
  private static checkDirection(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): boolean {
    let count = 1; // Count the current position

    // Check in positive direction
    count += this.countInDirection(board, row, col, rowDir, colDir, player);

    // Check in negative direction
    count += this.countInDirection(board, row, col, -rowDir, -colDir, player);

    const isWin = count >= 4;
    if (count >= 3) {
      console.log(`🔍 Win check at (${row},${col}): direction(${rowDir},${colDir}) = ${count} discs, isWin: ${isWin}`);
    }

    return isWin;
  }

  /**
   * Count consecutive discs in a specific direction
   */
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

  /**
   * Get winning cells in a specific direction if there's a win
   * Returns array of 4+ cells or null if no win
   */
  private static getWinningCells(
    board: Board,
    row: number,
    col: number,
    rowDir: number,
    colDir: number,
    player: CellValue
  ): Position[] | null {
    const cells: Position[] = [{ row, col }];
    
    // Collect cells in positive direction
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
    
    // Collect cells in negative direction
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

  /**
   * Check if the board is full (draw condition)
   */
  static isBoardFull(board: Board): boolean {
    return board[0].every((cell) => cell !== CellValue.EMPTY);
  }

  /**
   * Check if a column is full
   */
  static isColumnFull(board: Board, column: number): boolean {
    return board[0][column] !== CellValue.EMPTY;
  }

  /**
   * Get all valid moves (columns that aren't full)
   */
  static getValidMoves(board: Board): number[] {
    const validMoves: number[] = [];
    for (let col = 0; col < COLS; col++) {
      if (!this.isColumnFull(board, col)) {
        validMoves.push(col);
      }
    }
    return validMoves;
  }

  /**
   * Make a move and return the result
   */
  static makeMove(
    board: Board,
    column: number,
    player: CellValue
  ): MoveResult {
    // Validate column
    if (column < 0 || column >= COLS) {
      return { success: false, error: 'Invalid column' };
    }

    // Check if column is full
    if (this.isColumnFull(board, column)) {
      return { success: false, error: 'Column is full' };
    }

    // Drop the disc
    const row = this.dropDisc(board, column, player);
    if (row === -1) {
      return { success: false, error: 'Failed to drop disc' };
    }

    // Check for win
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

    // Check for draw
    if (this.isBoardFull(board)) {
      return {
        success: true,
        row,
        isDraw: true,
        winReason: WinReason.DRAW,
      };
    }

    // Valid move, game continues
    return { success: true, row };
  }

  /**
   * Clone a board (for bot simulation)
   */
  static cloneBoard(board: Board): Board {
    return board.map((row) => [...row]);
  }
}
