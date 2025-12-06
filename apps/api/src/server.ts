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
      
      // Self-ping to keep Render server alive (prevents 50s inactivity shutdown)
      const PING_INTERVAL = 40000; // 40 seconds
      const SELF_URL = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      
      const keepAlive = async () => {
        try {
          const response = await fetch(`${SELF_URL}/health`);
          if (response.ok) {
            console.log('🏥 Keep-alive ping successful');
          }
        } catch (error) {
          console.log('⚠️ Keep-alive ping failed:', error);
        }
      };
      
      // Start the keep-alive interval
      setInterval(keepAlive, PING_INTERVAL);
      console.log(`⏰ Keep-alive ping scheduled every ${PING_INTERVAL / 1000}s`);
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