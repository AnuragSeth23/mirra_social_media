import { AppError } from '../lib/errors.js';

export const errorHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.headers) res.set(err.headers);
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: { code: 'payload_too_large', message: 'The request is too large.' } });
  }
  // Unknown failure: log details server-side only, never echo them to the client.
  console.error(`[error] ${req.method} ${req.path}`, err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on our side. Try again.' } });
};
