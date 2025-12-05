import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { kafkaService } from '../services/kafka.service';
import { GameEventType } from '../types/events';
import { matchmakingService } from '../services/matchmaking.service';
import { gameManager } from '../services/game-manager.service';
import { WinReason, GameStatus } from '../types/game';

export class WebSocketService {
  private io: SocketIOServer;
  private connectedPlayers: Map<string, Socket> = new Map();

  constructor(httpServer: HTTPServer) {
    // Define allowed origins
    const allowedOrigins = [
      'https://4-in-a-row-web-kappa.vercel.app',
      'http://localhost:3000',
      process.env.FRONTEND_URL,
    ].filter(Boolean) as string[];

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: allowedOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupEventHandlers();
    console.log('🔌 WebSocket server initialized');
  }

  private setupEventHandlers() {
    this.io.on('connection', (socket: Socket) => {
      console.log(`✅ Client connected: ${socket.id}`);

      // Handle player joining
      socket.on('player:join', (data: { username: string }) => {
        const { username } = data;
        this.connectedPlayers.set(username, socket);
        socket.data.username = username;
        
        console.log(`👤 Player joined: ${username}`);
        
        // Send Kafka event
        kafkaService.sendGameEvent(GameEventType.PLAYER_JOINED, {
          username,
          socketId: socket.id,
          timestamp: new Date().toISOString(),
        });

        socket.emit('player:joined', { username, socketId: socket.id });
      });

      // Handle player ready for matchmaking
      socket.on('matchmaking:join', (data: { username: string }) => {
        console.log(`🎮 Player ${data.username} joined matchmaking`);
        matchmakingService.joinQueue(data.username);
        socket.emit('matchmaking:queued', { position: matchmakingService.getQueueSize() });
      });

      // Handle player wanting to play with bot immediately
      socket.on('matchmaking:join-bot', (data: { username: string }) => {
        console.log(`🤖 Player ${data.username} requested bot game`);
        const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
        const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
        const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
        gameManager.createGame(data.username, botName, true);
      });

      // Handle game moves
      socket.on('game:move', (data: { gameId: string; column: number }) => {
        const { gameId, column } = data;
        const username = socket.data.username;
        
        if (!username) {
          socket.emit('error', { message: 'Username not set' });
          return;
        }

        console.log(`🎯 Move from ${username} in game ${gameId}: column ${column}`);
        
        // Make the move using game manager
        const result = gameManager.makeMove(gameId, username, column);
        
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
          matchmakingService.leaveQueue(username);
          console.log(`❌ Player disconnected: ${username}`);
          
          // Check if player was in a game
          const game = gameManager.getGameByPlayer(username);
          if (game) {
            console.log(`⏰ Starting 30s reconnection timer for ${username} in game ${game.id}`);
            
            // Give player 30 seconds to reconnect
            setTimeout(() => {
              // Check if player reconnected
              const stillDisconnected = !this.connectedPlayers.has(username);
              if (stillDisconnected && gameManager.getGame(game.id)) {
                console.log(`⚠️  Player ${username} didn't reconnect. Forfeiting game ${game.id}`);
                
                // Determine winner (the other player)
                const winner = game.player1.username === username ? game.player2.username : game.player1.username;
                
                // Update game state
                game.status = GameStatus.COMPLETED;
                game.winner = winner;
                game.winReason = WinReason.OPPONENT_DISCONNECT;
                game.endedAt = new Date();
                
                // Notify the remaining player
                this.emitGameEnd(game.id, winner, 'Opponent disconnected');
                
                // Clean up
                gameManager['activeGames'].delete(game.id);
                gameManager['playerToGame'].delete(game.player1.username);
                if (!game.player2.isBot) {
                  gameManager['playerToGame'].delete(game.player2.username);
                }
                
                console.log(`🧹 Cleaned up game ${game.id} due to disconnect timeout`);
              }
            }, 30000); // 30 seconds
          }
          
          // Send Kafka event
          kafkaService.sendGameEvent(GameEventType.PLAYER_DISCONNECTED, {
            username,
            socketId: socket.id,
            timestamp: new Date().toISOString(),
          });
        }
      });

      // Handle reconnection
      socket.on('game:reconnect', (data: { gameId: string; username: string }) => {
        const { gameId, username } = data;
        socket.join(gameId);
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);
        
        console.log(`🔄 Player reconnected: ${username} to game ${gameId}`);
        
        // Get current game state
        const game = gameManager.getGame(gameId);
        if (game) {
          socket.emit('game:state', {
            gameId,
            board: game.board,
            currentTurn: game.currentTurn,
            status: game.status,
          });
        }
        
        // Send Kafka event
        kafkaService.sendGameEvent(GameEventType.PLAYER_RECONNECTED, {
          gameId,
          username,
          timestamp: new Date().toISOString(),
        });
      });
      
      // Handle chat messages
      socket.on('chat:send', (data: { gameId: string; username: string; message: string }) => {
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
  public emitGameStart(gameId: string, player1: string, player2: string, isBot: boolean) {
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
    } else {
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
    } else if (!isBot) {
      console.warn(`⚠️  Player ${player2} socket not found`);
    }

    // Send Kafka event
    kafkaService.sendGameEvent(GameEventType.GAME_STARTED, {
      gameId,
      player1,
      player2,
      isBot,
    });

    console.log(`🎮 Game started: ${gameId} - ${player1} vs ${player2}${isBot ? ' (BOT)' : ''}`);
  }

  // Emit game update to all players in the game
  public emitGameUpdate(gameId: string, data: any) {
    console.log(`📤 Broadcasting game update to room ${gameId}:`, data);
    this.io.to(gameId).emit('game:update', data);
  }

  // Emit game end event
  public emitGameEnd(gameId: string, winner: string | null, reason: string) {
    this.io.to(gameId).emit('game:ended', {
      gameId,
      winner,
      reason,
      timestamp: new Date().toISOString(),
    });

    // Send Kafka event
    kafkaService.sendGameEvent(GameEventType.GAME_ENDED, {
      gameId,
      winner,
      reason,
    });

    console.log(`🏁 Game ended: ${gameId} - Winner: ${winner || 'DRAW'}`);
  }

  // Get number of players in matchmaking queue
  private getQueueSize(): number {
    const room = this.io.sockets.adapter.rooms.get('matchmaking-queue');
    return room ? room.size : 0;
  }

  // Get WebSocket server instance
  public getIO(): SocketIOServer {
    return this.io;
  }
}

export let wsService: WebSocketService;

export function initializeWebSocket(httpServer: HTTPServer): WebSocketService {
  wsService = new WebSocketService(httpServer);
  return wsService;
}
