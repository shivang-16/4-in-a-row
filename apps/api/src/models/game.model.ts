import mongoose, { Schema, Document } from 'mongoose';
import { Board, GameStatus, WinReason } from '../types/game';

export interface IGame extends Document {
  gameId: string;
  player1: {
    username: string;
    isBot: boolean;
  };
  player2: {
    username: string;
    isBot: boolean;
  };
  board: Board;
  status: GameStatus;
  winner: string | null;
  winReason: WinReason | null;
  moves: Array<{
    player: string;
    column: number;
    row: number;
    timestamp: Date;
  }>;
  startedAt: Date;
  endedAt?: Date;
  duration?: number; // in milliseconds
}

const GameSchema = new Schema<IGame>(
  {
    gameId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    player1: {
      username: { type: String, required: true },
      isBot: { type: Boolean, default: false },
    },
    player2: {
      username: { type: String, required: true },
      isBot: { type: Boolean, default: false },
    },
    board: {
      type: [[Number]],
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(GameStatus),
      default: GameStatus.IN_PROGRESS,
    },
    winner: {
      type: String,
      default: null,
    },
    winReason: {
      type: String,
      enum: [...Object.values(WinReason), null],
      default: null,
    },
    moves: [
      {
        player: { type: String, required: true },
        column: { type: Number, required: true },
        row: { type: Number, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
    duration: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

// Index for leaderboard queries
GameSchema.index({ winner: 1, status: 1 });
GameSchema.index({ 'player1.username': 1 });
GameSchema.index({ 'player2.username': 1 });

export const Game = mongoose.model<IGame>('Game', GameSchema);
