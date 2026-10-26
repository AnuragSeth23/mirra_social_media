/*
 * Checks the sign-up code choice and account recovery against a running API:
 *   - sign-up needs ONE code, sent to the email or the phone the person picks (not both)
 *   - up to 5 accounts may share a mobile number; signing in with that number is decided by the password
 *   - forgot password / forgot username: a code to the email or phone proves the contact, then every account that uses it is listed
 *     and one can be reset; unknown identifiers look exactly like real ones; tickets cannot be mixed up; the reset window ends
 * Usage: npm run smoke:recovery   (codes are read from the dev_code columns, development only)
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';
import { blindIndex, emailIndex } from '../src/lib/crypto.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await mysql.createConnection(config.DATABASE_URL);

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

let passed = 0;
function expect(label, cond, extra) {
  if (!cond) {
    console.error(`✗ ${label}`, extra ?? '');
    process.exit(1);
  }
  passed++;
  console.log(`✓ ${label}`);
}

const stamp = Date.now().toString(36).slice(-6);
let counter = 0;
const usPhone = () => `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`;
function indiaPhone() {
  for (;;) {
    const national = `${6 + Math.floor(Math.random() * 4)}${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    if (parsePhoneNumberFromString(`+91${national}`)?.isValid()) return { national, e164: `+91${national}` };
  }
}
const mk = (tag, extra = {}) => {
  const n = `${stamp}${tag}${counter++}`;
  return { fullName: `Rec ${tag}`, username: `r${n}`, email: `r${n}@example.com`, phone: usPhone(), password: 'tidepool42', dateOfBirth: '1998-04-12', ...extra };
};
const signupCode = async (channel, username) => (await db.query(`SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id WHERE u.username = ? AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`, [username, channel]))[0][0]?.dev_code;
const recCode = async (channel, hash) => (await db.query('SELECT dev_code FROM recovery_requests WHERE channel = ? AND contact_hash = ? ORDER BY created_at DESC LIMIT 1', [channel, hash]))[0][0]?.dev_code;
const ridOf = (ticket) => JSON.parse(Buffer.from(ticket.split('.')[1], 'base64url').toString()).sub;

/** Signs an account up and verifies it with the one code. Returns { u, id, token }. */
async function account(tag, extra = {}) {
  const u = mk(tag, extra);
  const s = await call('POST', '/auth/signup', undefined, u);
  if (s.status !== 201) throw new Error(`signup failed ${JSON.stringify(s.json)}`);
  await sleep(120);
  const via = s.json.data.pending[0];
  const v = await call('POST', '/auth/verify', undefined, { ticket: s.json.data.ticket, channel: via, code: await signupCode(via, u.username) });
  if (v.status !== 200) throw new Error(`verify failed ${JSON.stringify(v.json)}`);
  return { u, id: v.json.data.user.id, token: v.json.data.accessToken };
}

// ===================================================================== sign-up: one code, on the chosen channel
const eu = mk('em', { verifyVia: 'email' });
const es = await call('POST', '/auth/signup', undefined, eu);
expect('sign-up with verifyVia=email asks for exactly one code, on email', es.status === 201 && JSON.stringify(es.json.data.pending) === '["email"]' && /^\d{6}$/.test(es.json.data.dev?.email ?? '') && !es.json.data.dev?.phone, es.json);
const [codeRows] = await db.query('SELECT channel FROM verification_codes vc JOIN users u ON u.id = vc.user_id WHERE u.username = ?', [eu.username]);
expect('only one code row exists for that sign-up (nothing was sent to the phone)', codeRows.length === 1 && codeRows[0].channel === 'email', codeRows);
const wrongChannel = await call('POST', '/auth/verify', undefined, { ticket: es.json.data.ticket, channel: 'phone', code: '123456' });
const wrongResend = await call('POST', '/auth/resend', undefined, { ticket: es.json.data.ticket, channel: 'phone' });
expect('the other channel cannot be verified or sent a code (409)', wrongChannel.status === 409 && wrongResend.status === 409, [wrongChannel.json, wrongResend.json]);
const pendingLogin = await call('POST', '/auth/login', undefined, { identifier: eu.username, password: eu.password });
expect('signing in before verifying re-sends to the chosen channel only', pendingLogin.status === 403 && pendingLogin.json.error.code === 'verification_required' && JSON.stringify(pendingLogin.json.error.details.pending) === '["email"]', pendingLogin.json);
const ev = await call('POST', '/auth/verify', undefined, { ticket: es.json.data.ticket, channel: 'email', code: await signupCode('email', eu.username) });
expect('the one email code activates the account with a session', ev.status === 200 && !!ev.json.data.accessToken, ev.json);
const eMe = await call('GET', '/users/me', ev.json.data.accessToken);
expect('only the chosen contact is marked verified', eMe.json.data.emailVerified === true && eMe.json.data.phoneVerified === false, eMe.json);

const pu = mk('ph', { verifyVia: 'phone' });
const ps = await call('POST', '/auth/signup', undefined, pu);
expect('sign-up with verifyVia=phone asks for exactly one code, on phone', ps.status === 201 && JSON.stringify(ps.json.data.pending) === '["phone"]' && !ps.json.data.dev?.email, ps.json);
const pv = await call('POST', '/auth/verify', undefined, { ticket: ps.json.data.ticket, channel: 'phone', code: await signupCode('phone', pu.username) });
const pMe = await call('GET', '/users/me', pv.json.data.accessToken);
expect('phone sign-up: account active, phone verified, email not', pv.status === 200 && pMe.json.data.phoneVerified === true && pMe.json.data.emailVerified === false, pMe.json);

const badVia = await call('POST', '/auth/signup', undefined, mk('bv', { verifyVia: 'carrier-pigeon' }));
expect('an unknown verification channel is rejected (422)', badVia.status === 422, badVia.json);

// ===================================================================== the email is optional
const { email: _dropped, ...noEmail } = mk('ne');
const ne1 = await call('POST', '/auth/signup', undefined, noEmail);
expect('sign-up with a phone only (no email at all) works, the code goes to the phone', ne1.status === 201 && JSON.stringify(ne1.json.data.pending) === '["phone"]', ne1.json);
const ne1v = await call('POST', '/auth/verify', undefined, { ticket: ne1.json.data.ticket, channel: 'phone', code: await signupCode('phone', noEmail.username) });
const ne1me = await call('GET', '/users/me', ne1v.json.data.accessToken);
expect('such an account is active with no email on file', ne1v.status === 200 && ne1me.json.data.email === null && ne1me.json.data.emailVerified === false, ne1me.json);
const ne2 = await call('POST', '/auth/signup', undefined, { ...mk('ne'), email: '' }); // a blank email is the same as none
expect('a second phone-only account is fine too (empty emails never clash with each other)', ne2.status === 201, ne2.json);
const needMail = await call('POST', '/auth/signup', undefined, { ...noEmail, username: `${noEmail.username}x`, verifyVia: 'email' });
expect('choosing "send the code to my email" without giving an email is refused (422 on the email field)', needMail.status === 422 && needMail.json.error.details.some((d) => d.field === 'email'), needMail.json);
const neLogin = await call('POST', '/auth/login', undefined, { identifier: noEmail.username, password: noEmail.password });
const nePhone = await call('POST', '/auth/login', undefined, { identifier: noEmail.phone, password: noEmail.password });
expect('such an account signs in by username and by phone', neLogin.status === 200 && nePhone.status === 200, [neLogin.json, nePhone.json]);
const neMail = await call('POST', '/auth/recover/start', undefined, { identifier: noEmail.username, channel: 'email' });
const nePhoneRec = await call('POST', '/auth/recover/start', undefined, { identifier: noEmail.username, channel: 'phone' });
expect('recovery by username: the email option has nothing to send to (same answer shape, no code), the phone option works', neMail.status === 200 && !neMail.json.data.dev?.code && Object.keys(neMail.json.data).filter((k) => k !== 'dev').sort().join() === Object.keys(nePhoneRec.json.data).filter((k) => k !== 'dev').sort().join() && /^\d{6}$/.test(nePhoneRec.json.data.dev?.code ?? ''), [neMail.json, nePhoneRec.json]);

// ===================================================================== several accounts on one mobile number
const shared = usPhone();
const a1 = await account('s1', { phone: shared, password: 'tidepool41' });
const a2 = await account('s2', { phone: shared, password: 'tidepool42' });
const a3 = await account('s3', { phone: shared, password: 'tidepool43' });
expect('three accounts can share one mobile number', !!a1.token && !!a2.token && !!a3.token);
const byPhone2 = await call('POST', '/auth/login', undefined, { identifier: shared, password: 'tidepool42' });
expect('signing in with the shared number picks the account whose password matches', byPhone2.status === 200 && byPhone2.json.data.user.id === a2.id, byPhone2.json);
const byPhoneBad = await call('POST', '/auth/login', undefined, { identifier: shared, password: 'nomatch999' });
expect('a wrong password with the shared number is the generic 401', byPhoneBad.status === 401 && byPhoneBad.json.error.code === 'invalid_credentials', byPhoneBad.json);
const a4 = await account('s4', { phone: shared, password: 'tidepool41' }); // same password as a1
const ambiguous = await call('POST', '/auth/login', undefined, { identifier: shared, password: 'tidepool41' });
expect('two accounts with the same number AND password: asks for the username instead (409)', ambiguous.status === 409 && ambiguous.json.error.code === 'multiple_accounts', ambiguous.json);
const a5 = await account('s5', { phone: shared, password: 'tidepool45' });
const sixth = await call('POST', '/auth/signup', undefined, mk('s6', { phone: shared }));
expect('a number can have at most 5 accounts', sixth.status === 409 && sixth.json.error.details.some((d) => d.field === 'phone'), sixth.json);
const dupEmail = await call('POST', '/auth/signup', undefined, mk('de', { email: a1.u.email }));
expect('an email is still one account (409 on the email field)', dupEmail.status === 409 && dupEmail.json.error.details.some((d) => d.field === 'email'), dupEmail.json);
const ind = indiaPhone();
const aIn = await account('in', { phone: ind.e164, password: 'tidepool47' });
const bare = await call('POST', '/auth/login', undefined, { identifier: ind.national, password: 'tidepool47' });
expect('a bare 10-digit Indian number works as a sign-in identifier (+91 assumed)', bare.status === 200 && bare.json.data.user.id === aIn.id, bare.json);

// ===================================================================== recovery: by phone, lists every account that uses it
const sharedHash = blindIndex(shared);
const st = await call('POST', '/auth/recover/start', undefined, { identifier: shared });
expect('recover/start by phone: 200, a ticket, the channel, a masked destination', st.status === 200 && st.json.data.sent && !!st.json.data.ticket && st.json.data.channel === 'phone' && /•/.test(st.json.data.destination ?? ''), st.json);
expect('the on-screen development code matches the database', /^\d{6}$/.test(st.json.data.dev?.code ?? '') && st.json.data.dev.code === (await recCode('phone', sharedHash)), st.json);
const st2 = await call('POST', '/auth/recover/start', undefined, { identifier: shared });
const [[{ n: reqCount }]] = await db.query('SELECT COUNT(*) AS n FROM recovery_requests WHERE channel = ? AND contact_hash = ?', ['phone', sharedHash]);
expect('asking again within a minute reuses the same code instead of sending another', st2.json.data.dev?.code === st.json.data.dev.code && Number(reqCount) === 1, [st2.json, reqCount]);
const early = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a3.id, password: 'brandnew99' });
expect('nothing can be reset before the code is verified (401)', early.status === 401 && early.json.error.code === 'recovery_expired', early.json);
const wrongCode = await call('POST', '/auth/recover/verify', undefined, { ticket: st.json.data.ticket, code: '000000' });
expect('a wrong code is rejected and counted', wrongCode.status === 400 && wrongCode.json.error.details.attemptsLeft === 4, wrongCode.json);
const ok = await call('POST', '/auth/recover/verify', undefined, { ticket: st.json.data.ticket, code: st.json.data.dev.code });
const listed = ok.json?.data?.accounts ?? [];
const wanted = [a1, a2, a3, a4, a5].map((a) => a.id).sort();
expect('the correct code lists ALL 5 accounts that use the number', ok.status === 200 && JSON.stringify(listed.map((a) => a.id).sort()) === JSON.stringify(wanted), ok.json);
expect('the list shows name and username, and never the email or phone', listed.every((a) => a.username && a.fullName && !('email' in a) && !('phone' in a)) && !/@example\.com|\+1415/.test(JSON.stringify(ok.json)), ok.json);

const weak = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a3.id, password: 'short' });
expect('a weak new password is rejected (422)', weak.status === 422, weak.json);
const hasName = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a3.id, password: `${a3.u.username}99` });
expect('a new password that contains the username is rejected (422)', hasName.status === 422, hasName.json);
const foreign = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: eMe.json.data.id, password: 'brandnew99' });
expect('the verified number cannot reset an account that does not use it (403)', foreign.status === 403, foreign.json);
const reset = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a3.id, password: 'brandnew99' });
expect('the verified contact resets the chosen account', reset.status === 200 && reset.json.data.reset === true && reset.json.data.username === a3.u.username, reset.json);
const oldPw = await call('POST', '/auth/login', undefined, { identifier: a3.u.username, password: 'tidepool43' });
const newPw = await call('POST', '/auth/login', undefined, { identifier: a3.u.username, password: 'brandnew99' });
const staleToken = await call('GET', '/users/me', a3.token);
expect('the old password stops working, the new one works, old sessions are signed out', oldPw.status === 401 && newPw.status === 200 && staleToken.status === 401, [oldPw.json, newPw.json, staleToken.status]);
const untouched = await call('POST', '/auth/login', undefined, { identifier: a1.u.username, password: 'tidepool41' });
expect('the other accounts on that number are untouched', untouched.status === 200, untouched.json);

// ---------------------------------------------------------------------- the same ticket for a second account, then the window ends
const reset2 = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a5.id, password: 'brandnew55' });
expect('a verified ticket can also reset another account on the same number', reset2.status === 200, reset2.json);
await db.query("UPDATE recovery_requests SET verified_at = NOW(3) - INTERVAL 20 MINUTE WHERE id = ?", [ridOf(st.json.data.ticket)]);
const late = await call('POST', '/auth/recover/reset', undefined, { ticket: st.json.data.ticket, userId: a2.id, password: 'brandnew22' });
expect('after 15 minutes the verified ticket stops working (401)', late.status === 401 && late.json.error.code === 'recovery_expired', late.json);

// ---------------------------------------------------------------------- suspended / deactivated accounts
await db.query("UPDATE users SET status = 'suspended', updated_at = updated_at WHERE id = ?", [a4.id]);
await db.query("UPDATE users SET status = 'deactivated', updated_at = updated_at WHERE id = ?", [a2.id]);
await db.query('UPDATE recovery_requests SET created_at = NOW(3) - INTERVAL 5 MINUTE WHERE contact_hash = ?', [sharedHash]);
const st3 = await call('POST', '/auth/recover/start', undefined, { identifier: shared });
const ok3 = await call('POST', '/auth/recover/verify', undefined, { ticket: st3.json.data.ticket, code: st3.json.data.dev.code });
const ids3 = (ok3.json?.data?.accounts ?? []).map((a) => a.id);
expect('a suspended account is not listed, a deactivated one is', ok3.status === 200 && !ids3.includes(a4.id) && ids3.includes(a2.id) && ids3.length === 4, ok3.json);
const susp = await call('POST', '/auth/recover/reset', undefined, { ticket: st3.json.data.ticket, userId: a4.id, password: 'brandnew44' });
expect('a suspended account cannot be reset (403)', susp.status === 403, susp.json);

// ===================================================================== recovery by username: choose email or phone
const byEmail = await call('POST', '/auth/recover/start', undefined, { identifier: a1.u.username, channel: 'email' });
expect('by username + email: the code goes to the email, no destination is revealed', byEmail.status === 200 && byEmail.json.data.channel === 'email' && byEmail.json.data.destination === null && byEmail.json.data.dev.code === (await recCode('email', emailIndex(a1.u.email))), byEmail.json);
const vEmail = await call('POST', '/auth/recover/verify', undefined, { ticket: byEmail.json.data.ticket, code: byEmail.json.data.dev.code });
expect('the email proves one account (an email belongs to one account)', vEmail.status === 200 && vEmail.json.data.accounts.length === 1 && vEmail.json.data.accounts[0].id === a1.id, vEmail.json);
const byPhoneUser = await call('POST', '/auth/recover/start', undefined, { identifier: a1.u.username, channel: 'phone' });
expect('by username + phone: the code goes to the phone saved on the account', byPhoneUser.status === 200 && byPhoneUser.json.data.channel === 'phone' && byPhoneUser.json.data.dev.code === (await recCode('phone', sharedHash)), byPhoneUser.json);
const upperEmail = await call('POST', '/auth/recover/start', undefined, { identifier: a1.u.email.toUpperCase() });
expect('an email in capitals finds the same account', upperEmail.status === 200 && upperEmail.json.data.channel === 'email' && !!upperEmail.json.data.dev?.code, upperEmail.json);
const indStart = await call('POST', '/auth/recover/start', undefined, { identifier: ind.national });
const indVerify = await call('POST', '/auth/recover/verify', undefined, { ticket: indStart.json.data.ticket, code: indStart.json.data.dev.code });
expect('forgot username with a bare 10-digit Indian number finds the account', indVerify.status === 200 && indVerify.json.data.accounts.length === 1 && indVerify.json.data.accounts[0].username === aIn.u.username, indVerify.json);

// ===================================================================== nothing reveals whether an account exists
const real = await call('POST', '/auth/recover/start', undefined, { identifier: a5.u.email });
const fakeEmail = await call('POST', '/auth/recover/start', undefined, { identifier: `nobody.${stamp}@example.com` });
const fakeUser = await call('POST', '/auth/recover/start', undefined, { identifier: `nobody.${stamp}`, channel: 'phone' });
const keys = (r) => Object.keys(r.json.data).filter((k) => k !== 'dev').sort().join();
expect('known and unknown identifiers get the same answer shape (apart from the development-only hint)', real.status === 200 && fakeEmail.status === 200 && fakeUser.status === 200 && keys(real) === keys(fakeEmail) && keys(real) === keys(fakeUser), [real.json, fakeEmail.json, fakeUser.json]);
expect('an unknown identifier has no development code, only a note', !fakeEmail.json.data.dev?.code && /No account matches/.test(fakeEmail.json.data.dev?.note ?? ''), fakeEmail.json);
const tries = async (ticket) => {
  const out = [];
  for (let i = 0; i < 6; i++) out.push((await call('POST', '/auth/recover/verify', undefined, { ticket, code: '000000' })).status);
  return out.join();
};
const [realTries, fakeTries] = [await tries(real.json.data.ticket), await tries(fakeEmail.json.data.ticket)];
expect('wrong codes behave identically for real and unknown accounts (400 x5, then locked 429)', realTries === '400,400,400,400,400,429' && realTries === fakeTries, [realTries, fakeTries]);

// ===================================================================== codes cannot be requested without limit
const capEmail = mk('cap');
const capAcct = await account('cap', { email: capEmail.email, verifyVia: 'phone' });
const capHash = emailIndex(capEmail.email);
for (let i = 0; i < 5; i++) {
  const r = await call('POST', '/auth/recover/start', undefined, { identifier: capEmail.email });
  if (r.status !== 200) throw new Error(JSON.stringify(r.json));
  await db.query('UPDATE recovery_requests SET created_at = NOW(3) - INTERVAL 2 MINUTE WHERE channel = ? AND contact_hash = ?', ['email', capHash]); // past the 1-minute cooldown
}
const sixthAsk = await call('POST', '/auth/recover/start', undefined, { identifier: capEmail.email });
const [[{ n: capCount }]] = await db.query('SELECT COUNT(*) AS n FROM recovery_requests WHERE channel = ? AND contact_hash = ?', ['email', capHash]);
expect('at most 5 codes per contact per hour (the 6th request sends nothing new)', sixthAsk.status === 200 && Number(capCount) === 5, [sixthAsk.json, capCount]);

// ===================================================================== tickets cannot be mixed up
const signupTicket = (await call('POST', '/auth/signup', undefined, mk('tk'))).json.data.ticket;
const asRecovery = await call('POST', '/auth/recover/verify', undefined, { ticket: signupTicket, code: '123456' });
const recAsSignup = await call('POST', '/auth/verify', undefined, { ticket: real.json.data.ticket, channel: 'phone', code: '123456' });
const recAs2fa = await call('POST', '/auth/2fa', undefined, { ticket: real.json.data.ticket, code: '123456' });
const tampered = await call('POST', '/auth/recover/verify', undefined, { ticket: `${real.json.data.ticket.slice(0, -4)}AAAA`, code: '123456' });
expect('a sign-up ticket cannot be used for recovery, and a recovery ticket cannot verify a sign-up or pass 2FA (401)', asRecovery.status === 401 && recAsSignup.status === 401 && recAs2fa.status === 401, [asRecovery.status, recAsSignup.status, recAs2fa.status]);
expect('a tampered ticket is refused (401)', tampered.status === 401, tampered.json);
const oldRoutes = [(await call('POST', '/auth/forgot', undefined, { identifier: a1.u.email })).status, (await call('POST', '/auth/reset', undefined, { identifier: a1.u.email, code: '123456', password: 'x1234567' })).status];
expect('the old forgot/reset endpoints no longer exist (404)', oldRoutes.every((s) => s === 404), oldRoutes);

console.log(`\nAll ${passed} recovery and sign-up checks passed.`);
await db.end();
process.exit(0);
