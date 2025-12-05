"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wsService = exports.WebSocketService = void 0;
exports.initializeWebSocket = initializeWebSocket;
const socket_io_1 = require("socket.io");
const kafka_service_1 = require("../services/kafka.service");
const events_1 = require("../types/events");
const matchmaking_service_1 = require("../services/matchmaking.service");
const game_manager_service_1 = require("../services/game-manager.service");
const game_1 = require("../types/game");
class WebSocketService {
    io;
    connectedPlayers = new Map();
    constructor(httpServer) {
        this.io = new socket_io_1.Server(httpServer, {
            cors: {
                origin: process.env.FRONTEND_URL || 'http://localhost:3000',
                methods: ['GET', 'POST'],
            },
        });
        this.setupEventHandlers();
        console.log('🔌 WebSocket server initialized');
    }
    setupEventHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`✅ Client connected: ${socket.id}`);
            // Handle player joining
            socket.on('player:join', (data) => {
                const { username } = data;
                this.connectedPlayers.set(username, socket);
                socket.data.username = username;
                console.log(`👤 Player joined: ${username}`);
                // Send Kafka event
                kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_JOINED, {
                    username,
                    socketId: socket.id,
                    timestamp: new Date().toISOString(),
                });
                socket.emit('player:joined', { username, socketId: socket.id });
            });
            // Handle player ready for matchmaking
            socket.on('matchmaking:join', (data) => {
                console.log(`🎮 Player ${data.username} joined matchmaking`);
                matchmaking_service_1.matchmakingService.joinQueue(data.username);
                socket.emit('matchmaking:queued', { position: matchmaking_service_1.matchmakingService.getQueueSize() });
            });
            // Handle player wanting to play with bot immediately
            socket.on('matchmaking:join-bot', (data) => {
                console.log(`🤖 Player ${data.username} requested bot game`);
                const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
                const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
                const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
                game_manager_service_1.gameManager.createGame(data.username, botName, true);
            });
            // Handle game moves
            socket.on('game:move', (data) => {
                const { gameId, column } = data;
                const username = socket.data.username;
                if (!username) {
                    socket.emit('error', { message: 'Username not set' });
                    return;
                }
                console.log(`🎯 Move from ${username} in game ${gameId}: column ${column}`);
                // Make the move using game manager
                const result = game_manager_service_1.gameManager.makeMove(gameId, username, column);
                if (!result.success) {
                    socket.emit('game:error', { message: result.error });
                    return;
                }
                // Game manager will emit updates via WebSocket
            });
            // Handle disconnection
            socket.on('disconnect', () => {
                const username = socket.data.username;
                if (username) {
                    this.connectedPlayers.delete(username);
                    matchmaking_service_1.matchmakingService.leaveQueue(username);
                    console.log(`❌ Player disconnected: ${username}`);
                    // Check if player was in a game
                    const game = game_manager_service_1.gameManager.getGameByPlayer(username);
                    if (game) {
                        console.log(`⏰ Starting 30s reconnection timer for ${username} in game ${game.id}`);
                        // Give player 30 seconds to reconnect
                        setTimeout(() => {
                            // Check if player reconnected
                            const stillDisconnected = !this.connectedPlayers.has(username);
                            if (stillDisconnected && game_manager_service_1.gameManager.getGame(game.id)) {
                                console.log(`⚠️  Player ${username} didn't reconnect. Forfeiting game ${game.id}`);
                                // Determine winner (the other player)
                                const winner = game.player1.username === username ? game.player2.username : game.player1.username;
                                // Update game state
                                game.status = game_1.GameStatus.COMPLETED;
                                game.winner = winner;
                                game.winReason = game_1.WinReason.OPPONENT_DISCONNECT;
                                game.endedAt = new Date();
                                // Notify the remaining player
                                this.emitGameEnd(game.id, winner, 'Opponent disconnected');
                                // Clean up
                                game_manager_service_1.gameManager['activeGames'].delete(game.id);
                                game_manager_service_1.gameManager['playerToGame'].delete(game.player1.username);
                                if (!game.player2.isBot) {
                                    game_manager_service_1.gameManager['playerToGame'].delete(game.player2.username);
                                }
                                console.log(`🧹 Cleaned up game ${game.id} due to disconnect timeout`);
                            }
                        }, 30000); // 30 seconds
                    }
                    // Send Kafka event
                    kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_DISCONNECTED, {
                        username,
                        socketId: socket.id,
                        timestamp: new Date().toISOString(),
                    });
                }
            });
            // Handle reconnection
            socket.on('game:reconnect', (data) => {
                const { gameId, username } = data;
                socket.join(gameId);
                socket.data.username = username;
                this.connectedPlayers.set(username, socket);
                console.log(`🔄 Player reconnected: ${username} to game ${gameId}`);
                // Get current game state
                const game = game_manager_service_1.gameManager.getGame(gameId);
                if (game) {
                    socket.emit('game:state', {
                        gameId,
                        board: game.board,
                        currentTurn: game.currentTurn,
                        status: game.status,
                    });
                }
                // Send Kafka event
                kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.PLAYER_RECONNECTED, {
                    gameId,
                    username,
                    timestamp: new Date().toISOString(),
                });
            });
            // Handle chat messages
            socket.on('chat:send', (data) => {
                const { gameId, message } = data;
                // Broadcast message to all players in the game room
                this.io.to(gameId).emit('chat:message', {
                    username: data.username,
                    message,
                });
                console.log(`💬 Chat message from ${data.username} in game ${gameId}: ${message}`);
            });
        });
    }
    // Emit game start event to both players
    emitGameStart(gameId, player1, player2, isBot) {
        const player1Socket = this.connectedPlayers.get(player1);
        const player2Socket = this.connectedPlayers.get(player2);
        console.log(`🎮 Emitting game start to ${player1} and ${player2}`);
        if (player1Socket) {
            player1Socket.join(gameId);
            player1Socket.emit('game:started', {
                gameId,
                opponent: player2,
                isBot,
                yourTurn: true,
            });
            console.log(`✅ Sent game:started to ${player1} (player 1, goes first)`);
        }
        else {
            console.warn(`⚠️  Player ${player1} socket not found`);
        }
        if (player2Socket && !isBot) {
            player2Socket.join(gameId);
            player2Socket.emit('game:started', {
                gameId,
                opponent: player1,
                isBot: false,
                yourTurn: false,
            });
            console.log(`✅ Sent game:started to ${player2} (player 2, waits)`);
        }
        else if (!isBot) {
            console.warn(`⚠️  Player ${player2} socket not found`);
        }
        // Send Kafka event
        kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.GAME_STARTED, {
            gameId,
            player1,
            player2,
            isBot,
        });
        console.log(`🎮 Game started: ${gameId} - ${player1} vs ${player2}${isBot ? ' (BOT)' : ''}`);
    }
    // Emit game update to all players in the game
    emitGameUpdate(gameId, data) {
        console.log(`📤 Broadcasting game update to room ${gameId}:`, data);
        this.io.to(gameId).emit('game:update', data);
    }
    // Emit game end event
    emitGameEnd(gameId, winner, reason) {
        this.io.to(gameId).emit('game:ended', {
            gameId,
            winner,
            reason,
            timestamp: new Date().toISOString(),
        });
        // Send Kafka event
        kafka_service_1.kafkaService.sendGameEvent(events_1.GameEventType.GAME_ENDED, {
            gameId,
            winner,
            reason,
        });
        console.log(`🏁 Game ended: ${gameId} - Winner: ${winner || 'DRAW'}`);
    }
    // Get number of players in matchmaking queue
    getQueueSize() {
        const room = this.io.sockets.adapter.rooms.get('matchmaking-queue');
        return room ? room.size : 0;
    }
    // Get WebSocket server instance
    getIO() {
        return this.io;
    }
}
exports.WebSocketService = WebSocketService;
function initializeWebSocket(httpServer) {
    exports.wsService = new WebSocketService(httpServer);
    return exports.wsService;
}
