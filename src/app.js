import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import swaggerUi from 'swagger-ui-express';

import { authenticate } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import apiRouter from './routes/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const openapi = JSON.parse(readFileSync(join(__dirname, '..', 'openapi.json'), 'utf-8'));

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(morgan('dev'));
  app.use(express.json({ limit: '50mb' }));

  // Salud (sin auth)
  app.get('/health', (req, res) => res.json({ ok: true }));

  // Documentación interactiva (sin auth)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapi));

  // API (con autenticación)
  app.use('/api/v1', authenticate, apiRouter);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
