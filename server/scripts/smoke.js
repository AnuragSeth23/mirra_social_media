/*
 * End-to-end check of the auth flow against a running API (npm run dev in another terminal).
 * Reads one-time codes from verification_codes.dev_code (dev delivery only).
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';
import { emailIndex } from '../src/lib/crypto.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
let cookie = '';
let passed = 0;

async function call(method, path, body, token) {
  const res = await fetch(API + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-SocialAmbak-Client': 'web',
      ...(cookie ? { Cookie: cookie } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const json = res.status === 204 ? null : await res.json();
  return { status: res.status, json };
}

function expect(label, cond, extra) {
  if (!cond) {
    console.error(`✗ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

const db = await mysql.createConnection(config.DATABASE_URL);
// Reads the latest one-time code from verification_codes.dev_code (filled in development only).
const latestCode = async (channel, who) =>
  (
    await db.query(
      `SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id
      WHERE (u.email_hash = ? OR u.username = ?) AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`,
      [emailIndex(who), who, channel],
    )
  )[0][0].dev_code;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const n = Date.now().toString().slice(-7);
const user = {
  fullName: 'Asha Rao',
  username: `asha.${n}`,
  email: `asha${n}@example.com`,
  phone: `+1415555${n.slice(-4)}`,
  password: 'tidepool42',
  dateOfBirth: '1998-04-12',
};

const bad = await call('POST', '/auth/signup', { ...user, email: 'nope', password: 'short', dateOfBirth: '2020-01-01' });
expect('rejects invalid sign-up with field errors', bad.status === 422 && bad.json.error.details.length >= 3, bad.json);

const signup = await call('POST', '/auth/signup', user);
expect('sign-up returns a verification ticket and asks for ONE code (phone is the default)', signup.status === 201 && !!signup.json.data.ticket && JSON.stringify(signup.json.data.pending) === '["phone"]', signup.json);
const ticket = signup.json.data.ticket;

const dup = await call('POST', '/auth/signup', { ...user, username: `other.${n}` });
expect('a duplicate email is rejected (a mobile number may be shared, so only the email is)', dup.status === 409 && dup.json.error.details.length === 1 && dup.json.error.details[0].field === 'email', dup.json);

const avail = await call('GET', `/auth/availability?username=${user.username}`);
expect('username availability reports taken', avail.json.data.username === false);

const early = await call('POST', '/auth/login', { identifier: user.username, password: user.password });
expect('sign-in before verification asks to verify', early.status === 403 && early.json.error.code === 'verification_required', early.json);

const wrong = await call('POST', '/auth/verify', { ticket, channel: 'phone', code: '000000' });
expect('wrong code is rejected and counted', wrong.status === 400 && wrong.json.error.details.attemptsLeft === 4, wrong.json);

const resend = await call('POST', '/auth/resend', { ticket, channel: 'phone' });
expect('resend is throttled by cooldown', resend.status === 429, resend.json);

const otherChannel = await call('POST', '/auth/verify', { ticket, channel: 'email', code: '000000' });
expect('the channel that was not chosen has no code to verify (409)', otherChannel.status === 409, otherChannel.json);

await sleep(300);
const v2 = await call('POST', '/auth/verify', { ticket, channel: 'phone', code: await latestCode('phone', user.username) });
expect('the single phone code verifies and the account activates with a session', v2.status === 200 && !!v2.json.data.accessToken, v2.json);
expect('refresh cookie is httpOnly and strict', !!cookie);

const me = await call('GET', '/users/me', undefined, v2.json.data.accessToken);
expect('profile shows masked phone, never the raw number', me.status === 200 && !me.json.data.phoneMasked.includes(user.phone.slice(2, 8)), me.json);

const noAuth = await call('GET', '/users/me');
expect('protected route needs a token', noAuth.status === 401);

const badLogin = await call('POST', '/auth/login', { identifier: user.email, password: 'wrongpass1' });
expect('wrong password gives generic error', badLogin.status === 401 && badLogin.json.error.code === 'invalid_credentials');

const ghost = await call('POST', '/auth/login', { identifier: 'nobody.here.ever', password: 'wrongpass1' });
expect('unknown account gives the same error', ghost.status === 401 && ghost.json.error.code === 'invalid_credentials');

const byPhone = await call('POST', '/auth/login', { identifier: user.phone, password: user.password });
expect('sign in with phone number works (blind index lookup)', byPhone.status === 200, byPhone.json);

const oldCookie = cookie;
const r1 = await call('POST', '/auth/refresh');
expect('refresh rotates the session', r1.status === 200 && cookie !== oldCookie, r1.json);

await sleep(16_000); // beyond the concurrent-refresh grace window
const savedNew = cookie;
cookie = oldCookie;
const replay = await call('POST', '/auth/refresh');
expect('replaying an old refresh token is detected', replay.status === 401 && replay.json.error.code === 'session_revoked', replay.json);
cookie = savedNew;
const afterReplay = await call('POST', '/auth/refresh');
expect('replay revokes the whole token family', afterReplay.status === 401, afterReplay.json);

const login2 = await call('POST', '/auth/login', { identifier: user.username, password: user.password });
const out = await call('POST', '/auth/logout');
expect('logout ends the session', out.status === 204);
const after = await call('GET', '/users/me', undefined, login2.json.data.accessToken);
expect('access token stops working after logout', after.status === 401, after.json);

console.log(`\nAll ${passed} checks passed.`);
await db.end();
process.exit(0);
