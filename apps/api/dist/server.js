"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const http_1 = __importDefault(require("http"));
const app_1 = __importDefault(require("./app"));
const kafka_service_1 = require("./services/kafka.service");
const db_1 = __importDefault(require("./db/db"));
const websocket_service_1 = require("./websocket/websocket.service");
const PORT = process.env.PORT || 3002;
// Create HTTP server
const server = http_1.default.createServer(app_1.default);
// Initialize Kafka and start server
async function startServer() {
    try {
        // Connect to MongoDB (optional)
        if (process.env.MONGODB_URI) {
            await (0, db_1.default)();
        }
        else {
            console.log('⚠️  MongoDB URI not set, skipping database connection');
        }
        // Connect to Kafka (optional - temporarily disabled due to cert issues)
        // if (process.env.KAFKA_URL) {
        //   try {
        //     await kafkaService.connect();
        //   } catch (error) {
        //     console.warn('⚠️  Kafka connection failed, continuing without Kafka:', error);
        //   }
        // } else {
        console.log('⚠️  Kafka temporarily disabled - will fix cert issues later');
        // }
        // Initialize WebSocket
        (0, websocket_service_1.initializeWebSocket)(server);
        // Start HTTP server
        server.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📍 Health check: http://localhost:${PORT}/health`);
            console.log(`🎮 Environment: ${process.env.NODE_ENV || 'development'}`);
        });
    }
    catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}
startServer();
// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    await kafka_service_1.kafkaService.disconnect();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    await kafka_service_1.kafkaService.disconnect();
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});
