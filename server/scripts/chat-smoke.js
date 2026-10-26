/*
 * Checks messaging against a running API: message requests (one message until accepted), photos and videos in chat,
 * posts/reels shared as cards (and only if the reader may see them), the chat list preview, and the limits on what can be sent.
 * Usage: npm run smoke:chat   (codes are read from verification_codes.dev_code, development only)
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = API.replace(/\/api\/v1$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await mysql.createConnection(config.DATABASE_URL);
const code = async (channel, username) => (await db.query(`SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id WHERE u.username = ? AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`, [username, channel]))[0][0].dev_code;

async function call(method, path, token, body, raw) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': raw?.type ?? 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? raw.data : body ? JSON.stringify(body) : undefined,
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
let n = 0;
async function newUser(tag) {
  const id = `${stamp}${tag}${n++}`;
  const u = { fullName: `Chat ${tag}`, username: `m${id}`, email: `m${id}@example.com`, phone: `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`, password: 'tidepool42', dateOfBirth: '1998-04-12', verifyVia: 'phone' };
  const s = await call('POST', '/auth/signup', undefined, u);
  await sleep(120);
  const v = await call('POST', '/auth/verify', undefined, { ticket: s.json.data.ticket, channel: 'phone', code: await code('phone', u.username) });
  return { id: v.json.data.user.id, token: v.json.data.accessToken, u };
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHWbuugAAAABJRU5ErkJggg==', 'base64');
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('mp42'), Buffer.alloc(32)]);
const upload = async (token, type, data) => (await call('POST', '/media', token, undefined, { type, data })).json.data;

const a = await newUser('a'); // sends first
const b = await newUser('b'); // receives
const thread = async (token, cid) => (await call('GET', `/messages/${cid}`, token)).json.data;

// ===================================================================== message request: one message until accepted
const chat = await call('POST', `/messages/with/${b.id}`, a.token);
const cid = chat.json.data.id;
const empty = await call('POST', `/messages/${cid}`, a.token, {});
expect('an empty message is rejected (422)', empty.status === 422, empty.json);
const first = await call('POST', `/messages/${cid}`, a.token, { body: 'hello from a' });
expect('the first message to a stranger is sent (as a request)', first.status === 200 && first.json.data.body === 'hello from a' && first.json.data.mine === true && first.json.data.media === null && first.json.data.sharedPost === null, first.json);
const second = await call('POST', `/messages/${cid}`, a.token, { body: 'hey' });
expect('a second message waits for acceptance (403 request_pending)', second.status === 403 && second.json.error.code === 'request_pending', second.json);
let ta = await thread(a.token, cid);
expect('the sender is told the composer is closed (canSend=false) and why (request.outgoing)', ta.canSend === false && ta.request.outgoing === true, ta);
const tbReq = await thread(b.token, cid);
expect('the receiver sees it as an incoming request they can answer', tbReq.request.incoming === true && tbReq.canSend === true, tbReq);
const inbox = (await call('GET', '/messages?folder=requests', b.token)).json.data;
expect('the request is in the receiver’s Requests folder', inbox.length === 1 && inbox[0].id === cid && inbox[0].request === true && inbox[0].lastMessage === 'hello from a', inbox);
const accept = await call('POST', `/messages/${cid}/accept`, b.token);
expect('accepting the request works', accept.status === 200, accept.json);
ta = await thread(a.token, cid);
expect('after accepting, the sender can send again', ta.canSend === true && ta.request.outgoing === false, ta);

// ===================================================================== photos and videos in chat
const png = await upload(a.token, 'image/png', PNG);
const photo = await call('POST', `/messages/${cid}`, a.token, { mediaKey: png.key, body: 'look' });
expect('a photo (with a caption) can be sent', photo.status === 200 && photo.json.data.media.type === 'image' && /^\/api\/v1\/media\//.test(photo.json.data.media.url) && photo.json.data.body === 'look', photo.json);
const mp4 = await upload(a.token, 'video/mp4', MP4);
const video = await call('POST', `/messages/${cid}`, a.token, { mediaKey: mp4.key });
expect('a video can be sent', video.status === 200 && video.json.data.media.type === 'video' && video.json.data.body === '', video.json);
const served = await fetch(`${ORIGIN}${photo.json.data.media.url}`);
expect('the photo is served through its signed link', served.status === 200 && served.headers.get('content-type') === 'image/png');
const forged = await fetch(`${ORIGIN}${photo.json.data.media.url.replace(/s=\w+/, 's=00000000000000000000000000000000')}`);
expect('a link with a wrong signature is refused', forged.status >= 400, forged.status);
const tb = await thread(b.token, cid);
expect('the receiver sees the photo and the video', tb.messages.some((m) => m.media?.type === 'image' && m.body === 'look') && tb.messages.some((m) => m.media?.type === 'video'), tb.messages);
const badKey = await call('POST', `/messages/${cid}`, a.token, { mediaKey: '00000000-0000-7000-8000-000000000000.png' });
const junkKey = await call('POST', `/messages/${cid}`, a.token, { mediaKey: '../../etc/passwd' });
expect('a file that was never uploaded, or a path-like key, cannot be attached (422)', badKey.status === 422 && junkKey.status === 422, [badKey.json, junkKey.json]);

// ===================================================================== posts and reels shared as cards
const post = await call('POST', '/posts', a.token, { caption: 'my first post', audience: 'public' });
const reelMedia = await upload(a.token, 'video/mp4', MP4);
const reel = await call('POST', '/posts', a.token, { caption: 'my reel', kind: 'reel', mediaKey: reelMedia.key, audience: 'public' });
const sharedPost = await call('POST', `/messages/${cid}`, a.token, { sharedPostId: post.json.data.id });
expect('a post is sent as a card, not a pasted link', sharedPost.status === 200 && sharedPost.json.data.sharedPost.id === post.json.data.id && sharedPost.json.data.sharedPost.author.username === a.u.username && sharedPost.json.data.sharedPost.caption === 'my first post' && !/localhost|http/.test(sharedPost.json.data.body), sharedPost.json);
const sharedReel = await call('POST', `/messages/${cid}`, a.token, { sharedPostId: reel.json.data.id });
expect('a reel is sent as a card with its video', sharedReel.status === 200 && sharedReel.json.data.sharedPost.kind === 'reel' && sharedReel.json.data.sharedPost.mediaType === 'video' && !!sharedReel.json.data.sharedPost.mediaUrl, sharedReel.json);
const both = await call('POST', `/messages/${cid}`, a.token, { sharedPostId: post.json.data.id, mediaKey: png.key });
expect('a message carries a file or a post, not both (422)', both.status === 422, both.json);
const ghostPost = await call('POST', `/messages/${cid}`, a.token, { sharedPostId: '00000000-0000-7000-8000-000000000000' });
expect('a post that does not exist cannot be shared (404)', ghostPost.status === 404, ghostPost.json);
const myOnly = await call('POST', '/posts', b.token, { caption: 'private to b', audience: 'only_me' });
const cantShare = await call('POST', `/messages/${cid}`, a.token, { sharedPostId: myOnly.json.data.id });
expect('you cannot share a post you are not allowed to see (404)', cantShare.status === 404, cantShare.json);
const tb2 = await thread(b.token, cid);
expect('the receiver sees the post card with the author and caption', tb2.messages.some((m) => m.sharedPost?.id === post.json.data.id && m.sharedPost.author.username === a.u.username), tb2.messages);

// the card is built for the READER: once the post stops being visible to them it turns into "no longer available"
await call('PATCH', `/posts/${post.json.data.id}`, a.token, { audience: 'only_me' });
const tb3 = await thread(b.token, cid);
const cardNow = tb3.messages.find((m) => m.id === sharedPost.json.data.id);
expect('when the post is no longer visible to the reader, the card says unavailable and leaks nothing', cardNow.sharedPost.unavailable === true && !cardNow.sharedPost.caption && !JSON.stringify(cardNow).includes('my first post'), cardNow);
const ta3 = await thread(a.token, cid);
expect('the author still sees their own post card', ta3.messages.find((m) => m.id === sharedPost.json.data.id).sharedPost.caption === 'my first post');

// ===================================================================== chat list and who can read
const list = (await call('GET', '/messages', b.token)).json.data;
expect('the chat list previews the latest message ("Shared a post" for a card, "Photo"/"Video" for files)', list.length === 1 && /Shared a post/.test(list[0].lastMessage), list);
await call('POST', `/messages/${cid}`, a.token, { mediaKey: (await upload(a.token, 'image/png', PNG)).key });
expect('a photo shows as "Photo" in the list', /Photo/.test((await call('GET', '/messages', b.token)).json.data[0].lastMessage));
const c = await newUser('c');
const outsider = await call('GET', `/messages/${cid}`, c.token);
const outsiderSend = await call('POST', `/messages/${cid}`, c.token, { body: 'let me in' });
expect('someone outside the chat can neither read it nor send into it (404)', outsider.status === 404 && outsiderSend.status === 404, [outsider.status, outsiderSend.status]);
const tooLong = await call('POST', `/messages/${cid}`, a.token, { body: 'x'.repeat(4001) });
expect('a message over 4000 characters is rejected (422)', tooLong.status === 422, tooLong.json);

console.log(`\nAll ${passed} chat checks passed.`);
await db.end();
process.exit(0);
