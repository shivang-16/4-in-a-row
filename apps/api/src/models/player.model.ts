import mongoose, { Schema, Document } from 'mongoose';

export interface IPlayer extends Document {
  username: string;
  gamesPlayed: number;
  gamesWon: number;
  gamesLost: number;
  gamesDraw: number;
  totalMoves: number;
  averageGameDuration: number;
  createdAt: Date;
  lastPlayedAt: Date;
}

const PlayerSchema = new Schema<IPlayer>(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    gamesPlayed: {
      type: Number,
      default: 0,
    },
    gamesWon: {
      type: Number,
      default: 0,
    },
    gamesLost: {
      type: Number,
      default: 0,
    },
    gamesDraw: {
      type: Number,
      default: 0,
    },
    totalMoves: {
      type: Number,
      default: 0,
    },
    averageGameDuration: {
      type: Number,
      default: 0,
    },
    lastPlayedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for leaderboard
PlayerSchema.index({ gamesWon: -1 });
PlayerSchema.index({ gamesPlayed: -1 });

export const Player = mongoose.model<IPlayer>('Player', PlayerSchema);
