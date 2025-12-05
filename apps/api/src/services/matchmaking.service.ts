import { gameManager } from './game-manager.service';

interface QueuedPlayer {
  username: string;
  joinedAt: Date;
  timeoutId?: NodeJS.Timeout;
}

export class MatchmakingService {
  private queue: QueuedPlayer[] = [];
  private readonly MATCHMAKING_TIMEOUT = parseInt(process.env.MATCHMAKING_TIMEOUT_MS || '10000');

  /**
   * Add a player to the matchmaking queue
   */
  joinQueue(username: string): void {
    // Check if player is already in queue
    if (this.queue.find(p => p.username === username)) {
      console.log(`⚠️  Player ${username} already in queue`);
      return;
    }

    // Check if player is already in a game
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

    // Try to match immediately
    this.tryMatch();

    // Set timeout to start bot game if no match found
    player.timeoutId = setTimeout(() => {
      this.startBotGame(username);
    }, this.MATCHMAKING_TIMEOUT);
  }

  /**
   * Remove a player from the queue
   */
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

  /**
   * Try to match two players from the queue
   */
  private tryMatch(): void {
    if (this.queue.length < 2) return;

    // Get the two oldest players in queue
    const player1 = this.queue.shift()!;
    const player2 = this.queue.shift()!;

    // Clear their timeouts
    if (player1.timeoutId) clearTimeout(player1.timeoutId);
    if (player2.timeoutId) clearTimeout(player2.timeoutId);

    // Create a game
    gameManager.createGame(player1.username, player2.username, false);

    console.log(`🎮 Matched ${player1.username} with ${player2.username}`);
  }

  /**
   * Start a game with a bot
   */
  private startBotGame(username: string): void {
    // Remove player from queue
    const index = this.queue.findIndex(p => p.username === username);
    if (index === -1) {
      console.log(`⚠️  Player ${username} not in queue for bot game`);
      return;
    }

    this.queue.splice(index, 1);

    // Create a game with bot
    const adjectives = ['Swift', 'Clever', 'Mighty', 'Shadow', 'Golden', 'Crystal', 'Thunder', 'Lunar', 'Cosmic', 'Blazing'];
    const nouns = ['Fox', 'Wolf', 'Dragon', 'Phoenix', 'Titan', 'Ninja', 'Knight', 'Wizard', 'Falcon', 'Panther'];
    const botName = `${adjectives[Math.floor(Math.random() * adjectives.length)]}${nouns[Math.floor(Math.random() * nouns.length)]}`;
    gameManager.createGame(username, botName, true);

    console.log(`🤖 Started bot game for ${username} vs ${botName}`);
  }

  /**
   * Get queue size
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Get queue
   */
  getQueue(): QueuedPlayer[] {
    return [...this.queue];
  }
}

// Export singleton instance
export const matchmakingService = new MatchmakingService();
