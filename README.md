# 🎮 4 in a Row - Multiplayer Game

A real-time multiplayer **Connect 4 (4 in a Row)** game built with modern web technologies. Play against other players online, challenge an AI bot, or invite friends to play with private room codes!

![Game Preview](https://img.shields.io/badge/Status-Live-brightgreen) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue) ![Next.js](https://img.shields.io/badge/Next.js-16-black) ![Socket.IO](https://img.shields.io/badge/Socket.IO-4.8-white)

## ✨ Features

### 🎲 Game Modes
- **Find Player** - Random matchmaking with other online players
- **Play with Bot** - Challenge a strategic AI opponent
- **Play with Friend** - Create private rooms with shareable codes

### 🎨 Visual Experience
- Beautiful 3D wooden board design with glass morphism effects
- Smooth disc drop animations with bounce effects
- **Winning line highlight** with golden pulsing glow animation
- Fully responsive design for desktop, tablet, and mobile

### 💬 Real-time Features
- Live game updates via WebSocket
- In-game chat with unread message badges
- Automatic reconnection handling
- 30-second disconnect timeout

### 🔊 Audio
- Background music toggle
- Disc drop sound effects
- Game end celebration sounds

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 16, React 19, TypeScript |
| **Backend** | Node.js, Express, TypeScript |
| **Real-time** | Socket.IO |
| **Database** | MongoDB (Mongoose) |
| **Message Queue** | Apache Kafka |
| **Build System** | Turborepo, pnpm |
| **Styling** | CSS Modules |

## 📁 Project Structure

```
emitrr/
├── apps/
│   ├── api/                    # Backend API server
│   │   ├── src/
│   │   │   ├── models/         # MongoDB models
│   │   │   ├── services/       # Business logic
│   │   │   │   ├── game-logic.service.ts
│   │   │   │   ├── game-manager.service.ts
│   │   │   │   ├── bot.service.ts
│   │   │   │   ├── matchmaking.service.ts
│   │   │   │   └── kafka.service.ts
│   │   │   ├── websocket/      # WebSocket handlers
│   │   │   ├── types/          # TypeScript types
│   │   │   └── server.ts       # Entry point
│   │   └── package.json
│   │
│   ├── web/                    # Frontend Next.js app
│   │   ├── app/
│   │   │   ├── (root)/
│   │   │   │   ├── page.tsx    # Main game page
│   │   │   │   └── game.module.css
│   │   │   ├── layout.tsx
│   │   │   └── globals.css
│   │   ├── public/             # Static assets (sounds, images)
│   │   └── package.json
│   │
│   └── docs/                   # Documentation site
│
├── packages/                   # Shared packages
│   ├── ui/                     # Shared UI components
│   ├── eslint-config/          # ESLint configuration
│   └── typescript-config/      # TypeScript configuration
│
├── turbo.json                  # Turborepo configuration
├── pnpm-workspace.yaml         # pnpm workspace config
└── package.json                # Root package.json
```

## 🚀 Getting Started

### Prerequisites

- **Node.js** >= 18.0.0
- **pnpm** >= 8.0.0 (recommended package manager)
- **MongoDB** (local or cloud instance)
- **Kafka** (optional, for event streaming)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/shivang-16/4-in-a-row.git
   cd 4-in-a-row
   ```

2. **Install dependencies**
   ```bash
   pnpm install
   ```

3. **Set up environment variables**

   Create `.env` file in `apps/api/`:
   ```env
   # Server
   PORT=3002
   NODE_ENV=development

   # MongoDB
   MONGODB_URI=mongodb://localhost:27017/4-in-a-row

   # Kafka (optional)
   KAFKA_BROKERS=localhost:9092
   KAFKA_ENABLED=false

   # Frontend URL (for CORS)
   FRONTEND_URL=http://localhost:3000

   # Matchmaking
   MATCHMAKING_TIMEOUT_MS=10000
   ```

   Create `.env.local` file in `apps/web/`:
   ```env
   NEXT_PUBLIC_API_URL=http://localhost:3002
   ```

### Running Locally

**Development mode (all apps):**
```bash
pnpm dev
```

This starts:
- Frontend at `http://localhost:3000`
- Backend API at `http://localhost:3002`

**Run specific apps:**
```bash
# Frontend only
pnpm dev --filter=web

# Backend only
pnpm dev --filter=api
```

### Building for Production

```bash
# Build all apps
pnpm build

# Build specific app
pnpm build --filter=web
pnpm build --filter=api
```

### Running Production Build

```bash
# Start the API server
cd apps/api && pnpm start

# Start the web app
cd apps/web && pnpm start
```

## 🎯 How to Play

### Game Rules
1. Two players take turns dropping colored discs into a 7-column, 6-row grid
2. Pieces fall straight down to the lowest available space
3. The first player to connect **4 discs** in a row wins!
4. Connections can be horizontal, vertical, or diagonal
5. If the board fills up with no winner, it's a draw

### Game Modes

| Mode | Description |
|------|-------------|
| **Find Player** | Join matchmaking queue. If no match in 10 seconds, you'll play against a bot |
| **Play Bot** | Instantly start a game against the AI |
| **Play with Friend** | Create a private room, share the 6-character code with a friend |

## 🌐 Deployment

### Deploy to Render (Backend)

1. Create a new **Web Service** on Render
2. Connect your GitHub repository
3. Configure:
   - **Build Command:** `pnpm install --frozen-lockfile; pnpm run build`
   - **Start Command:** `pnpm start`
   - **Root Directory:** `apps/api`
4. Add environment variables in Render dashboard

### Deploy to Vercel (Frontend)

1. Import project to Vercel
2. Configure:
   - **Root Directory:** `apps/web`
   - **Framework Preset:** Next.js
3. Add environment variable:
   - `NEXT_PUBLIC_API_URL` = Your Render backend URL

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3002` |
| `MONGODB_URI` | MongoDB connection string | Required |
| `KAFKA_ENABLED` | Enable Kafka event streaming | `false` |
| `MATCHMAKING_TIMEOUT_MS` | Time before bot match | `10000` |
| `FRONTEND_URL` | Frontend URL for CORS | `http://localhost:3000` |

### pnpm Version

This project uses **pnpm 8.15.2**. The version is locked in `package.json`:
```json
{
  "packageManager": "pnpm@8.15.2"
}
```

## 📝 API Events (WebSocket)

### Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `player:join` | `{ username }` | Register player |
| `matchmaking:join` | `{ username }` | Join matchmaking queue |
| `matchmaking:join-bot` | `{ username }` | Start bot game |
| `room:create` | `{ username }` | Create private room |
| `room:join` | `{ username, roomCode }` | Join private room |
| `game:move` | `{ gameId, column }` | Make a move |
| `chat:send` | `{ gameId, username, message }` | Send chat message |

### Server → Client

| Event | Payload | Description |
|-------|---------|-------------|
| `game:started` | `{ gameId, opponent, isBot, yourTurn }` | Game started |
| `game:update` | `{ board, currentTurn, lastMove }` | Board updated |
| `game:ended` | `{ winner, reason, winningCells }` | Game ended |
| `room:created` | `{ roomCode }` | Room code generated |
| `chat:message` | `{ username, message }` | Chat message received |

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 👤 Author

**Shivang**
- GitHub: [@shivang-16](https://github.com/shivang-16)

---

<p align="center">Made with ❤️ using Next.js, Express, and Socket.IO</p>
