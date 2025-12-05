# 🎮 4 in a Row - API Server

Real-time multiplayer game server for the classic Connect Four game.

## 🚀 Quick Start

### Development
```bash
# From the root of the monorepo
pnpm dev --filter=@emitrr/api

# Or from this directory
pnpm dev
```

### Build
```bash
pnpm build
```

### Production
```bash
pnpm start
```

## 📁 Project Structure

```
apps/api/
├── src/
│   ├── routes/         # API route handlers
│   ├── controllers/    # Business logic controllers
│   ├── services/       # Core game services (matchmaking, bot, etc.)
│   ├── models/         # Database models
│   ├── types/          # TypeScript type definitions
│   ├── utils/          # Utility functions
│   └── websocket/      # WebSocket handlers
├── app.ts              # Express app configuration
├── server.ts           # Server entry point
└── package.json
```

## 🛠 Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript
- **WebSocket**: (To be added)
- **Database**: PostgreSQL (To be added)
- **Message Queue**: Kafka (To be added)

## 📋 Features (Planned)

- [ ] Player matchmaking with 10s timeout
- [ ] Competitive bot opponent
- [ ] Real-time WebSocket gameplay
- [ ] Player reconnection (30s grace period)
- [ ] Leaderboard tracking
- [ ] Kafka analytics integration
- [ ] PostgreSQL persistence

## 🔧 Environment Variables

Copy `.env.example` to `.env` and configure:

```env
PORT=3001
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/emitrr
KAFKA_BROKER=localhost:9092
```

## 📊 API Endpoints

### Health Check
```
GET /health
```

Returns server status and timestamp.

## 🎯 Next Steps

1. ✅ Set up Express server with TypeScript
2. ✅ Install dependencies (express, cors, dotenv)
3. ✅ Create project structure
4. ⏳ Add WebSocket support
5. ⏳ Implement game logic
6. ⏳ Build matchmaking system
7. ⏳ Create competitive bot
8. ⏳ Set up PostgreSQL
9. ⏳ Integrate Kafka analytics
10. ⏳ Build frontend

---

**Assignment**: Backend Engineering Intern - 4 in a Row Game
