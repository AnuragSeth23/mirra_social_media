import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import * as svc from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req, res, next) => {
  try {
    res.json({ data: await svc.list(req.auth.userId) });
  } catch (e) {
    next(e);
  }
});
notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    res.json({ data: await svc.unreadCount(req.auth.userId) });
  } catch (e) {
    next(e);
  }
});
notificationsRouter.post('/read', async (req, res, next) => {
  try {
    const up = Number(req.body?.upToId);
    await svc.markAllRead(req.auth.userId, Number.isInteger(up) && up > 0 ? up : undefined);
    res.status(204).end();
  } catch (e) {
    next(e);
  }
});
