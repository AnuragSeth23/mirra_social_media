import { z } from 'zod';
import { AppError } from '../lib/errors.js';

const toFieldErrors = (err) => err.issues.map((i) => ({ field: i.path.join('.') || 'body', message: i.message }));

export const validateBody = (schema) => (req, _res, next) => {
  const result = schema.safeParse(req.body ?? {});
  if (!result.success) return next(new AppError(422, 'validation_error', 'Check the highlighted fields.', toFieldErrors(result.error)));
  req.body = result.data;
  next();
};

export const validateQuery = (schema) => (req, res, next) => {
  const result = schema.safeParse(req.query);
  if (!result.success) return next(new AppError(422, 'validation_error', 'Check the highlighted fields.', toFieldErrors(result.error)));
  res.locals.query = result.data;
  next();
};
