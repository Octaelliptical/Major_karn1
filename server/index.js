import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import { aiRateLimiter } from './services/aiService.js';
import dotenv from 'dotenv';
import curateResourcesRouter from './routes/curateResources.js';
import generatePlanRouter from './routes/generatePlan.js';
import pdfChatRouter from './routes/pdfChat.js';
import rateLimit from 'express-rate-limit';
import { mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

// Load environment variables
dotenv.config();

const startServer = async () => {
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    await mkdir(uploadsDir, { recursive: true });
    console.log('✅ Created uploads directory');
  }

  const app = express();
  const port = process.env.PORT || 5000;

  app.set('trust proxy', 1);
  app.use(express.json());

  app.use(
    cors({
      origin: [
        "https://major-karn.vercel.app/",
        "https://major-karn.onrender.com",
        "http://localhost:3000",
      ],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization", "x-user-id"],
    })
  );

  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again after 15 minutes',
    trustProxy: true
  });

  app.use(limiter);

  app.use('/api/resources', aiRateLimiter);
  app.use('/api/study-plan', aiRateLimiter);

  app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Mind Mentor API is running' });
  });

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }

  app.use('/generate-plan', generatePlanRouter);
  app.use('/curate-resources', curateResourcesRouter);
  app.use('/pdf', pdfChatRouter);

  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Something went wrong!' });
  });

  app.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${port}`);
  });
};

startServer();
