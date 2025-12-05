"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GameLogic = void 0;
const game_1 = require("../types/game");
class GameLogic {
    /**
     * Create an empty game board
     */
    static createEmptyBoard() {
        return Array(game_1.ROWS)
            .fill(null)
            .map(() => Array(game_1.COLS).fill(game_1.CellValue.EMPTY));
    }
    /**
     * Drop a disc in the specified column
     * Returns the row where the disc landed, or -1 if column is full
     */
    static dropDisc(board, column, player) {
        if (column < 0 || column >= game_1.COLS) {
            return -1;
        }
        // Find the lowest empty row in this column
        for (let row = game_1.ROWS - 1; row >= 0; row--) {
            if (board[row][column] === game_1.CellValue.EMPTY) {
                board[row][column] = player;
                return row;
            }
        }
        return -1; // Column is full
    }
    /**
     * Check if a move results in a win
     */
    static checkWin(board, row, col) {
        const player = board[row][col];
        if (player === game_1.CellValue.EMPTY)
            return null;
        // Check horizontal
        if (this.checkDirection(board, row, col, 0, 1, player)) {
            return game_1.WinReason.HORIZONTAL;
        }
        // Check vertical
        if (this.checkDirection(board, row, col, 1, 0, player)) {
            return game_1.WinReason.VERTICAL;
        }
        // Check diagonal (bottom-left to top-right)
        if (this.checkDirection(board, row, col, -1, 1, player)) {
            return game_1.WinReason.DIAGONAL;
        }
        // Check diagonal (top-left to bottom-right)
        if (this.checkDirection(board, row, col, 1, 1, player)) {
            return game_1.WinReason.DIAGONAL;
        }
        return null;
    }
    /**
     * Check if there are 4 in a row in a specific direction
     */
    static checkDirection(board, row, col, rowDir, colDir, player) {
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
    static countInDirection(board, row, col, rowDir, colDir, player) {
        let count = 0;
        let r = row + rowDir;
        let c = col + colDir;
        while (r >= 0 &&
            r < game_1.ROWS &&
            c >= 0 &&
            c < game_1.COLS &&
            board[r][c] === player) {
            count++;
            r += rowDir;
            c += colDir;
        }
        return count;
    }
    /**
     * Check if the board is full (draw condition)
     */
    static isBoardFull(board) {
        return board[0].every((cell) => cell !== game_1.CellValue.EMPTY);
    }
    /**
     * Check if a column is full
     */
    static isColumnFull(board, column) {
        return board[0][column] !== game_1.CellValue.EMPTY;
    }
    /**
     * Get all valid moves (columns that aren't full)
     */
    static getValidMoves(board) {
        const validMoves = [];
        for (let col = 0; col < game_1.COLS; col++) {
            if (!this.isColumnFull(board, col)) {
                validMoves.push(col);
            }
        }
        return validMoves;
    }
    /**
     * Make a move and return the result
     */
    static makeMove(board, column, player) {
        // Validate column
        if (column < 0 || column >= game_1.COLS) {
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
        const winReason = this.checkWin(board, row, column);
        if (winReason) {
            return {
                success: true,
                row,
                winReason,
                winner: player === game_1.CellValue.PLAYER1 ? 'player1' : 'player2',
            };
        }
        // Check for draw
        if (this.isBoardFull(board)) {
            return {
                success: true,
                row,
                isDraw: true,
                winReason: game_1.WinReason.DRAW,
            };
        }
        // Valid move, game continues
        return { success: true, row };
    }
    /**
     * Clone a board (for bot simulation)
     */
    static cloneBoard(board) {
        return board.map((row) => [...row]);
    }
}
exports.GameLogic = GameLogic;
