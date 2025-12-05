"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BotService = void 0;
const game_1 = require("../types/game");
const game_logic_service_1 = require("./game-logic.service");
class BotService {
    botPlayer;
    humanPlayer;
    constructor(botPlayer) {
        this.botPlayer = botPlayer;
        this.humanPlayer =
            botPlayer === game_1.CellValue.PLAYER1 ? game_1.CellValue.PLAYER2 : game_1.CellValue.PLAYER1;
    }
    /**
     * Get the best move for the bot
     * Strategy priority:
     * 1. Win if possible
     * 2. Block opponent's winning move
     * 3. Create opportunities (center preference)
     * 4. Random valid move
     */
    getBestMove(board) {
        const validMoves = game_logic_service_1.GameLogic.getValidMoves(board);
        if (validMoves.length === 0) {
            return -1;
        }
        // 1. Check if bot can win
        const winningMove = this.findWinningMove(board, this.botPlayer);
        if (winningMove !== -1) {
            console.log('🤖 Bot: Taking winning move at column', winningMove);
            return winningMove;
        }
        // 2. Block opponent's winning move
        const blockingMove = this.findWinningMove(board, this.humanPlayer);
        if (blockingMove !== -1) {
            console.log('🤖 Bot: Blocking opponent at column', blockingMove);
            return blockingMove;
        }
        // 3. Look for strategic moves (2 or 3 in a row)
        const strategicMove = this.findStrategicMove(board);
        if (strategicMove !== -1) {
            console.log('🤖 Bot: Making strategic move at column', strategicMove);
            return strategicMove;
        }
        // 4. Prefer center columns (better positioning)
        const centerMoves = validMoves.filter((col) => col >= 2 && col <= 4);
        if (centerMoves.length > 0) {
            const move = centerMoves[Math.floor(Math.random() * centerMoves.length)];
            console.log('🤖 Bot: Choosing center column', move);
            return move;
        }
        // 5. Random valid move
        const move = validMoves[Math.floor(Math.random() * validMoves.length)];
        console.log('🤖 Bot: Random move at column', move);
        return move;
    }
    /**
     * Find a move that would result in an immediate win
     */
    findWinningMove(board, player) {
        for (let col = 0; col < game_1.COLS; col++) {
            if (game_logic_service_1.GameLogic.isColumnFull(board, col))
                continue;
            // Simulate the move
            const testBoard = game_logic_service_1.GameLogic.cloneBoard(board);
            const row = game_logic_service_1.GameLogic.dropDisc(testBoard, col, player);
            if (row !== -1) {
                const winReason = game_logic_service_1.GameLogic.checkWin(testBoard, row, col);
                if (winReason) {
                    return col;
                }
            }
        }
        return -1;
    }
    /**
     * Find moves that create 2 or 3 in a row
     */
    findStrategicMove(board) {
        const strategicScores = [];
        for (let col = 0; col < game_1.COLS; col++) {
            if (game_logic_service_1.GameLogic.isColumnFull(board, col))
                continue;
            const testBoard = game_logic_service_1.GameLogic.cloneBoard(board);
            const row = game_logic_service_1.GameLogic.dropDisc(testBoard, col, this.botPlayer);
            if (row !== -1) {
                const score = this.evaluatePosition(testBoard, row, col);
                strategicScores.push({ col, score });
            }
        }
        // Sort by score and return best move
        if (strategicScores.length > 0) {
            strategicScores.sort((a, b) => b.score - a.score);
            if (strategicScores[0].score > 0) {
                return strategicScores[0].col;
            }
        }
        return -1;
    }
    /**
     * Evaluate a position based on potential connections
     */
    evaluatePosition(board, row, col) {
        let score = 0;
        const player = board[row][col];
        // Check all directions for 2 or 3 in a row
        const directions = [
            { dr: 0, dc: 1 }, // Horizontal
            { dr: 1, dc: 0 }, // Vertical
            { dr: 1, dc: 1 }, // Diagonal \
            { dr: -1, dc: 1 }, // Diagonal /
        ];
        for (const { dr, dc } of directions) {
            const count = this.countConsecutive(board, row, col, dr, dc, player);
            if (count === 2)
                score += 5;
            if (count === 3)
                score += 20;
        }
        return score;
    }
    /**
     * Count consecutive discs in both directions
     */
    countConsecutive(board, row, col, rowDir, colDir, player) {
        let count = 1;
        // Count in positive direction
        let r = row + rowDir;
        let c = col + colDir;
        while (r >= 0 &&
            r < board.length &&
            c >= 0 &&
            c < game_1.COLS &&
            board[r][c] === player) {
            count++;
            r += rowDir;
            c += colDir;
        }
        // Count in negative direction
        r = row - rowDir;
        c = col - colDir;
        while (r >= 0 &&
            r < board.length &&
            c >= 0 &&
            c < game_1.COLS &&
            board[r][c] === player) {
            count++;
            r -= rowDir;
            c -= colDir;
        }
        return count;
    }
}
exports.BotService = BotService;
