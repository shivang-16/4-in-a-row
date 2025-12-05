export enum GameEventType {
  GAME_STARTED = 'game_started',
  MOVE_MADE = 'move_made',
  GAME_ENDED = 'game_ended',
  PLAYER_JOINED = 'player_joined',
  PLAYER_DISCONNECTED = 'player_disconnected',
  PLAYER_RECONNECTED = 'player_reconnected',
  BOT_JOINED = 'bot_joined',
}

export interface GameEvent {
  eventType: GameEventType;
  timestamp: string;
  data: any;
}

export interface GameStartedEvent {
  gameId: string;
  player1: string;
  player2: string;
  isBot: boolean;
}

export interface MoveMadeEvent {
  gameId: string;
  player: string;
  column: number;
  row: number;
  moveNumber: number;
}

export interface GameEndedEvent {
  gameId: string;
  winner: string | null;
  reason: 'win' | 'draw' | 'forfeit';
  duration: number; // in milliseconds
  totalMoves: number;
}

export interface PlayerJoinedEvent {
  gameId: string;
  username: string;
  timestamp: string;
}

export interface PlayerDisconnectedEvent {
  gameId: string;
  username: string;
  timestamp: string;
}
