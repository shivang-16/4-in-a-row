import { v4 as uuidv4 } from 'uuid';
import { GameState, GameStatus, CellValue, Player, Move, MoveResult } from '../types/game';
import { GameLogic } from './game-logic.service';
import { BotService } from './bot.service';
import { wsService } from '../websocket/websocket.service';
import { Game } from '../models/game.model';
import { kafkaService, GameEventType } from './kafka.service';

export class GameManager {
  private activeGames: Map<string, GameState> = new Map();
  private playerToGame: Map<string, string> = new Map();

  createGame(player1Username: string, player2Username: string, isBot: boolean = false): GameState {
    const gameId = uuidv4();
    
    const player1: Player = {
      id: uuidv4(),
      username: player1Username,
      isBot: false,
      connected: true,
    };

    const player2: Player = {
      id: uuidv4(),
      username: player2Username,
      isBot,
      connected: !isBot,
    };

    const gameState: GameState = {
      id: gameId,
      board: GameLogic.createEmptyBoard(),
      player1,
      player2,
      currentTurn: CellValue.PLAYER1,
      status: GameStatus.IN_PROGRESS,
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

    if (wsService) {
      wsService.emitGameStart(gameId, player1Username, player2Username, isBot);
    }

    kafkaService.sendGameEvent(GameEventType.GAME_STARTED, {
      gameId,
      player1: player1Username,
      player2: player2Username,
      isBot,
    });

    return gameState;
  }

  makeMove(gameId: string, username: string, column: number): MoveResult {
    const game = this.activeGames.get(gameId);
    if (!game) {
      return { success: false, error: 'Game not found' };
    }

    if (game.status !== GameStatus.IN_PROGRESS) {
      return { success: false, error: 'Game is not in progress' };
    }

    const isPlayer1 = game.player1.username === username;
    const isPlayer2 = game.player2.username === username;
    
    if (!isPlayer1 && !isPlayer2) {
      return { success: false, error: 'Player not in this game' };
    }

    const expectedPlayer = game.currentTurn === CellValue.PLAYER1 ? game.player1.username : game.player2.username;
    if (username !== expectedPlayer) {
      return { success: false, error: 'Not your turn' };
    }

    const result = GameLogic.makeMove(game.board, column, game.currentTurn);
    
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

    kafkaService.sendGameEvent(GameEventType.MOVE_MADE, {
      gameId,
      player: username,
      column,
      row: result.row,
      moveNumber: game.moves.length,
    });

    if (result.winner || result.isDraw) {
      game.status = GameStatus.COMPLETED;
      game.winner = result.winner === 'player1' ? game.player1.username : result.winner === 'player2' ? game.player2.username : null;
      game.winReason = result.winReason!;
      game.endedAt = new Date();

      if (wsService) {
        wsService.emitGameEnd(gameId, game.winner, result.winReason!, result.winningCells);
      }

      this.saveGameToDatabase(game);

      kafkaService.sendGameEvent(GameEventType.GAME_ENDED, {
        gameId,
        winner: game.winner,
        reason: result.winReason,
        duration: game.endedAt.getTime() - game.startedAt.getTime(),
        totalMoves: game.moves.length,
      });

      this.activeGames.delete(gameId);
      this.playerToGame.delete(game.player1.username);
      if (!game.player2.isBot) {
        this.playerToGame.delete(game.player2.username);
      }
      
      console.log(`🧹 Cleaned up game ${gameId} from active games`);
    } else {
      game.currentTurn = game.currentTurn === CellValue.PLAYER1 ? CellValue.PLAYER2 : CellValue.PLAYER1;

      if (game.currentTurn === CellValue.PLAYER2 && game.player2.isBot) {
        setTimeout(() => this.makeBotMove(gameId), 1000);
      }
    }

    if (wsService) {
      wsService.emitGameUpdate(gameId, {
        board: game.board,
        currentTurn: game.currentTurn,
        lastMove: move,
        isGameOver: game.status === GameStatus.COMPLETED,
      });
    }

    return result;
  }

  private makeBotMove(gameId: string) {
    const game = this.activeGames.get(gameId);
    if (!game || game.status !== GameStatus.IN_PROGRESS) return;

    const botService = new BotService(CellValue.PLAYER2);
    const column = botService.getBestMove(game.board);

    if (column !== -1) {
      this.makeMove(gameId, game.player2.username, column);
    }
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
      await Game.create({
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
    } catch (error) {
      console.error('Failed to save game to database:', error);
    }
  }

  getActiveGames(): GameState[] {
    return Array.from(this.activeGames.values());
  }
}

export const gameManager = new GameManager();
