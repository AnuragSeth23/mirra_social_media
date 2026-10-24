import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { AppError } from './errors.js';
import { uuidv7 } from './ids.js';

export const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

/*
 * Media files are not public. Every URL the API hands out carries an expiry and a signature made with a secret key
 * (derived from JWT_ACCESS_SECRET, so no new setting is needed). The API only builds such a URL for someone who is
 * allowed to see the post, story or profile photo, so a person who may not see a post never receives a working link,
 * and a guessed or edited link (wrong key, wrong expiry, wrong signature) is refused.
 * The expiry is rounded to 6-hour steps, so the same URL is reused inside a step and the browser can cache it.
 * Limit: someone who was allowed and copied a link keeps access until it expires (6 to 12 hours).
 */
const MEDIA_KEY = crypto.createHmac('sha256', Buffer.from(config.JWT_ACCESS_SECRET, 'hex')).update('media-url:v1').digest();
const STEP_SECONDS = 6 * 60 * 60;
const sign = (key, exp) => crypto.createHmac('sha256', MEDIA_KEY).update(`${key}.${exp}`).digest('base64url').slice(0, 32);

export const signMedia = (key, exp) => sign(key, exp);
export function mediaUrl(key) {
  if (!key) return null;
  const exp = (Math.floor(Date.now() / 1000 / STEP_SECONDS) + 2) * STEP_SECONDS;
  return `/api/v1/media/${key}?e=${exp}&s=${sign(key, exp)}`;
}
/** True when `e` (expiry, seconds) is still in the future and `s` is the right signature for this key. */
export function mediaSignatureOk(key, e, s) {
  const exp = Number(e);
  if (!Number.isInteger(exp) || exp * 1000 < Date.now() || typeof s !== 'string' || s.length !== 32) return false;
  const want = Buffer.from(sign(key, exp));
  const got = Buffer.from(s);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export const KEY_RE = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|webm)$/;
const VIDEO_EXT = new Set(['mp4', 'webm']);
export const mediaTypeOf = (key) => (VIDEO_EXT.has(key.split('.').pop()) ? 'video' : 'image');

// [extension, signature bytes, offset]. The type comes from the file's own bytes, never the client's header or name.
const MAGIC = [
  ['jpg', [0xff, 0xd8, 0xff], 0],
  ['png', [0x89, 0x50, 0x4e, 0x47], 0],
  ['gif', [0x47, 0x49, 0x46, 0x38], 0],
  ['webp', [0x57, 0x45, 0x42, 0x50], 8],
  ['mp4', [0x66, 0x74, 0x79, 0x70], 4],
  ['webm', [0x1a, 0x45, 0xdf, 0xa3], 0],
];

export async function saveMedia(buf) {
  const ext = buf.length >= 12 ? MAGIC.find(([, sig, at]) => sig.every((b, i) => buf[at + i] === b))?.[0] : undefined;
  if (!ext) throw new AppError(415, 'unsupported_media', 'Upload a JPG, PNG, WebP or GIF image, or an MP4 or WebM video.');
  const mediaType = VIDEO_EXT.has(ext) ? 'video' : 'image';
  if (mediaType === 'image' && buf.length > MAX_IMAGE_BYTES) throw new AppError(413, 'image_too_large', 'Photos can be up to 5 MB.');
  if (buf.length > MAX_VIDEO_BYTES) throw new AppError(413, 'video_too_large', 'Videos can be up to 50 MB.');
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  const key = `${uuidv7()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, key), buf);
  return { key, mediaType };
}

/**
 * Deletes uploaded files that nothing refers to any more: abandoned uploads, deleted posts' media, replaced avatars,
 * expired stories. Files younger than a day are kept so an upload that is about to be attached is never removed.
 */
export async function purgeOrphanMedia(referenced) {
  const names = await fs.readdir(UPLOAD_DIR).catch(() => []);
  if (!names.length) return 0;
  const keep = await referenced();
  let removed = 0;
  for (const name of names) {
    if (!KEY_RE.test(name) || keep.has(name)) continue;
    const full = path.join(UPLOAD_DIR, name);
    const stat = await fs.stat(full).catch(() => null);
    if (!stat || Date.now() - stat.mtimeMs < 24 * 60 * 60_000) continue;
    await fs
      .unlink(full)
      .then(() => {
        removed++;
      })
      .catch(() => {});
  }
  return removed;
}

export async function requireMedia(key, type) {
  if (!KEY_RE.test(key) || (type && mediaTypeOf(key) !== type)) throw new AppError(422, 'media_invalid', 'That file can’t be used here.');
  await fs.access(path.join(UPLOAD_DIR, key)).catch(() => {
    throw new AppError(422, 'media_missing', 'That file was not found. Upload it again.');
  });
}
