import http from 'http';
import app from './app';
import { kafkaService } from './services/kafka.service';
import connectDB from './db/db';
import { initializeWebSocket } from './websocket/websocket.service';

const PORT = process.env.PORT || 3002;
// Create HTTP server
const server = http.createServer(app);

// Initialize Kafka and start server
async function startServer() {
  try {
    // Connect to MongoDB (optional)
    if (process.env.MONGODB_URI) {
      await connectDB();
    } else {
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
    initializeWebSocket(server);
    
    // Start HTTP server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`🎮 Environment: ${process.env.NODE_ENV || 'development'}`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM signal received: closing HTTP server');
  await kafkaService.disconnect();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log('SIGINT signal received: closing HTTP server');
  await kafkaService.disconnect();
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});