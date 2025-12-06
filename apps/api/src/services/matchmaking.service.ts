import { gameManager } from './game-manager.service';

interface QueuedPlayer {
  username: string;
  joinedAt: Date;
  timeoutId?: NodeJS.Timeout;
}

export class MatchmakingService {
  private queue: QueuedPlayer[] = [];
  private readonly MATCHMAKING_TIMEOUT = parseInt(process.env.MATCHMAKING_TIMEOUT_MS || '10000');

  joinQueue(username: string): void {
    if (this.queue.find(p => p.username === username)) {
      console.log(`⚠️  Player ${username} already in queue`);
      return;
    }

    if (gameManager.getGameByPlayer(username)) {
      console.log(`⚠️  Player ${username} already in a game`);
      return;
    }

    const player: QueuedPlayer = {
      username,
      joinedAt: new Date(),
    };

    this.queue.push(player);
    console.log(`📥 Player ${username} joined matchmaking queue (${this.queue.length} in queue)`);

    this.tryMatch();

    player.timeoutId = setTimeout(() => {
      this.startBotGame(username);
    }, this.MATCHMAKING_TIMEOUT);
  }

  leaveQueue(username: string): void {
    const index = this.queue.findIndex(p => p.username === username);
    if (index !== -1) {
      const player = this.queue[index];
      if (player.timeoutId) {
        clearTimeout(player.timeoutId);
      }
      this.queue.splice(index, 1);
      console.log(`📤 Player ${username} left matchmaking queue`);
    }
  }

  private tryMatch(): void {
    if (this.queue.length < 2) return;

    const player1 = this.queue.shift()!;
    const player2 = this.queue.shift()!;

    if (player1.timeoutId) clearTimeout(player1.timeoutId);
    if (player2.timeoutId) clearTimeout(player2.timeoutId);

    gameManager.createGame(player1.username, player2.username, false);

    console.log(`🎮 Matched ${player1.username} with ${player2.username}`);
  }

  private startBotGame(username: string): void {
    const index = this.queue.findIndex(p => p.username === username);
    if (index === -1) {
      console.log(`⚠️  Player ${username} not in queue for bot game`);
      return;
    }

    this.queue.splice(index, 1);

    const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
    const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
    const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
    gameManager.createGame(username, botName, true);

    console.log(`🤖 Started bot game for ${username} vs ${botName}`);
  }

  getQueueSize(): number {
    return this.queue.length;
  }

  getQueue(): QueuedPlayer[] {
    return [...this.queue];
  }
}

export const matchmakingService = new MatchmakingService();
