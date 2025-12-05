import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app: Application = express();

// Middleware
app.use(cors({
  origin: ['https://4-in-a-row-web-kappa.vercel.app', 'http://localhost:3000']
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: '4-in-a-row-api'
  });
});

// API routes will be added here
app.get('/', (_req: Request, res: Response) => {
  res.json({
    message: 'Welcome to 4 in a Row API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      // More endpoints will be added as we build
    }
  });
});

export default app;