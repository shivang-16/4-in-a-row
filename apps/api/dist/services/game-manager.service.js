"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gameManager = exports.GameManager = void 0;
const uuid_1 = require("uuid");
const game_1 = require("../types/game");
const game_logic_service_1 = require("./game-logic.service");
const bot_service_1 = require("./bot.service");
const websocket_service_1 = require("../websocket/websocket.service");
const game_model_1 = require("../models/game.model");
const kafka_service_1 = require("./kafka.service");
class GameManager {
    activeGames = new Map();
    playerToGame = new Map(); // username -> gameId
    /**
     * Create a new game between two players
     */
    createGame(player1Username, player2Username, isBot = false) {
        const gameId = (0, uuid_1.v4)();
        const player1 = {
            id: (0, uuid_1.v4)(),
            username: player1Username,
            isBot: false,
            connected: true,
        };
        const player2 = {
            id: (0, uuid_1.v4)(),
            username: player2Username,
            isBot,
            connected: !isBot,
        };
        const gameState = {
            id: gameId,
            board: game_logic_service_1.GameLogic.createEmptyBoard(),
            player1,
            player2,
            currentTurn: game_1.CellValue.PLAYER1,
            status: game_1.GameStatus.IN_PROGRESS,
            winner: null,
            winReason: null,
            moves: [],
            startedAt: new Date(),
        };
        this.activeGames.set(gameId, gameState);
        this.playerToGame.set(player1Username, gameId);
        if (!isBot) {
            this.playerToGame.set(player2Username, gameId);
        }
        console.log(`🎮 Game created: ${gameId} - ${player1Username} vs ${player2Username}${isBot ? ' (BOT)' : ''}`);
        // Emit game start via WebSocket
        if (websocket_service_1.wsService) {
            websocket_service_1.wsService.emitGameStart(gameId, player1Username, player2Username, isBot);
        }
        // Send Kafka event
        kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.GAME_STARTED, {
            gameId,
            player1: player1Username,
            player2: player2Username,
            isBot,
        });
        return gameState;
    }
    /**
     * Make a move in a game
     */
    makeMove(gameId, username, column) {
        const game = this.activeGames.get(gameId);
        if (!game) {
            return { success: false, error: 'Game not found' };
        }
        if (game.status !== game_1.GameStatus.IN_PROGRESS) {
            return { success: false, error: 'Game is not in progress' };
        }
        // Check if it's the player's turn
        const isPlayer1 = game.player1.username === username;
        const isPlayer2 = game.player2.username === username;
        if (!isPlayer1 && !isPlayer2) {
            return { success: false, error: 'Player not in this game' };
        }
        const expectedPlayer = game.currentTurn === game_1.CellValue.PLAYER1 ? game.player1.username : game.player2.username;
        if (username !== expectedPlayer) {
            return { success: false, error: 'Not your turn' };
        }
        // Make the move
        const result = game_logic_service_1.GameLogic.makeMove(game.board, column, game.currentTurn);
        if (!result.success) {
            return result;
        }
        // Record the move
        const move = {
            player: username,
            column,
            row: result.row,
            timestamp: new Date(),
        };
        game.moves.push(move);
        // Send Kafka event
        kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.MOVE_MADE, {
            gameId,
            player: username,
            column,
            row: result.row,
            moveNumber: game.moves.length,
        });
        // Check for game end
        if (result.winner || result.isDraw) {
            game.status = game_1.GameStatus.COMPLETED;
            game.winner = result.winner === 'player1' ? game.player1.username : result.winner === 'player2' ? game.player2.username : null;
            game.winReason = result.winReason;
            game.endedAt = new Date();
            // Emit game end
            if (websocket_service_1.wsService) {
                websocket_service_1.wsService.emitGameEnd(gameId, game.winner, result.winReason);
            }
            // Save to database
            this.saveGameToDatabase(game);
            // Send Kafka event
            kafka_service_1.kafkaService.sendGameEvent(kafka_service_1.GameEventType.GAME_ENDED, {
                gameId,
                winner: game.winner,
                reason: result.winReason,
                duration: game.endedAt.getTime() - game.startedAt.getTime(),
                totalMoves: game.moves.length,
            });
            // Clean up
            this.activeGames.delete(gameId);
            this.playerToGame.delete(game.player1.username);
            if (!game.player2.isBot) {
                this.playerToGame.delete(game.player2.username);
            }
            console.log(`🧹 Cleaned up game ${gameId} from active games`);
        }
        else {
            // Switch turns
            game.currentTurn = game.currentTurn === game_1.CellValue.PLAYER1 ? game_1.CellValue.PLAYER2 : game_1.CellValue.PLAYER1;
            // If next player is bot, make bot move
            if (game.currentTurn === game_1.CellValue.PLAYER2 && game.player2.isBot) {
                setTimeout(() => this.makeBotMove(gameId), 1000);
            }
        }
        // Emit game update
        if (websocket_service_1.wsService) {
            websocket_service_1.wsService.emitGameUpdate(gameId, {
                board: game.board,
                currentTurn: game.currentTurn,
                lastMove: move,
                isGameOver: game.status === game_1.GameStatus.COMPLETED,
            });
        }
        return result;
    }
    /**
     * Make a bot move
     */
    makeBotMove(gameId) {
        const game = this.activeGames.get(gameId);
        if (!game || game.status !== game_1.GameStatus.IN_PROGRESS)
            return;
        const botService = new bot_service_1.BotService(game_1.CellValue.PLAYER2);
        const column = botService.getBestMove(game.board);
        if (column !== -1) {
            this.makeMove(gameId, game.player2.username, column);
        }
    }
    getGame(gameId) {
        return this.activeGames.get(gameId);
    }
    /**
     * Get game by player username (with auto-cleanup of stale mappings)
     */
    getGameByPlayer(username) {
        const gameId = this.playerToGame.get(username);
        if (!gameId)
            return undefined;
        const game = this.activeGames.get(gameId);
        // If game doesn't exist, clean up the stale mapping
        if (!game) {
            console.log(`🧹 Cleaning up stale player mapping for ${username} (game ${gameId} no longer exists)`);
            this.playerToGame.delete(username);
            return undefined;
        }
        return game;
    }
    /**
     * Clear player's game mapping (useful when player disconnects or leaves)
     */
    clearPlayerMapping(username) {
        if (this.playerToGame.has(username)) {
            console.log(`🧹 Cleared player mapping for ${username}`);
            this.playerToGame.delete(username);
        }
    }
    /**
     * Save game to database
     */
    async saveGameToDatabase(game) {
        try {
            await game_model_1.Game.create({
                gameId: game.id,
                player1: {
                    username: game.player1.username,
                    isBot: game.player1.isBot,
                },
                player2: {
                    username: game.player2.username,
                    isBot: game.player2.isBot,
                },
                board: game.board,
                status: game.status,
                winner: game.winner,
                winReason: game.winReason,
                moves: game.moves,
                startedAt: game.startedAt,
                endedAt: game.endedAt,
                duration: game.endedAt ? game.endedAt.getTime() - game.startedAt.getTime() : undefined,
            });
            console.log(`💾 Game saved to database: ${game.id}`);
        }
        catch (error) {
            console.error('Failed to save game to database:', error);
        }
    }
    /**
     * Get all active games
     */
    getActiveGames() {
        return Array.from(this.activeGames.values());
    }
}
exports.GameManager = GameManager;
// Export singleton instance
exports.gameManager = new GameManager();
