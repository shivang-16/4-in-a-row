import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { kafkaService } from '../services/kafka.service';
import { GameEventType } from '../types/events';
import { matchmakingService } from '../services/matchmaking.service';
import { gameManager } from '../services/game-manager.service';
import { Position, MAX_PLAYERS_PER_GAME, GameState } from '../types/game';

export class WebSocketService {
  private io: SocketIOServer;
  private connectedPlayers: Map<string, Socket> = new Map();
  /** Private lobby: host + invited players join until maxPlayers, then a game starts */
  private privateRooms: Map<
    string,
    {
      hostUsername: string;
      maxPlayers: number;
      members: Map<string, Socket>;
    }
  > = new Map();

  /** Invite-game rematch: same partyId across games until everyone votes to play again */
  private rematchPlayers: Map<string, string[]> = new Map();
  private rematchVotes: Map<string, Set<string>> = new Map();
  /** Countdown timers: start when first vote arrives; fires after 10s to start with whoever voted */
  private rematchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  /** Last win streak (4–8) for this party — reused on rematch so host choice persists */
  private rematchWinStreak: Map<string, number> = new Map();
  /** Voice call: tracks who is in the call for each game room */
  private callRooms: Map<string, Set<string>> = new Map(); // gameId → Set<username>

  constructor(httpServer: HTTPServer) {
    // Define allowed origins
    const allowedOrigins = [
      'https://4-in-a-row-web-kappa.vercel.app',
      'https://play.shivangyadav.com',
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
        const { username } = data;
        
        // Check if player has an active private room - they should not be in matchmaking
        const existingRoomCode = socket.data.roomCode;
        if (existingRoomCode && this.privateRooms.has(existingRoomCode)) {
          // Clean up the private room first
          this.privateRooms.delete(existingRoomCode);
          socket.data.roomCode = null;
          console.log(`🧹 Cleaned up private room ${existingRoomCode} for ${username} joining matchmaking`);
        }
        
        console.log(`🎮 Player ${username} joined matchmaking`);
        matchmakingService.joinQueue(username);
        socket.emit('matchmaking:queued', { position: matchmakingService.getQueueSize() });
      });

      // Handle player wanting to play with bot immediately
      socket.on('matchmaking:join-bot', (data: { username: string }) => {
        console.log(`🤖 Player ${data.username} requested bot game`);
        const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
        const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
        const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
        gameManager.createTwoPlayerGame(data.username, botName, true);
      });

      // Handle creating a private room (Play with Friend)
      socket.on('room:create', (data: { username: string }) => {
        const { username } = data;
        const maxPlayers = MAX_PLAYERS_PER_GAME; // host picks when starting; cap at 8

        // IMPORTANT: Remove player from matchmaking queue if they were there
        matchmakingService.leaveQueue(username);

        const roomCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        const members = new Map<string, Socket>();
        members.set(username, socket);

        this.privateRooms.set(roomCode, { hostUsername: username, maxPlayers, members });
        socket.data.roomCode = roomCode;
        socket.data.waitingRoomCode = roomCode;
        socket.join(`waiting-${roomCode}`);

        console.log(`🏠 Room created: ${roomCode} by ${username}`);

        socket.emit('room:created', { roomCode, hostUsername: username, players: [username] });
        this.io.to(`waiting-${roomCode}`).emit('room:lobbyUpdate', {
          players: [...members.keys()],
          maxPlayers,
          hostUsername: username,
        });
      });

      // Handle joining a private room
      socket.on('room:join', (data: { username: string; roomCode: string }) => {
        const { username, roomCode } = data;
        const normalizedCode = roomCode.toUpperCase().trim();

        const room = this.privateRooms.get(normalizedCode);

        if (!room) {
          socket.emit('room:error', { message: 'Room not found. Please check the code and try again.' });
          return;
        }

        if (room.hostUsername === username) {
          socket.emit('room:error', { message: 'You cannot join your own room!' });
          return;
        }

        if (room.members.has(username)) {
          room.members.set(username, socket);
          socket.data.waitingRoomCode = normalizedCode;
          socket.join(`waiting-${normalizedCode}`);
          socket.emit('room:joinPending', {
            roomCode: normalizedCode,
            players: [...room.members.keys()],
            maxPlayers: room.maxPlayers,
          });
          return;
        }

        if (room.members.size >= room.maxPlayers) {
          socket.emit('room:error', { message: 'This room is full.' });
          return;
        }

        console.log(`🤝 ${username} joining room ${normalizedCode} (${room.members.size + 1}/${room.maxPlayers})`);

        matchmakingService.leaveQueue(username);
        room.members.set(username, socket);
        socket.data.waitingRoomCode = normalizedCode;
        socket.join(`waiting-${normalizedCode}`);

        const playerList = [...room.members.keys()];
        this.io.to(`waiting-${normalizedCode}`).emit('room:lobbyUpdate', {
          players: playerList,
          maxPlayers: room.maxPlayers,
          hostUsername: room.hostUsername,
        });

        if (playerList.length < room.maxPlayers) {
          socket.emit('room:joinPending', {
            roomCode: normalizedCode,
            players: playerList,
            maxPlayers: room.maxPlayers,
            hostUsername: room.hostUsername,
          });
          return;
        }

        for (const u of playerList) {
          matchmakingService.leaveQueue(u);
        }

        this.privateRooms.delete(normalizedCode);
        for (const s of room.members.values()) {
          s.data.roomCode = null;
          s.data.waitingRoomCode = null;
          s.leave(`waiting-${normalizedCode}`);
        }

        const participants = playerList.map((u) => ({ username: u, isBot: false }));
        gameManager.createGame(participants, { isInviteGame: true });
        console.log(`🎮 Private game started: ${playerList.join(', ')}`);
      });

      // Handle leaving/canceling a private room (host closes lobby or guest leaves while waiting)
      socket.on('room:leave', () => {
        const roomCode = socket.data.roomCode as string | undefined;
        const waitingCode = socket.data.waitingRoomCode as string | undefined;
        const code = roomCode || waitingCode;
        if (!code || !this.privateRooms.has(code)) {
          socket.data.roomCode = null;
          socket.data.waitingRoomCode = null;
          return;
        }

        const room = this.privateRooms.get(code)!;
        const username = socket.data.username as string;

        if (room.hostUsername === username) {
          this.privateRooms.delete(code);
          this.io.to(`waiting-${code}`).emit('room:closed', { reason: 'Host left the lobby' });
          for (const s of room.members.values()) {
            s.data.roomCode = null;
            s.data.waitingRoomCode = null;
            s.leave(`waiting-${code}`);
          }
          room.members.clear();
          console.log(`🚪 Room ${code} closed by host`);
        } else {
          room.members.delete(username);
          socket.data.waitingRoomCode = null;
          socket.leave(`waiting-${code}`);
          const playerList = [...room.members.keys()];
          this.io.to(`waiting-${code}`).emit('room:lobbyUpdate', {
            players: playerList,
            maxPlayers: room.maxPlayers,
            hostUsername: room.hostUsername,
          });
          console.log(`🚪 ${username} left waiting room ${code}`);
        }

        socket.data.roomCode = null;
      });

      // Host manually starts the game with whoever is in the room
      socket.on('room:start', (data?: { winStreak?: number }) => {
        const code = (socket.data.roomCode || socket.data.waitingRoomCode) as string | undefined;
        if (!code) return;
        const room = this.privateRooms.get(code);
        if (!room) return;
        const username = socket.data.username as string;
        if (room.hostUsername !== username) {
          socket.emit('room:error', { message: 'Only the host can start the game.' });
          return;
        }
        const playerList = [...room.members.keys()];
        if (playerList.length < 2) {
          socket.emit('room:error', { message: 'Need at least 2 players to start.' });
          return;
        }
        for (const u of playerList) matchmakingService.leaveQueue(u);
        this.privateRooms.delete(code);
        for (const s of room.members.values()) {
          s.data.roomCode = null;
          s.data.waitingRoomCode = null;
          s.leave(`waiting-${code}`);
        }
        const participants = playerList.map((u) => ({ username: u, isBot: false }));
        gameManager.createGame(participants, { isInviteGame: true, winStreak: data?.winStreak });
        console.log(`🎮 Host started private game: ${playerList.join(', ')} (winStreak: ${data?.winStreak ?? 'default'})`);
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

          const waitingKey = (socket.data.waitingRoomCode || socket.data.roomCode) as string | undefined;
          if (waitingKey && this.privateRooms.has(waitingKey)) {
            const room = this.privateRooms.get(waitingKey)!;
            if (room.hostUsername === username) {
              this.privateRooms.delete(waitingKey);
              this.io.to(`waiting-${waitingKey}`).emit('room:closed', { reason: 'Host disconnected' });
              for (const s of room.members.values()) {
                s.data.roomCode = null;
                s.data.waitingRoomCode = null;
                s.leave(`waiting-${waitingKey}`);
              }
              room.members.clear();
              console.log(`🚪 Room ${waitingKey} closed due to host disconnect`);
            } else {
              room.members.delete(username);
              const playerList = [...room.members.keys()];
              this.io.to(`waiting-${waitingKey}`).emit('room:lobbyUpdate', {
                players: playerList,
                maxPlayers: room.maxPlayers,
              });
              console.log(`🚪 ${username} disconnected from waiting room ${waitingKey}`);
            }
          }

          console.log(`❌ Player disconnected: ${username}`);

          const game = gameManager.getGameByPlayer(username);
          if (game) {
            const gameId = game.id;
            console.log(`⏰ Starting 30s reconnection timer for ${username} in game ${gameId}`);

            setTimeout(() => {
              const stillDisconnected = !this.connectedPlayers.has(username);
              if (stillDisconnected && gameManager.getGame(gameId)) {
                console.log(`⚠️  Player ${username} didn't reconnect. Forfeiting game ${gameId}`);
                gameManager.removeDisconnectedPlayerFromGame(gameId, username);
              }
            }, 30000);
          }

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
        
        const game = gameManager.getGame(gameId);
        if (game) {
          const players = game.players;
          const usernames = players.map((p) => p.username);
          const seat = players.findIndex((p) => p.username === username);
          socket.emit('game:state', {
            gameId,
            board: game.board,
            currentTurn: game.currentTurn,
            status: game.status,
            players: usernames,
            playerUsernames: usernames,
            yourPlayerNumber: seat + 1,
            winStreak: game.winStreak,
            rankings: game.rankedOut ?? [],
            partyId: game.partyId,
            isInviteGame: game.isInviteGame,
          });
        }
        
        kafkaService.sendGameEvent(GameEventType.PLAYER_RECONNECTED, {
          gameId,
          username,
          timestamp: new Date().toISOString(),
        });
      });
      
      socket.on('party:rematch', (data: { partyId: string }) => {
        const username = socket.data.username as string | undefined;
        const partyId = data?.partyId;
        if (!username || !partyId) return;

        const players = this.rematchPlayers.get(partyId);
        if (!players?.length || !players.includes(username)) {
          socket.emit('game:error', { message: 'Rematch is not available for this game.' });
          return;
        }

        if (!this.rematchVotes.has(partyId)) {
          this.rematchVotes.set(partyId, new Set());
        }
        const votes = this.rematchVotes.get(partyId)!;
        votes.add(username);

        // Active = original players whose socket is still connected right now
        const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);

        if (activePlayers.length < 2) {
          this.cleanupRematch(partyId);
          for (const u of activePlayers) {
            this.connectedPlayers.get(u)?.emit('rematch:error', {
              message: 'Not enough players connected to rematch.',
            });
          }
          return;
        }

        // Broadcast current progress (only counting active voters)
        const activeVotes = [...votes].filter((u) => activePlayers.includes(u));
        const progressPayload = {
          partyId,
          votes: activeVotes.length,
          needed: activePlayers.length,
          voted: activeVotes,
        };
        for (const u of activePlayers) {
          this.connectedPlayers.get(u)?.emit('rematch:progress', progressPayload);
        }

        // Start a 10s countdown on the FIRST vote so late/disconnected players don't block
        if (!this.rematchTimers.has(partyId)) {
          const timer = setTimeout(() => {
            console.log(`⏰ Rematch timeout for party ${partyId} — starting with voters`);
            this.startRematchWithVoters(partyId);
          }, 30000);
          this.rematchTimers.set(partyId, timer);
        }

        // If all active players already voted, start immediately
        if (activeVotes.length >= activePlayers.length) {
          this.startRematchWithVoters(partyId);
        }
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

      // ── Voice call signaling ────────────────────────────────────────────────
      // Player starts a call — broadcast ring to everyone else in the game room
      socket.on('call:start', (data: { gameId: string }) => {
        const username = socket.data.username as string;
        const { gameId } = data;
        if (!username || !gameId) return;
        if (!this.callRooms.has(gameId)) this.callRooms.set(gameId, new Set());
        this.callRooms.get(gameId)!.add(username);
        socket.to(gameId).emit('call:ringing', { from: username, gameId });
        console.log(`📞 Call started by ${username} in game ${gameId}`);
      });

      // Player accepts call — join the call room, tell existing members to initiate offers
      socket.on('call:join', (data: { gameId: string }) => {
        const username = socket.data.username as string;
        const { gameId } = data;
        if (!username || !gameId) return;
        if (!this.callRooms.has(gameId)) this.callRooms.set(gameId, new Set());
        const members = this.callRooms.get(gameId)!;
        const existing = [...members]; // members before this joiner
        members.add(username);
        // Tell each existing member to create an offer for the new joiner
        for (const peer of existing) {
          const peerSock = this.connectedPlayers.get(peer);
          peerSock?.emit('call:peer_joined', { username, gameId });
        }
        // Tell the new joiner who is already in the call
        socket.emit('call:members', { members: existing, gameId });
        console.log(`📞 ${username} joined call in game ${gameId}. Members: ${[...members].join(', ')}`);
      });

      // Player rejects call
      socket.on('call:reject', (data: { gameId: string }) => {
        const username = socket.data.username as string;
        socket.to(data.gameId).emit('call:rejected', { username });
      });

      // Relay WebRTC offer to target peer
      socket.on('call:offer', (data: { to: string; offer: { type: string; sdp: string }; gameId: string }) => {
        const from = socket.data.username as string;
        const targetSock = this.connectedPlayers.get(data.to);
        targetSock?.emit('call:offer', { from, offer: data.offer, gameId: data.gameId });
      });

      // Relay WebRTC answer to target peer
      socket.on('call:answer', (data: { to: string; answer: { type: string; sdp: string }; gameId: string }) => {
        const from = socket.data.username as string;
        const targetSock = this.connectedPlayers.get(data.to);
        targetSock?.emit('call:answer', { from, answer: data.answer, gameId: data.gameId });
      });

      // Relay ICE candidate to target peer
      socket.on('call:ice', (data: { to: string; candidate: Record<string, unknown>; gameId: string }) => {
        const from = socket.data.username as string;
        const targetSock = this.connectedPlayers.get(data.to);
        targetSock?.emit('call:ice', { from, candidate: data.candidate });
      });

      // Player leaves call
      socket.on('call:leave', (data: { gameId: string }) => {
        const username = socket.data.username as string;
        const { gameId } = data;
        this.callRooms.get(gameId)?.delete(username);
        if (this.callRooms.get(gameId)?.size === 0) this.callRooms.delete(gameId);
        socket.to(gameId).emit('call:peer_left', { username, gameId });
        console.log(`📞 ${username} left call in game ${gameId}`);
      });

      socket.on('call:mute', (data: { gameId: string; muted: boolean }) => {
        const username = socket.data.username as string;
        socket.to(data.gameId).emit('call:mute', { username, muted: data.muted });
      });
    });
  }

  /** Called when timer fires OR all active players voted. Starts game with whoever voted. */
  private startRematchWithVoters(partyId: string) {
    const players = this.rematchPlayers.get(partyId);
    const votes = this.rematchVotes.get(partyId);
    if (!players || !votes) return; // already cleaned up

    // Participants = voted AND currently connected
    const participants = [...votes].filter((u) => this.connectedPlayers.get(u)?.connected);

    const winStreak = this.rematchWinStreak.get(partyId);
    this.cleanupRematch(partyId);

    if (participants.length < 2) {
      console.log(`⚠️  Rematch for ${partyId} cancelled — not enough voters (${participants.length})`);
      for (const u of participants) {
        this.connectedPlayers.get(u)?.emit('rematch:error', {
          message: 'Not enough players ready to start the rematch.',
        });
      }
      return;
    }

    try {
      gameManager.createGame(
        participants.map((u) => ({ username: u, isBot: false })),
        {
          isInviteGame: true,
          partyId,
          ...(winStreak != null ? { winStreak } : {}),
        }
      );
      console.log(
        `🔁 Rematch started for party ${partyId}: ${participants.join(', ')} (winStreak: ${winStreak ?? 'default'})`
      );
    } catch (e) {
      console.error('Rematch failed:', e);
      for (const u of participants) {
        this.connectedPlayers.get(u)?.emit('rematch:error', { message: 'Could not start rematch.' });
      }
    }
  }

  private cleanupRematch(partyId: string) {
    const timer = this.rematchTimers.get(partyId);
    if (timer) clearTimeout(timer);
    this.rematchTimers.delete(partyId);
    this.rematchVotes.delete(partyId);
    this.rematchPlayers.delete(partyId);
    this.rematchWinStreak.delete(partyId);
  }

  /** Notifies each human participant and joins them to the Socket.IO game room */
  public emitGameStart(game: GameState) {
    const gameId = game.id;
    const players = game.players;
    const usernames = players.map((p) => p.username);
    const isBotGame = players.some((p) => p.isBot);

    console.log(`🎮 Emitting game start to ${usernames.join(', ')} (${game.rows}×${game.cols})`);

    players.forEach((p, index) => {
      if (p.isBot) return;
      const sock = this.connectedPlayers.get(p.username);
      if (!sock) {
        console.warn(`⚠️  Player ${p.username} socket not found`);
        return;
      }
      sock.join(gameId);
      const others = usernames.filter((u) => u !== p.username);
      sock.emit('game:started', {
        gameId,
        board: game.board,
        rows: game.rows,
        cols: game.cols,
        players: usernames,
        playerUsernames: usernames,
        yourPlayerNumber: index + 1,
        playerCount: players.length,
        isBot: isBotGame,
        yourTurn: index === 0,
        opponent: others.length === 1 ? others[0] : undefined,
        isInviteGame: Boolean(game.isInviteGame),
        partyId: game.partyId,
        winStreak: game.winStreak,
        rankings: game.rankedOut ?? [],
      });
      console.log(`✅ Sent game:started to ${p.username} (seat ${index + 1}/${players.length})`);
    });

    kafkaService.sendGameEvent(GameEventType.GAME_STARTED, {
      gameId,
      player1: usernames[0],
      player2: usernames[1],
      players: usernames,
      isBot: isBotGame,
      rows: game.rows,
      cols: game.cols,
    });

    console.log(`🎮 Game started: ${gameId} - ${usernames.join(', ')}${isBotGame ? ' (BOT)' : ''}`);
  }

  // Emit game update to all players in the game
  public emitGameUpdate(gameId: string, data: any) {
    // console.log(`📤 Broadcasting game update to room ${gameId}:`, data);
    this.io.to(gameId).emit('game:update', data);
  }

  public registerInviteRematch(partyId: string, orderedHumanUsernames: string[], winStreak?: number) {
    if (!partyId || orderedHumanUsernames.length < 2) return;
    // Clear any leftover timer from a previous rematch cycle
    this.cleanupRematch(partyId);
    this.rematchPlayers.set(partyId, [...orderedHumanUsernames]);
    this.rematchVotes.set(partyId, new Set());
    if (winStreak != null) {
      this.rematchWinStreak.set(partyId, Math.max(4, Math.min(8, winStreak)));
    }
    console.log(
      `🔁 Rematch ready for party ${partyId}: ${orderedHumanUsernames.join(', ')} (winStreak: ${winStreak ?? 'default'})`
    );
  }

  // Emit game end event
  public emitGameEnd(
    gameId: string,
    winner: string | null,
    reason: string,
    winningCells?: Position[],
    rematch?: {
      partyId?: string;
      canRematch?: boolean;
      rematchPlayers?: string[];
    }
  ) {
    this.io.to(gameId).emit('game:ended', {
      gameId,
      winner,
      reason,
      winningCells,
      timestamp: new Date().toISOString(),
      partyId: rematch?.partyId,
      canRematch: rematch?.canRematch,
      rematchPlayers: rematch?.rematchPlayers,
    });

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
