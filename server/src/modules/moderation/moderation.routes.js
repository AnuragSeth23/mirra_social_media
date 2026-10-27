/*
 * Moderation: the only place reports can be read. Moderators and admins only (checked on the server from the database,
 * never from anything the client says). Reporter identity is visible here and nowhere else.
 */
import { Router } from 'express';
import { z } from 'zod';
import { exec, pool, q } from '../../db/pool.js';
import { AppError, forbidden } from '../../lib/errors.js';
import { fromBin, isId, toBin } from '../../lib/ids.js';
import { requireAuth } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const moderationRouter = Router();
moderationRouter.use(requireAuth);

const requireModerator = async (req, _res, next) => {
  try {
    const [u] = await q(pool, 'SELECT role FROM users WHERE id = ?', [toBin(req.auth.userId)]);
    if (!u || !['moderator', 'admin'].includes(u.role)) throw forbidden('not_moderator', 'This area is for moderators.');
    next();
  } catch (e) {
    next(e);
  }
};
moderationRouter.use(requireModerator);

moderationRouter.get('/reports', async (req, res, next) => {
  try {
    const status = ['open', 'reviewing', 'actioned', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    const rows = await q(
      pool,
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.details, r.status, r.created_at, u.username AS reporter
         FROM reports r LEFT JOIN users u ON u.id = r.reporter_id WHERE r.status = ? ORDER BY r.created_at DESC LIMIT 100`,
      [status],
    );
    res.json({
      data: rows.map((r) => ({
        id: fromBin(r.id), targetType: r.target_type, targetId: fromBin(r.target_id), reason: r.reason, details: r.details,
        status: r.status, createdAt: r.created_at.toISOString(), reporter: r.reporter ?? null,
      })),
    });
  } catch (e) {
    next(e);
  }
});

moderationRouter.patch('/reports/:id', validateBody(z.object({ status: z.enum(['reviewing', 'actioned', 'dismissed']) }).strict()), async (req, res, next) => {
  try {
    if (!isId(req.params.id)) throw new AppError(404, 'not_found', 'Not found.');
    const r = await exec(pool, 'UPDATE reports SET status = ?, resolved_by = ?, resolved_at = IF(? = \'reviewing\', NULL, NOW(3)) WHERE id = ?', [
      req.body.status, toBin(req.auth.userId), req.body.status, toBin(req.params.id),
    ]);
    if (!r.affectedRows) throw new AppError(404, 'not_found', 'Report not found.');
    res.json({ data: { status: req.body.status } });
  } catch (e) {
    next(e);
  }
});
