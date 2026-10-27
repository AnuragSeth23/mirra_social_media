import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config/env.js';
import { pool } from './db/pool.js';
import { errorHandler } from './middleware/error-handler.js';
import { apiLimiter } from './middleware/rate-limit.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { accountRouter } from './modules/account/account.routes.js';
import { friendsRouter } from './modules/friends/friends.routes.js';
import { moderationRouter } from './modules/moderation/moderation.routes.js';
import { privacyRouter } from './modules/privacy/privacy.routes.js';
import { callsRouter } from './modules/calls/calls.routes.js';
import { messagesRouter } from './modules/messages/messages.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { mediaRouter, postsRouter } from './modules/posts/posts.routes.js';
import { safetyRouter } from './modules/safety/safety.routes.js';
import { storiesRouter } from './modules/stories/stories.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.TRUST_PROXY) app.set('trust proxy', config.TRUST_PROXY);
  else if (config.isProd) app.set('trust proxy', 1); // one load balancer in front; adjust to your topology

  app.use(helmet());
  app.use(cors({ origin: config.CLIENT_ORIGIN, credentials: true, allowedHeaders: ['Content-Type', 'Authorization', 'X-SocialAmbak-Client'] }));
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use('/api', apiLimiter);

  app.get('/api/v1/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      res.json({ data: { status: 'ok' } });
    } catch {
      res.status(503).json({ error: { code: 'db_unavailable', message: 'Database unreachable.' } });
    }
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/posts', postsRouter);
  app.use('/api/v1/media', mediaRouter);
  app.use('/api/v1/stories', storiesRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/messages', messagesRouter);
  app.use('/api/v1/calls', callsRouter);
  app.use('/api/v1/safety', safetyRouter);
  app.use('/api/v1/account', accountRouter);
  app.use('/api/v1/friends', friendsRouter);
  app.use('/api/v1/privacy', privacyRouter);
  app.use('/api/v1/moderation', moderationRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: { code: 'not_found', message: 'No such endpoint.' } }));
  app.use(errorHandler);
  return app;
}
