import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import { kafkaService } from '../services/kafka.service';
import { GameEventType } from '../types/events';
import { matchmakingService } from '../services/matchmaking.service';
import { gameManager } from '../services/game-manager.service';
import { Position, MAX_PLAYERS_PER_GAME, GameState } from '../types/game';
import { wordPuzzleService, gridSizeForWordCount } from '../services/word-puzzle.service';
import { WPRoom, generateRoomCode } from '../types/word-puzzle';

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
      /** username → colorId they picked (e.g. "yellow", "cyan", …) */
      colorChoices: Map<string, string>;
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

  // ── Word Puzzle lobby & matchmaking ───────────────────────────────────────
  private wpRooms: Map<string, WPRoom> = new Map();
  /** Simple FIFO matchmaking queue for word puzzle */
  private wpQueue: { username: string; socket: Socket; wordCount: number }[] = [];
  private wpQueueTimer: ReturnType<typeof setTimeout> | null = null;
  // ── Word Puzzle rematch state ────────────────────────────────────────────
  private wpRematchPlayers: Map<string, string[]> = new Map(); // gameId → usernames
  private wpRematchVotes: Map<string, Set<string>> = new Map();
  private wpRematchTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private wpRematchWordCount: Map<string, number> = new Map();

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
        const colorChoices = new Map<string, string>();

        this.privateRooms.set(roomCode, { hostUsername: username, maxPlayers, members, colorChoices });
        socket.data.roomCode = roomCode;
        socket.data.waitingRoomCode = roomCode;
        socket.join(`waiting-${roomCode}`);

        console.log(`🏠 Room created: ${roomCode} by ${username}`);

        socket.emit('room:created', { roomCode, hostUsername: username, players: [username] });
        this.io.to(`waiting-${roomCode}`).emit('room:lobbyUpdate', {
          players: [...members.keys()],
          maxPlayers,
          hostUsername: username,
          colorChoices: Object.fromEntries(colorChoices),
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
            hostUsername: room.hostUsername,
            colorChoices: Object.fromEntries(room.colorChoices),
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
          colorChoices: Object.fromEntries(room.colorChoices),
        });

        if (playerList.length < room.maxPlayers) {
          socket.emit('room:joinPending', {
            roomCode: normalizedCode,
            players: playerList,
            maxPlayers: room.maxPlayers,
            hostUsername: room.hostUsername,
            colorChoices: Object.fromEntries(room.colorChoices),
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
          room.colorChoices.delete(username);
          socket.data.waitingRoomCode = null;
          socket.leave(`waiting-${code}`);
          const playerList = [...room.members.keys()];
          this.io.to(`waiting-${code}`).emit('room:lobbyUpdate', {
            players: playerList,
            maxPlayers: room.maxPlayers,
            hostUsername: room.hostUsername,
            colorChoices: Object.fromEntries(room.colorChoices),
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
        const colorChoicesSnapshot = Object.fromEntries(room.colorChoices);
        for (const u of playerList) matchmakingService.leaveQueue(u);
        this.privateRooms.delete(code);
        for (const s of room.members.values()) {
          s.data.roomCode = null;
          s.data.waitingRoomCode = null;
          s.leave(`waiting-${code}`);
        }
        const participants = playerList.map((u) => ({ username: u, isBot: false }));
        gameManager.createGame(participants, { isInviteGame: true, winStreak: data?.winStreak, colorChoices: colorChoicesSnapshot });
        console.log(`🎮 Host started private game: ${playerList.join(', ')} (winStreak: ${data?.winStreak ?? 'default'})`);
      });

      // Handle a player picking their ball color in the lobby
      socket.on('room:colorPick', (data: { colorId: string }) => {
        const code = (socket.data.roomCode || socket.data.waitingRoomCode) as string | undefined;
        if (!code) return;
        const room = this.privateRooms.get(code);
        if (!room) return;
        const username = socket.data.username as string;
        if (!room.members.has(username)) return;
        const { colorId } = data;

        // Check if another player already holds this color
        for (const [u, c] of room.colorChoices.entries()) {
          if (c === colorId && u !== username) {
            socket.emit('room:error', { message: 'That color is already taken by another player.' });
            return;
          }
        }

        if (colorId) {
          room.colorChoices.set(username, colorId);
        } else {
          room.colorChoices.delete(username);
        }

        this.io.to(`waiting-${code}`).emit('room:lobbyUpdate', {
          players: [...room.members.keys()],
          maxPlayers: room.maxPlayers,
          hostUsername: room.hostUsername,
          colorChoices: Object.fromEntries(room.colorChoices),
        });
        console.log(`🎨 ${username} picked color "${colorId}" in room ${code}`);
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
          // Remove from WP matchmaking queue
          this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
          // Clean up any WP waiting room
          this.handleWPRoomLeave(socket);

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
              room.colorChoices.delete(username);
              const playerList = [...room.members.keys()];
              this.io.to(`waiting-${waitingKey}`).emit('room:lobbyUpdate', {
                players: playerList,
                maxPlayers: room.maxPlayers,
                hostUsername: room.hostUsername,
                colorChoices: Object.fromEntries(room.colorChoices),
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
        const payload = { username: data.username, message };
        // Broadcast to plain room (4-in-a-row) and wp-game- prefixed room (word puzzle)
        this.io.to(gameId).to(`wp-game-${gameId}`).emit('chat:message', payload);
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
        socket.to(gameId).to(`wp-game-${gameId}`).emit('call:ringing', { from: username, gameId });
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
        socket.to(data.gameId).to(`wp-game-${data.gameId}`).emit('call:rejected', { username });
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
        socket.to(gameId).to(`wp-game-${gameId}`).emit('call:peer_left', { username, gameId });
        console.log(`📞 ${username} left call in game ${gameId}`);
      });

      socket.on('call:mute', (data: { gameId: string; muted: boolean }) => {
        const username = socket.data.username as string;
        socket.to(data.gameId).to(`wp-game-${data.gameId}`).emit('call:mute', { username, muted: data.muted });
      });

      // ── Word Puzzle events (wp: prefix) ────────────────────────────────────

      // Matchmaking: join queue
      socket.on('wp:matchmaking:join', (data: { username: string; wordCount?: number }) => {
        const { username } = data;
        const wordCount = data.wordCount ?? 14; // default: medium
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);

        // Remove from queue if already in
        this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
        this.wpQueue.push({ username, socket, wordCount });
        socket.emit('wp:matchmaking:queued', { position: this.wpQueue.length });
        console.log(`🔤 WP matchmaking: ${username} joined queue (size=${this.wpQueue.length}, words=${wordCount})`);

        if (this.wpQueue.length >= 2) {
          const pair = this.wpQueue.splice(0, 2);
          // Use the average word count of the two matched players (rounded to nearest defined level)
          const avgWc = Math.round(((pair[0]?.wordCount ?? 14) + (pair[1]?.wordCount ?? 14)) / 2);
          this.startWPGame(pair.map((e) => ({ username: e.username, socket: e.socket })), avgWc);
        }
      });

      // Solo play: start an instant single-player game
      socket.on('wp:solo:start', (data: { username: string; wordCount?: number }) => {
        const { username } = data;
        const wordCount = data.wordCount ?? 14;
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);
        console.log(`🔤 WP solo game starting for ${username} (words=${wordCount})`);
        this.startWPGame([{ username, socket }], wordCount);
      });

      // Matchmaking: leave queue
      socket.on('wp:matchmaking:leave', () => {
        const username = socket.data.username as string;
        if (username) {
          this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
        }
      });

      // Room: create
      socket.on('wp:room:create', (data: { username: string }) => {
        const { username } = data;
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);

        // Remove from WP queue if present
        this.wpQueue = this.wpQueue.filter((e) => e.username !== username);

        const code = generateRoomCode();
        const members = new Map<string, Socket>();
        members.set(username, socket);
        const room: WPRoom = { code, hostUsername: username, members, wordCount: 10 };
        this.wpRooms.set(code, room);
        socket.data.wpRoomCode = code;
        socket.join(`wp-waiting-${code}`);

        socket.emit('wp:room:created', { roomCode: code, hostUsername: username });
        this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
          players: [username],
          hostUsername: username,
          wordCount: room.wordCount,
          maxPlayers: MAX_PLAYERS_PER_GAME,
        });
        console.log(`🔤 WP room created: ${code} by ${username}`);
      });

      // Room: join
      socket.on('wp:room:join', (data: { username: string; roomCode: string }) => {
        const { username, roomCode } = data;
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);
        const code = roomCode.toUpperCase().trim();
        const room = this.wpRooms.get(code);

        if (!room) {
          socket.emit('wp:room:error', { message: 'Room not found. Check the code and try again.' });
          return;
        }
        if (room.members.size >= MAX_PLAYERS_PER_GAME) {
          socket.emit('wp:room:error', { message: 'This room is full (max 8 players).' });
          return;
        }
        if (room.members.has(username)) {
          room.members.set(username, socket);
          socket.data.wpRoomCode = code;
          socket.join(`wp-waiting-${code}`);
          socket.emit('wp:room:joinPending', {
            roomCode: code,
            players: [...room.members.keys()],
            hostUsername: room.hostUsername,
            wordCount: room.wordCount,
            maxPlayers: MAX_PLAYERS_PER_GAME,
          });
          return;
        }

        this.wpQueue = this.wpQueue.filter((e) => e.username !== username);
        room.members.set(username, socket);
        socket.data.wpRoomCode = code;
        socket.join(`wp-waiting-${code}`);

        const playerList = [...room.members.keys()];
        this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
          players: playerList,
          hostUsername: room.hostUsername,
          wordCount: room.wordCount,
          maxPlayers: MAX_PLAYERS_PER_GAME,
        });
        socket.emit('wp:room:joinPending', {
          roomCode: code,
          players: playerList,
          hostUsername: room.hostUsername,
          wordCount: room.wordCount,
          maxPlayers: MAX_PLAYERS_PER_GAME,
        });
        console.log(`🔤 ${username} joined WP room ${code}`);
      });

      // Room: leave
      socket.on('wp:room:leave', () => {
        this.handleWPRoomLeave(socket);
      });

      // Host sets word count
      socket.on('wp:room:setWordCount', (data: { wordCount: number }) => {
        const code = socket.data.wpRoomCode as string | undefined;
        if (!code) return;
        const room = this.wpRooms.get(code);
        if (!room || room.hostUsername !== socket.data.username) return;
        room.wordCount = Math.max(10, Math.min(20, data.wordCount));
        this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
          players: [...room.members.keys()],
          hostUsername: room.hostUsername,
          wordCount: room.wordCount,
          maxPlayers: MAX_PLAYERS_PER_GAME,
        });
        console.log(`🔤 WP room ${code}: word count set to ${room.wordCount}`);
      });

      // Host starts game
      socket.on('wp:room:start', () => {
        const code = socket.data.wpRoomCode as string | undefined;
        if (!code) return;
        const room = this.wpRooms.get(code);
        if (!room) return;
        if (room.hostUsername !== socket.data.username) {
          socket.emit('wp:room:error', { message: 'Only the host can start the game.' });
          return;
        }
        if (room.members.size < 2) {
          socket.emit('wp:room:error', { message: 'Need at least 2 players to start.' });
          return;
        }

        const playerList = [...room.members.keys()];
        const sockets = [...room.members.values()];

        // Clean up room
        this.wpRooms.delete(code);
        for (const s of sockets) {
          s.data.wpRoomCode = null;
          s.leave(`wp-waiting-${code}`);
        }

        this.startWPGame(
          playerList.map((u) => ({ username: u, socket: room.members.get(u)! })),
          room.wordCount
        );
        console.log(`🔤 WP room ${code} game started: ${playerList.join(', ')}`);
      });

      // Player claims a word
      socket.on('wp:game:claim', (data: { gameId: string; startRow: number; startCol: number; endRow: number; endCol: number }) => {
        const username = socket.data.username as string;
        const { gameId, startRow, startCol, endRow, endCol } = data;
        if (!username || !gameId) return;

        const result = wordPuzzleService.claimWord(gameId, username, startRow, startCol, endRow, endCol);
        if (!result) {
          socket.emit('wp:game:claimFailed', { message: 'Invalid selection or word already claimed.' });
          return;
        }

        const { word, player } = result;
        const game = wordPuzzleService.getGame(gameId)!;

        // Broadcast the claim to all players in the game room
        this.io.to(`wp-game-${gameId}`).emit('wp:game:wordClaimed', {
          wordId: word.id,
          word: word.word,
          cells: word.cells,
          claimedBy: username,
          colorIndex: player.colorIndex,
          score: player.score,
          players: game.players.map((p) => ({ username: p.username, score: p.score, colorIndex: p.colorIndex })),
        });

        // If game ended, emit game over
        if (game.status === 'ended') {
          const sorted = [...game.players].sort((a, b) => b.score - a.score);
          const playerUsernames = game.players.map((p) => p.username);
          // Register rematch so players can play again
          this.wpRematchPlayers.set(gameId, playerUsernames);
          this.wpRematchVotes.set(gameId, new Set());
          this.wpRematchWordCount.set(gameId, game.wordCount);

          this.io.to(`wp-game-${gameId}`).emit('wp:game:ended', {
            gameId,
            players: sorted.map((p) => ({ username: p.username, score: p.score, colorIndex: p.colorIndex })),
            winner: sorted[0]?.username ?? null,
            words: game.words,
          });
          setTimeout(() => wordPuzzleService.deleteGame(gameId), 60000);
          console.log(`🏁 WP game ${gameId} ended. Winner: ${sorted[0]?.username}`);
        }
      });

      // Reconnect to a word puzzle game
      socket.on('wp:game:reconnect', (data: { gameId: string; username: string }) => {
        const { gameId, username } = data;
        socket.data.username = username;
        this.connectedPlayers.set(username, socket);
        socket.join(`wp-game-${gameId}`);
        wordPuzzleService.updateSocketId(gameId, username, socket.id);

        const game = wordPuzzleService.getGame(gameId);
        if (game) {
          socket.emit('wp:game:state', {
            gameId: game.id,
            board: game.board,
            gridSize: game.gridSize,
            words: game.words,
            players: game.players,
            wordCount: game.wordCount,
            status: game.status,
          });
        }
      });

      // ── Word Puzzle rematch ─────────────────────────────────────────────────
      socket.on('wp:rematch', (data: { gameId: string }) => {
        const username = socket.data.username as string;
        const { gameId } = data;
        if (!username || !gameId) return;

        const players = this.wpRematchPlayers.get(gameId);
        if (!players?.length || !players.includes(username)) {
          socket.emit('wp:rematch:error', { message: 'Rematch is not available.' });
          return;
        }

        if (!this.wpRematchVotes.has(gameId)) {
          this.wpRematchVotes.set(gameId, new Set());
        }
        const votes = this.wpRematchVotes.get(gameId)!;
        votes.add(username);

        const activePlayers = players.filter((u) => this.connectedPlayers.get(u)?.connected);

        if (activePlayers.length < 2) {
          this.cleanupWPRematch(gameId);
          for (const u of activePlayers) {
            this.connectedPlayers.get(u)?.emit('wp:rematch:error', {
              message: 'Not enough players connected to rematch.',
            });
          }
          return;
        }

        const activeVotes = [...votes].filter((u) => activePlayers.includes(u));
        const progressPayload = {
          gameId,
          votes: activeVotes.length,
          needed: activePlayers.length,
          voted: activeVotes,
        };
        for (const u of activePlayers) {
          this.connectedPlayers.get(u)?.emit('wp:rematch:progress', progressPayload);
        }

        // Start 30s timer on first vote
        if (!this.wpRematchTimers.has(gameId)) {
          const timer = setTimeout(() => {
            console.log(`⏰ WP rematch timeout for game ${gameId} — starting with voters`);
            this.startWPRematchWithVoters(gameId);
          }, 30000);
          this.wpRematchTimers.set(gameId, timer);
        }

        // If all active players voted, start immediately
        if (activeVotes.length >= activePlayers.length) {
          this.startWPRematchWithVoters(gameId);
        }
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

  private startWPRematchWithVoters(gameId: string) {
    const players = this.wpRematchPlayers.get(gameId);
    const votes = this.wpRematchVotes.get(gameId);
    if (!players || !votes) return;

    const participants = [...votes].filter((u) => this.connectedPlayers.get(u)?.connected);
    const wordCount = this.wpRematchWordCount.get(gameId) ?? 14;
    this.cleanupWPRematch(gameId);

    if (participants.length < 2) {
      console.log(`⚠️  WP rematch for ${gameId} cancelled — not enough voters (${participants.length})`);
      for (const u of participants) {
        this.connectedPlayers.get(u)?.emit('wp:rematch:error', {
          message: 'Not enough players ready to rematch.',
        });
      }
      return;
    }

    const playerData = participants.map((u) => ({
      username: u,
      socket: this.connectedPlayers.get(u)!,
    }));

    this.startWPGame(playerData, wordCount);
    console.log(`🔁 WP rematch started: ${participants.join(', ')} (words: ${wordCount})`);
  }

  private cleanupWPRematch(gameId: string) {
    const timer = this.wpRematchTimers.get(gameId);
    if (timer) clearTimeout(timer);
    this.wpRematchTimers.delete(gameId);
    this.wpRematchVotes.delete(gameId);
    this.wpRematchPlayers.delete(gameId);
    this.wpRematchWordCount.delete(gameId);
  }

  // ── Word Puzzle helpers ──────────────────────────────────────────────────

  private startWPGame(players: { username: string; socket: Socket }[], wordCount: number) {
    const game = wordPuzzleService.createGame(
      players.map((p) => ({ username: p.username })),
      wordCount
    );

    for (const p of players) {
      p.socket.join(`wp-game-${game.id}`);
      p.socket.data.wpGameId = game.id;
      wordPuzzleService.updateSocketId(game.id, p.username, p.socket.id);
    }

    const playerMeta = game.players.map((p) => ({
      username: p.username,
      score: p.score,
      colorIndex: p.colorIndex,
    }));

    // Emit game started to each player with their seat info
    for (const p of players) {
      const seat = game.players.findIndex((gp) => gp.username === p.username);
      p.socket.emit('wp:game:started', {
        gameId: game.id,
        board: game.board,
        gridSize: game.gridSize,
        words: game.words.map((w) => ({
          id: w.id,
          word: w.word,
          cells: w.cells,
          claimedBy: w.claimedBy,
          claimedAt: w.claimedAt,
        })),
        players: playerMeta,
        wordCount: game.wordCount,
        yourColorIndex: seat % 8,
        yourUsername: p.username,
      });
    }
    console.log(`🔤 WP game started: ${game.id} (${players.map((p) => p.username).join(', ')})`);
  }

  private handleWPRoomLeave(socket: Socket) {
    const code = socket.data.wpRoomCode as string | undefined;
    if (!code) return;
    const room = this.wpRooms.get(code);
    if (!room) return;
    const username = socket.data.username as string;

    if (room.hostUsername === username) {
      this.wpRooms.delete(code);
      this.io.to(`wp-waiting-${code}`).emit('wp:room:closed', { reason: 'Host left the lobby' });
      for (const s of room.members.values()) {
        s.data.wpRoomCode = null;
        s.leave(`wp-waiting-${code}`);
      }
      room.members.clear();
      console.log(`🚪 WP room ${code} closed by host`);
    } else {
      room.members.delete(username);
      socket.data.wpRoomCode = null;
      socket.leave(`wp-waiting-${code}`);
      this.io.to(`wp-waiting-${code}`).emit('wp:room:lobbyUpdate', {
        players: [...room.members.keys()],
        hostUsername: room.hostUsername,
        wordCount: room.wordCount,
        maxPlayers: MAX_PLAYERS_PER_GAME,
      });
      console.log(`🚪 ${username} left WP room ${code}`);
    }
    socket.data.wpRoomCode = null;
  }

  /** Notifies each human participant and joins them to the Socket.IO game room */
  public emitGameStart(game: GameState, colorChoices?: Record<string, string>) {
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
        colorChoices: colorChoices ?? {},
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
