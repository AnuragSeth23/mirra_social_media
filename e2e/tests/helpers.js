import { expect } from '@playwright/test';
import dotenv from 'dotenv';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../server/.env') });

export const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
export const PASSWORD = 'tidepool42';

/** A valid-looking US number in E.164 form, drawn from a large space so repeated runs do not collide. */
export const randomUsPhone = () => `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;

// The server stores emails only as an HMAC "blind index" (users.email_hash), so the tests compute the same value to find a user by email.
const hmac = (value) => crypto.createHmac('sha256', Buffer.from(process.env.PHONE_HASH_KEY, 'hex')).update(value).digest('hex');
export const emailHash = (email) => hmac(`email:${email.trim().toLowerCase()}`);
export const phoneHash = (e164) => hmac(e164);

async function dbOne(sql, params) {
  const db = await mysql.createConnection(process.env.DATABASE_URL);
  try {
    return (await db.query(sql, params))[0][0];
  } finally {
    await db.end();
  }
}

/** The tests read one-time codes from verification_codes.dev_code (filled only in development). `who` is a username or an email. */
export async function otp(channel, who) {
  const row = await dbOne(
    `SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id
      WHERE (u.email_hash = ? OR u.username = ?) AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`,
    [emailHash(who), who, channel],
  );
  return row.dev_code;
}

/** The newest forgot-password / forgot-username code sent to an email address or an E.164 phone number. */
export async function recoveryCode(channel, contact) {
  const row = await dbOne('SELECT dev_code FROM recovery_requests WHERE channel = ? AND contact_hash = ? ORDER BY created_at DESC LIMIT 1', [channel, channel === 'email' ? emailHash(contact) : phoneHash(contact)]);
  return row.dev_code;
}
let counter = 0;
export const unique = (prefix = 'u') => `${prefix}${Date.now().toString(36).slice(-5)}${(counter++).toString(36)}`.toLowerCase();

export async function api(method, p, token, body, raw) {
  const res = await fetch(API + p, {
    method,
    headers: { 'Content-Type': raw?.type ?? 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? raw.data : body ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, json: json };
}

/** Creates a verified account through the API (fast path for tests that are not about sign-up). Sign-up needs ONE code, on the chosen channel. */
export async function createUser(prefix = 'u', fullName = 'Test User', extra = {}) {
  const username = unique(prefix);
  const u = { fullName, username, email: `${username}@example.com`, phone: randomUsPhone(), password: PASSWORD, dateOfBirth: '1998-04-12', verifyVia: 'phone', ...extra };
  const s = await api('POST', '/auth/signup', undefined, u);
  if (s.status !== 201) throw new Error(`signup failed: ${JSON.stringify(s.json)}`);
  const via = s.json.data.pending[0];
  const v = await api('POST', '/auth/verify', undefined, { ticket: s.json.data.ticket, channel: via, code: await otp(via, username) });
  if (v.status !== 200) throw new Error(`verify failed: ${JSON.stringify(v.json)}`);
  const d = v.json.data;
  return { id: d.user.id, username, fullName, email: u.email, phone: u.phone, password: u.password, token: d.accessToken };
}
export async function uiLogin(page, identifier, password = PASSWORD) {
  await page.goto('/signin');
  await page.getByLabel('Username, email or phone').fill(identifier);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

/** A fresh browser context signed in as the given user. */
export async function signedInContext(browser, user) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await uiLogin(page, user.username, user.password);
  return { ctx, page };
}

// 1x1 PNG and a minimal MP4 header: enough for the server's magic-byte checks.
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHWbuugAAAABJRU5ErkJggg==', 'base64');
export const png = (name = 'pic.png') => ({ name, mimeType: 'image/png', buffer: PNG });

/** Opens the create pop-up from the nav + button. */
export async function openCreate(page) {
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.modal .composer')).toBeVisible();
}

export function trackErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
