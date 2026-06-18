import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables first
dotenv.config();

import apiRouter from './routes';
import swaggerUi from 'swagger-ui-express';
import { swaggerDocument } from './config/swagger';

const app = express();
const port = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Mount Swagger Documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Mount static dashboard client
app.use('/dashboard', express.static(path.join(process.cwd(), 'public/dashboard')));

// Mount routes
app.use('/api/v1', apiRouter);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date() });
});

// Root path fallback
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>ProfileDB CDP Service</title>
        <style>
          body {
            font-family: 'Inter', system-ui, sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: #f8fafc;
            height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0;
            overflow: hidden;
          }
          .card {
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 12px;
            padding: 3rem;
            max-width: 480px;
            text-align: center;
            box-shadow: 0 20px 40px rgba(0,0,0,0.3);
          }
          h1 {
            background: linear-gradient(to right, #10b981, #14b8a6, #0ea5e9);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            font-size: 2.25rem;
            font-weight: 800;
            margin-bottom: 0.5rem;
          }
          p {
            color: #94a3b8;
            font-size: 0.95rem;
            line-height: 1.6;
            margin-bottom: 2rem;
          }
          .btn {
            display: inline-block;
            background: #14b8a6;
            color: #ffffff;
            font-weight: 600;
            font-size: 0.9rem;
            padding: 0.8rem 1.6rem;
            border-radius: 6px;
            text-decoration: none;
            transition: all 0.2s;
            margin: 0.5rem;
            box-shadow: 0 4px 12px rgba(20, 184, 166, 0.25);
          }
          .btn:hover {
            background: #0d9488;
            transform: translateY(-2px);
          }
          .btn-secondary {
            background: transparent;
            color: #e2e8f0;
            border: 1px solid rgba(255, 255, 255, 0.2);
            box-shadow: none;
          }
          .btn-secondary:hover {
            background: rgba(255,255,255,0.05);
            border-color: rgba(255,255,255,0.4);
          }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>ProfileDB CDP</h1>
          <p>Centralized Customer Data Platform & Telemetry API Backend. Access the visual tracking dashboard or interactive API documentation below.</p>
          <a href="/dashboard" class="btn">Open Profiles Dashboard</a>
          <a href="/api-docs" class="btn btn-secondary">Swagger API Docs</a>
        </div>
      </body>
    </html>
  `);
});

// Start listening
if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`[server]: CDP service is running at http://localhost:${port}`);
  });
}

export default app;
