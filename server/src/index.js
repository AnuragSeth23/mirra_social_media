import http from 'node:http';
import { config } from './config/env.js';
import { pool } from './db/pool.js';
import { createApp } from './app.js';
import { purgeOrphanMedia } from './lib/media.js';
import { purgeStale, referencedMediaKeys } from './modules/auth/auth.service.js';

const server = http.createServer(createApp());
// Phase 3 attaches Socket.IO to this same server for chat, typing and live notifications.

server.listen(config.PORT, () => console.log(`SocialAmbak API listening on http://localhost:${config.PORT}`));

const housekeeping = setInterval(() => {
  purgeStale().catch((e) => console.error('[housekeeping]', e.message));
  purgeOrphanMedia(referencedMediaKeys).catch((e) => console.error('[media cleanup]', e.message));
}, 60 * 60_000);
housekeeping.unref();

function shutdown(signal) {
  console.log(`${signal} received, shutting down`);
  server.close(() => pool.end().then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
