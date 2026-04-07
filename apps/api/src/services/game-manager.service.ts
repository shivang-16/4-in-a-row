import { v4 as uuidv4 } from 'uuid';
import {
  GameState,
  GameStatus,
  CellValue,
  Player,
  Move,
  MoveResult,
  WinReason,
  Position,
  cellValueToSlotIndex,
  slotIndexToCellValue,
  MAX_PLAYERS_PER_GAME,
  boardSizeForPlayerCount,
} from '../types/game';
import { GameLogic } from './game-logic.service';
import { BotService } from './bot.service';
import { wsService } from '../websocket/websocket.service';
import { Game } from '../models/game.model';
import { kafkaService, GameEventType } from './kafka.service';

export type GameParticipantInput = { username: string; isBot: boolean };

export class GameManager {
  private activeGames: Map<string, GameState> = new Map();
  private playerToGame: Map<string, string> = new Map();

  /**
   * Creates a game from an ordered list of participants (turn order = array order).
   * Used by matchmaking (2 humans), bot queue (human + bot), and private rooms (2–8 humans).
   */
  createGame(
    participants: GameParticipantInput[],
    options?: { isInviteGame?: boolean; partyId?: string }
  ): GameState {
    if (participants.length < 2) {
      throw new Error('At least 2 players required');
    }
    if (participants.length > MAX_PLAYERS_PER_GAME) {
      throw new Error(`At most ${MAX_PLAYERS_PER_GAME} players`);
    }

    const gameId = uuidv4();
    const partyId =
      options?.isInviteGame === true
        ? options.partyId ?? uuidv4()
        : undefined;
    const { rows, cols } = boardSizeForPlayerCount(participants.length);
    const players: Player[] = participants.map((p) => ({
      id: uuidv4(),
      username: p.username,
      isBot: p.isBot,
      connected: !p.isBot,
    }));

    const scoringMode = players.length > 2;
    const scores = scoringMode ? players.map(() => 0) : undefined;

    const gameState: GameState = {
      id: gameId,
      board: GameLogic.createEmptyBoard(rows, cols),
      rows,
      cols,
      players,
      currentTurn: CellValue.PLAYER1,
      status: GameStatus.IN_PROGRESS,
      winner: null,
      winReason: null,
      moves: [],
      startedAt: new Date(),
      isInviteGame: options?.isInviteGame,
      partyId,
      scoringMode,
      scores,
    };

    this.activeGames.set(gameId, gameState);
    for (const p of players) {
      if (!p.isBot) {
        this.playerToGame.set(p.username, gameId);
      }
    }

    const names = players.map((p) => p.username).join(' vs ');
    console.log(`🎮 Game created: ${gameId} - ${names}`);

    if (wsService) {
      wsService.emitGameStart(gameState);
    }

    kafkaService.sendGameEvent(GameEventType.GAME_STARTED, {
      gameId,
      player1: players[0]?.username,
      player2: players[1]?.username,
      players: players.map((p) => p.username),
      isBot: players.some((p) => p.isBot),
    });

    return gameState;
  }

  /** Backward-compatible helper for two-player flows */
  createTwoPlayerGame(player1Username: string, player2Username: string, player2IsBot: boolean): GameState {
    return this.createGame([
      { username: player1Username, isBot: false },
      { username: player2Username, isBot: player2IsBot },
    ]);
  }

  makeMove(gameId: string, username: string, column: number): MoveResult {
    const game = this.activeGames.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== GameStatus.IN_PROGRESS) {
      return { success: false, error: 'Game is not in progress' };
    }

    const slot = cellValueToSlotIndex(game.currentTurn);
    const expectedUsername = game.players[slot]?.username;
    if (!expectedUsername || username !== expectedUsername) {
      const inGame = game.players.some((p) => p.username === username);
      if (!inGame) {
        return { success: false, error: 'Player not in this game' };
      }
      return { success: false, error: 'Not your turn' };
    }

    const result = game.scoringMode
      ? GameLogic.makeMoveScoring(game.board, column, game.currentTurn)
      : GameLogic.makeMove(game.board, column, game.currentTurn);

    if (!result.success) {
      return result;
    }

    const move: Move = {
      player: username,
      column,
      row: result.row!,
      timestamp: new Date(),
    };
    game.moves.push(move);

    if (game.scoringMode && game.scores) {
      game.scores[slot] += result.linesScored ?? 0;
    }

    kafkaService.sendGameEvent(GameEventType.MOVE_MADE, {
      gameId,
      player: username,
      column,
      row: result.row,
      moveNumber: game.moves.length,
    });

    if (game.scoringMode && result.scoringGameOver) {
      this.finishScoringGame(game, gameId);
    } else if (!game.scoringMode && (result.winningPlayer !== undefined || result.isDraw)) {
      game.status = GameStatus.COMPLETED;
      if (result.isDraw) {
        game.winner = null;
      } else {
        const winSlot = cellValueToSlotIndex(result.winningPlayer!);
        game.winner = game.players[winSlot]?.username ?? null;
      }
      game.winReason = result.winReason!;
      game.endedAt = new Date();

      if (wsService) {
        this.notifyInviteGameEnded(game, gameId, result.winReason!, result.winningCells);
      }

      this.saveGameToDatabase(game);

      kafkaService.sendGameEvent(GameEventType.GAME_ENDED, {
        gameId,
        winner: game.winner,
        reason: result.winReason,
        duration: game.endedAt.getTime() - game.startedAt.getTime(),
        totalMoves: game.moves.length,
      });

      this.cleanupGameMaps(gameId, game);
      console.log(`🧹 Cleaned up game ${gameId} from active games`);
    } else {
      const n = game.players.length;
      const nextSlot = (slot + 1) % n;
      game.currentTurn = slotIndexToCellValue(nextSlot);

      const nextPlayer = game.players[nextSlot];
      if (nextPlayer?.isBot) {
        setTimeout(() => this.makeBotMove(gameId), 1000);
      }
    }

    if (wsService) {
      wsService.emitGameUpdate(gameId, {
        board: game.board,
        currentTurn: game.currentTurn,
        lastMove: move,
        isGameOver: game.status === GameStatus.COMPLETED,
        scores: game.scoringMode ? game.scores : undefined,
        linesScored: game.scoringMode ? result.linesScored : undefined,
        scoringMode: game.scoringMode,
      });
    }

    return result;
  }

  /** After the last disc fills the board in scoring mode — highest total lines of 4 wins. */
  private finishScoringGame(game: GameState, gameId: string) {
    const scores = game.scores ?? game.players.map(() => 0);
    let maxScore = -1;
    const leaderIndices: number[] = [];
    for (let i = 0; i < game.players.length; i++) {
      const s = scores[i] ?? 0;
      if (s > maxScore) {
        maxScore = s;
        leaderIndices.length = 0;
        leaderIndices.push(i);
      } else if (s === maxScore) {
        leaderIndices.push(i);
      }
    }

    game.status = GameStatus.COMPLETED;
    game.endedAt = new Date();
    if (leaderIndices.length === 1) {
      game.winner = game.players[leaderIndices[0]]?.username ?? null;
      game.winReason = WinReason.MOST_POINTS;
    } else {
      game.winner = null;
      game.winReason = WinReason.SCORE_TIE;
    }

    if (wsService) {
      this.notifyInviteGameEnded(game, gameId, game.winReason, undefined);
    }

    this.saveGameToDatabase(game);

    kafkaService.sendGameEvent(GameEventType.GAME_ENDED, {
      gameId,
      winner: game.winner,
      reason: game.winReason,
      duration: game.endedAt.getTime() - game.startedAt.getTime(),
      totalMoves: game.moves.length,
    });

    this.cleanupGameMaps(gameId, game);
    console.log(`🧹 Scoring game finished ${gameId} — scores: ${scores.join(',')}`);
  }

  private makeBotMove(gameId: string) {
    const game = this.activeGames.get(gameId);
    if (!game || game.status !== GameStatus.IN_PROGRESS) return;

    const slot = cellValueToSlotIndex(game.currentTurn);
    const bot = game.players[slot];
    if (!bot?.isBot) return;

    const botService = new BotService(game.currentTurn);
    const column = botService.getBestMove(game.board);

    if (column !== -1) {
      this.makeMove(gameId, bot.username, column);
    }
  }

  private notifyInviteGameEnded(
    game: GameState,
    gameId: string,
    reason: WinReason,
    winningCells?: Position[]
  ) {
    if (!wsService) return;
    const humans = game.players.filter((p) => !p.isBot).map((p) => p.username);
    if (game.isInviteGame && game.partyId && humans.length >= 2) {
      wsService.registerInviteRematch(game.partyId, humans);
    }
    wsService.emitGameEnd(gameId, game.winner, reason, winningCells, {
      partyId: game.partyId,
      canRematch: Boolean(game.isInviteGame && game.partyId && humans.length >= 2),
      rematchPlayers: game.isInviteGame && game.partyId ? humans : undefined,
      scores: game.scoringMode ? game.scores : undefined,
      scoringMode: game.scoringMode,
    });
  }

  private cleanupGameMaps(gameId: string, game: GameState) {
    this.activeGames.delete(gameId);
    for (const p of game.players) {
      if (!p.isBot) {
        this.playerToGame.delete(p.username);
      }
    }
  }

  /**
   * After a disconnect timeout: remove that player from the game, remap discs + gravity,
   * and keep playing if at least two players remain; otherwise the sole remaining player wins.
   */
  removeDisconnectedPlayerFromGame(gameId: string, disconnectedUsername: string): boolean {
    const game = this.activeGames.get(gameId);
    if (!game || game.status !== GameStatus.IN_PROGRESS) return false;

    const removedIndex = game.players.findIndex((p) => p.username === disconnectedUsername);
    if (removedIndex === -1) return false;

    const oldN = game.players.length;
    const oldTurnSlot = cellValueToSlotIndex(game.currentTurn);

    GameLogic.remapBoardRemovePlayer(game.board, removedIndex);
    game.players.splice(removedIndex, 1);
    if (game.scores) {
      game.scores.splice(removedIndex, 1);
    }

    this.playerToGame.delete(disconnectedUsername);

    const newN = game.players.length;
    if (newN < 2) {
      const sole = game.players[0];
      game.status = GameStatus.COMPLETED;
      game.winner = sole?.username ?? null;
      game.winReason = WinReason.OPPONENT_DISCONNECT;
      game.endedAt = new Date();
      if (sole) {
        game.currentTurn = slotIndexToCellValue(0);
      }

      if (wsService) {
        wsService.emitGameUpdate(gameId, {
          board: game.board,
          currentTurn: game.currentTurn,
          scores: game.scoringMode ? game.scores : undefined,
          scoringMode: game.scoringMode,
          playerUsernames: game.players.map((p) => p.username),
          playerLeft: disconnectedUsername,
        });
        this.notifyInviteGameEnded(game, gameId, WinReason.OPPONENT_DISCONNECT, undefined);
      }

      this.saveGameToDatabase(game).catch((e) => console.error(e));
      this.cleanupGameMaps(gameId, game);
      return true;
    }

    let newTurnSlot: number;
    if (oldTurnSlot === removedIndex) {
      const nextOld = (removedIndex + 1) % oldN;
      newTurnSlot = nextOld > removedIndex ? nextOld - 1 : nextOld;
    } else {
      newTurnSlot = oldTurnSlot > removedIndex ? oldTurnSlot - 1 : oldTurnSlot;
    }
    game.currentTurn = slotIndexToCellValue(newTurnSlot);

    if (wsService) {
      wsService.emitGameUpdate(gameId, {
        board: game.board,
        currentTurn: game.currentTurn,
        scores: game.scoringMode ? game.scores : undefined,
        scoringMode: game.scoringMode,
        playerUsernames: game.players.map((p) => p.username),
        playerLeft: disconnectedUsername,
      });
    }

    const nextSlot = cellValueToSlotIndex(game.currentTurn);
    const nextPl = game.players[nextSlot];
    if (nextPl?.isBot) {
      setTimeout(() => this.makeBotMove(gameId), 1000);
    }

    return true;
  }

  getGame(gameId: string): GameState | undefined {
    return this.activeGames.get(gameId);
  }

  getGameByPlayer(username: string): GameState | undefined {
    const gameId = this.playerToGame.get(username);
    if (!gameId) return undefined;

    const game = this.activeGames.get(gameId);

    if (!game) {
      console.log(`🧹 Cleaning up stale player mapping for ${username} (game ${gameId} no longer exists)`);
      this.playerToGame.delete(username);
      return undefined;
    }

    return game;
  }

  clearPlayerMapping(username: string): void {
    if (this.playerToGame.has(username)) {
      console.log(`🧹 Cleared player mapping for ${username}`);
      this.playerToGame.delete(username);
    }
  }

  private async saveGameToDatabase(game: GameState) {
    try {
      const p0 = game.players[0];
      const p1 = game.players[1] ?? p0;
      await Game.create({
        gameId: game.id,
        player1: {
          username: p0.username,
          isBot: p0.isBot,
        },
        player2: {
          username: p1.username,
          isBot: p1.isBot,
        },
        allPlayers: game.players.map((p) => ({
          username: p.username,
          isBot: p.isBot,
        })),
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
    } catch (error) {
      console.error('Failed to save game to database:', error);
    }
  }

  getActiveGames(): GameState[] {
    return Array.from(this.activeGames.values());
  }
}

export const gameManager = new GameManager();
