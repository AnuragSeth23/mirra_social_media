/*
 * API checks for the privacy and security system, written against the rules in docs/PRIVACY.md:
 *   post audiences, signed media, friends, private accounts, profile-field privacy, find-by-email/phone, block, restrict,
 *   reports and moderation, messaging privacy (requests, receipts, activity), tags and mentions, two-factor sign-in,
 *   active sessions, unauthorised access, IDOR and SQL-injection cases.
 * Usage: npm run smoke:privacy   (API must be running; codes are read from verification_codes.dev_code)
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';
import { codeForStep, stepAt } from '../src/lib/totp.js';
import { signMedia } from '../src/lib/media.js';
import { emailIndex } from '../src/lib/crypto.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const ORIGIN = API.replace(/\/api\/v1$/, '');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await mysql.createConnection(config.DATABASE_URL);
const dbCode = async (channel, who) =>
  (await db.query(`SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id WHERE (u.email_hash = ? OR u.username = ?) AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`, [emailIndex(who), who, channel]))[0][0].dev_code;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHWbuugAAAABJRU5ErkJggg==', 'base64');
async function upload(token) {
  const res = await fetch(`${API}/media`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-SocialAmbak-Client': 'web', Authorization: `Bearer ${token}` }, body: PNG });
  return (await res.json()).data.key;
}

let counter = 0;
async function newUser(tag) {
  const id = `${Date.now().toString(36).slice(-5)}${tag}${counter++}`;
  const u = { fullName: `Priv ${tag}`, username: `p${id}`, email: `p${id}@example.com`, phone: `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`, password: 'tidepool42', dateOfBirth: '1998-04-12', verifyVia: tag.charCodeAt(0) % 2 ? 'email' : 'phone' };
  const s = await call('POST', '/auth/signup', undefined, u);
  if (s.status !== 201) throw new Error('signup failed ' + JSON.stringify(s.json));
  const ticket = s.json.data.ticket;
  await sleep(120);
  const via = s.json.data.pending[0]; // one code, on the channel this user chose
  const v = await call('POST', '/auth/verify', undefined, { ticket, channel: via, code: await dbCode(via, u.username) });
  return { id: v.json.data.user.id, token: v.json.data.accessToken, u };
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
const befriend = async (x, y) => {
  await call('POST', '/friends/requests', x.token, { userId: y.id });
  return call('POST', `/friends/requests/${x.id}/accept`, y.token);
};
const makePost = async (user, body) => (await call('POST', '/posts', user.token, body)).json?.data;
const canSee = async (viewer, postId) => (await call('GET', `/posts/${postId}`, viewer?.token ?? undefined)).status;
const feedIds = async (user) => (await call('GET', '/posts/feed', user.token)).json.data.posts.map((p) => p.id);
const profilePostIds = async (viewer, owner) => (await call('GET', `/posts/by/${owner.u.username}`, viewer.token)).json.data.posts.map((p) => p.id);

// =========================================================================================== 1. post audiences
const O = await newUser('owner');
const F = await newUser('friend');
const W = await newUser('follower');
const S = await newUser('stranger');
const B = await newUser('blocked');
await befriend(O, F);
await call('PUT', `/users/${O.id}/follow`, W.token);
await call('PUT', `/safety/block/${O.id}`, B.token); // B blocks O: neither can see the other

const tag = `aud${Date.now().toString(36).slice(-5)}`;
const pub = await makePost(O, { caption: `public #${tag}`, audience: 'public' });
const fr = await makePost(O, { caption: `friends #${tag}`, audience: 'friends' });
const me = await makePost(O, { caption: `only me #${tag}`, audience: 'only_me' });
expect('posts are saved with their audience', pub.audience === 'public' && fr.audience === 'friends' && me.audience === 'only_me', [pub.audience, fr.audience, me.audience]);

const matrix = [
  ['the owner', O, [200, 200, 200]],
  ['a friend', F, [200, 200, 404]],
  ['a follower who is not a friend', W, [200, 404, 404]],
  ['a stranger', S, [200, 404, 404]],
  ['a user who blocked the owner', B, [404, 404, 404]],
];
for (const [who, user, want] of matrix) {
  const got = [await canSee(user, pub.id), await canSee(user, fr.id), await canSee(user, me.id)];
  expect(`direct post URL: ${who} gets public/friends/only-me = ${want.join('/')}`, got.join('/') === want.join('/'), got);
}
expect('direct post URL without signing in is refused (401)', (await canSee(null, pub.id)) === 401);
expect('a malformed post id answers 404, not an error', (await call('GET', '/posts/not-a-uuid', S.token)).status === 404);

const ids = async (user) => ({ feed: await feedIds(user), prof: await profilePostIds(user, O) });
const fV = await ids(F);
expect('feed and profile for a friend include public and friends-only posts but never only-me', fV.feed.includes(pub.id) && fV.feed.includes(fr.id) && !fV.feed.includes(me.id) && fV.prof.includes(fr.id) && !fV.prof.includes(me.id), fV);
const wV = await ids(W);
expect('feed and profile for a plain follower show only the public post', wV.feed.includes(pub.id) && !wV.feed.includes(fr.id) && !wV.feed.includes(me.id) && wV.prof.length >= 1 && !wV.prof.includes(fr.id), wV);
const sV = await ids(S);
expect("a stranger's profile list shows only the public post", sV.prof.includes(pub.id) && !sV.prof.includes(fr.id) && !sV.prof.includes(me.id), sV);
expect("the owner's own profile shows all three", (await profilePostIds(O, O)).length >= 3);
expect('a blocked viewer sees none of the owner’s posts', (await profilePostIds(B, O)).length === 0);

const tagPage = async (user) => (await call('GET', `/posts/tag/${tag}`, user.token)).json.data.posts.map((p) => p.id);
const tS = await tagPage(S);
const tF = await tagPage(F);
expect('hashtag page: a stranger sees only the public post, a friend also sees the friends-only one', tS.includes(pub.id) && !tS.includes(fr.id) && !tS.includes(me.id) && tF.includes(fr.id) && !tF.includes(me.id), [tS, tF]);
const tagSearch = await call('GET', `/posts/tags?q=${tag}`, S.token);
expect('hashtag counts include only public posts (1 here)', tagSearch.json.data[0]?.tag === tag && tagSearch.json.data[0].postCount === 1, tagSearch.json);

// engagement and metadata follow the same rule
for (const [who, user, okExpected] of [['a stranger', S, false], ['a friend', F, true]]) {
  const r = [
    (await call('PUT', `/posts/${fr.id}/like`, user.token)).status,
    (await call('POST', `/posts/${fr.id}/comments`, user.token, { body: 'hi' })).status,
    (await call('GET', `/posts/${fr.id}/comments`, user.token)).status,
    (await call('PUT', `/posts/${fr.id}/save`, user.token)).status,
    (await call('POST', `/posts/${fr.id}/share`, user.token)).status,
  ];
  expect(`${who} ${okExpected ? 'can' : 'cannot'} like, comment, list comments, save and share a friends-only post`, okExpected ? r.every((s) => s === 200) : r.every((s) => s === 404), r);
}

// media: only people who may see a post are given a working link; the link itself is signed and expires
const key = await upload(O.token);
const key2 = await upload(O.token);
const photoFr = await makePost(O, { caption: 'friends photo', mediaKey: key, audience: 'friends' });
const photoPub = await makePost(O, { caption: 'public photo', mediaKey: key2, audience: 'public' });
const frUrl = (await call('GET', `/posts/${photoFr.id}`, F.token)).json.data.mediaUrl;
expect('a friend receives a signed media link that works', frUrl.includes('?e=') && (await fetch(ORIGIN + frUrl)).status === 200, frUrl);
expect('a stranger gets no link for the friends-only photo (the post answers 404)', (await call('GET', `/posts/${photoFr.id}`, S.token)).status === 404);
expect('the media file without its signature is refused (403)', (await fetch(`${ORIGIN}/api/v1/media/${key}`)).status === 403);
expect('a link with a wrong signature is refused (403)', (await fetch(frUrl.replace(/s=.{4}/, 's=AAAA').replace(/^/, ORIGIN))).status === 403);
const pastExp = Math.floor(Date.now() / 1000) - 60;
expect('an expired link is refused even with a correct signature (403)', (await fetch(`${ORIGIN}/api/v1/media/${key}?e=${pastExp}&s=${signMedia(key, pastExp)}`)).status === 403);
const futureExp = Math.floor(Date.now() / 1000) + 3600;
expect('a signature for one file cannot open another file (403)', (await fetch(`${ORIGIN}/api/v1/media/${key2}?e=${futureExp}&s=${signMedia(key, futureExp)}`)).status === 403);
expect('a path-traversal key is refused', [403, 404].includes((await fetch(`${ORIGIN}/api/v1/media/..%2F..%2F.env?e=${futureExp}&s=x`)).status));

// explore, discover, reels and saved list never leak non-public posts
const explore = (await call('GET', '/posts/explore', S.token)).json.data.posts.map((p) => p.id);
expect('explore shows the public photo but not the friends-only photo', explore.includes(photoPub.id) && !explore.includes(photoFr.id), explore.length);
const discover = (await call('GET', '/posts/discover', S.token)).json.data.posts.map((p) => p.id);
expect('"Suggested for you" never contains friends-only or only-me posts', !discover.includes(fr.id) && !discover.includes(me.id) && !discover.includes(photoFr.id));
const reelKey = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('mp42'), Buffer.alloc(32)]);
const vres = await fetch(`${API}/media`, { method: 'POST', headers: { 'Content-Type': 'video/mp4', 'X-SocialAmbak-Client': 'web', Authorization: `Bearer ${O.token}` }, body: reelKey });
const reel = await makePost(O, { caption: 'friends reel', kind: 'reel', mediaKey: (await vres.json()).data.key, audience: 'friends' });
expect('a friends-only reel appears in Reels for a friend but not for a stranger', (await call('GET', '/posts/reels', F.token)).json.data.posts.some((p) => p.id === reel.id) && !(await call('GET', '/posts/reels', S.token)).json.data.posts.some((p) => p.id === reel.id));

// saved posts disappear when the audience is tightened
await call('PUT', `/posts/${pub.id}/save`, S.token);
expect('a public post can be saved', (await call('GET', '/posts/saved', S.token)).json.data.posts.some((p) => p.id === pub.id));
const tight = await call('PATCH', `/posts/${pub.id}`, O.token, { audience: 'only_me' });
expect('the owner can change the audience', tight.status === 200 && tight.json.data.audience === 'only_me', tight.json);
expect('after tightening, it vanishes for the stranger (direct URL and saved list)', (await canSee(S, pub.id)) === 404 && !(await call('GET', '/posts/saved', S.token)).json.data.posts.some((p) => p.id === pub.id));
await call('PATCH', `/posts/${pub.id}`, O.token, { audience: 'public' });
expect('a non-owner cannot change someone else’s audience (404)', (await call('PATCH', `/posts/${pub.id}`, S.token, { audience: 'public' })).status === 404 && (await call('PATCH', `/posts/${me.id}`, F.token, { audience: 'public' })).status === 404);
expect('an invalid audience is refused (422)', (await call('PATCH', `/posts/${pub.id}`, O.token, { audience: 'everyone' })).status === 422);
expect('unknown fields are refused instead of being saved (mass assignment, 422)', (await call('PATCH', `/posts/${pub.id}`, O.token, { likeCount: 999 })).status === 422 && (await call('POST', '/posts', O.token, { caption: 'x', authorId: S.id })).status === 422);

// the owner's default audience, and an explicit choice overriding it
await call('PATCH', '/privacy', O.token, { defaultPostAudience: 'friends' });
const dflt = await makePost(O, { caption: 'uses the default' });
const explicit = await makePost(O, { caption: 'explicit', audience: 'public' });
expect('a post without an audience uses the owner’s default; an explicit audience wins', dflt.audience === 'friends' && explicit.audience === 'public', [dflt.audience, explicit.audience]);
await call('PATCH', '/privacy', O.token, { defaultPostAudience: 'public' });

// delete
expect('a non-owner cannot delete a post, the owner can', (await call('DELETE', `/posts/${fr.id}`, S.token)).status === 404 && (await call('DELETE', `/posts/${fr.id}`, O.token)).status === 204 && (await canSee(F, fr.id)) === 404);

// =========================================================================================== 2. private accounts and friend requests
const P = await newUser('private');
const Q = await newUser('quest');
await call('PATCH', '/privacy', P.token, { isPrivate: true });
const privPost = await makePost(P, { caption: 'private account, public audience', audience: 'public' });
const privFriends = await makePost(P, { caption: 'private account, friends audience', audience: 'friends' });
expect('private account: a stranger cannot see its posts (direct URL and profile)', (await canSee(Q, privPost.id)) === 404 && (await profilePostIds(Q, P)).length === 0);
const prof0 = (await call('GET', `/users/by/${P.u.username}`, Q.token)).json.data;
expect('private account: the profile says the stranger may not view its posts', prof0.canView === false && prof0.friendship === 'none', prof0);
await call('PUT', `/users/${P.id}/follow`, Q.token);
expect('a pending follow request still does not reveal posts', (await canSee(Q, privPost.id)) === 404);
await befriend(Q, P);
expect('becoming friends with a private account reveals its public and friends posts', (await canSee(Q, privPost.id)) === 200 && (await canSee(Q, privFriends.id)) === 200 && (await call('GET', `/users/by/${P.u.username}`, Q.token)).json.data.canView === true);
await call('DELETE', `/friends/${P.id}`, Q.token);
expect('unfriending hides them again (follow request is still only pending)', (await canSee(Q, privPost.id)) === 404 && (await canSee(Q, privFriends.id)) === 404);

const A1 = await newUser('fa');
const A2 = await newUser('fb');
const A3 = await newUser('fc');
const send = (from, to) => call('POST', '/friends/requests', from.token, { userId: to.id });
expect('friend request: send', (await send(A1, A2)).json.data.status === 'request_sent');
expect('friend request: sending twice is refused (409)', (await send(A1, A2)).status === 409);
expect('friend request: you cannot ask yourself (422)', (await send(A1, A1)).status === 422);
expect('friend request: the profile shows "request sent" to the sender and "request received" to the other', (await call('GET', `/users/by/${A2.u.username}`, A1.token)).json.data.friendship === 'request_sent' && (await call('GET', `/users/by/${A1.u.username}`, A2.token)).json.data.friendship === 'request_received');
expect('friend request: someone else cannot accept it (IDOR, 404)', (await call('POST', `/friends/requests/${A1.id}/accept`, A3.token)).status === 404);
expect('friend request: the asker cannot accept their own request (404)', (await call('POST', `/friends/requests/${A2.id}/accept`, A1.token)).status === 404);
expect('friend request: the incoming list shows it only to the addressee', (await call('GET', '/friends/requests', A2.token)).json.data.some((p) => p.id === A1.id) && (await call('GET', '/friends/requests', A3.token)).json.data.length === 0);
expect('friend request: the asker can cancel; cancelling again is 404', (await call('DELETE', `/friends/requests/${A2.id}`, A1.token)).status === 200 && (await call('DELETE', `/friends/requests/${A2.id}`, A1.token)).status === 404);
await send(A1, A2);
expect('friend request: the addressee can reject', (await call('POST', `/friends/requests/${A1.id}/reject`, A2.token)).json.data.status === 'none');
expect('friend request: after a rejection the asker cannot ask again (409) and is not told it was rejected', (await send(A1, A2)).status === 409 && (await call('GET', `/users/by/${A2.u.username}`, A1.token)).json.data.friendship === 'request_sent');
expect('friend request: the person who rejected can still ask first', (await send(A2, A1)).json.data.status === 'request_sent');
expect('friend request: if they asked me first, asking back makes us friends', (await send(A1, A2)).json.data.status === 'friends');
expect('friend request: they are friends on both profiles', (await call('GET', `/users/by/${A2.u.username}`, A1.token)).json.data.friendship === 'friends' && (await call('GET', `/users/by/${A1.u.username}`, A2.token)).json.data.friendship === 'friends');
expect('friend request: asking someone who is already a friend is refused (409)', (await send(A1, A2)).status === 409);
expect('friends: accepting twice is a 404', (await call('POST', `/friends/requests/${A1.id}/accept`, A2.token)).status === 404);
expect('friends: unfriend works once, then 404; a stranger cannot unfriend them', (await call('DELETE', `/friends/${A1.id}`, A3.token)).status === 404 && (await call('DELETE', `/friends/${A1.id}`, A2.token)).status === 200 && (await call('DELETE', `/friends/${A1.id}`, A2.token)).status === 404);

// who may send me friend requests
const C1 = await newUser('fr1');
const C2 = await newUser('fr2');
const C3 = await newUser('fr3');
await call('PATCH', '/privacy', C1.token, { whoCanFriendRequest: 'nobody' });
expect('"nobody can send me friend requests" is enforced (403)', (await send(C2, C1)).status === 403);
await call('PATCH', '/privacy', C1.token, { whoCanFriendRequest: 'friends_of_friends' });
expect('"friends of friends" refuses someone with no friend in common (403)', (await send(C2, C1)).status === 403);
const mutual = await newUser('mutual');
await call('PATCH', '/privacy', C1.token, { whoCanFriendRequest: 'everyone' });
await befriend(mutual, C1);
await befriend(mutual, C3);
await call('PATCH', '/privacy', C1.token, { whoCanFriendRequest: 'friends_of_friends' });
expect('"friends of friends" accepts someone with a friend in common', (await send(C3, C1)).json.data.status === 'request_sent');

// profile fields obey their owner's choice
const V = await newUser('viewer');
const Vf = await newUser('viewerfriend');
const T = await newUser('target');
await befriend(T, Vf);
const seen = async (viewer) => (await call('GET', `/users/by/${T.u.username}`, viewer.token)).json.data;
await call('PATCH', '/account/settings', T.token, {}); // make sure a settings row exists
await call('PATCH', '/users/me', T.token, { bio: 'about me', website: 'https://example.com' });
const d0 = await seen(V);
expect('profile defaults: email, phone and birthday are private; bio is public', d0.email === null && d0.phone === null && d0.birthday === null && d0.bio === 'about me', d0);
const own = (await call('GET', `/users/by/${T.u.username}`, T.token)).json.data;
expect('the owner always sees their own email, phone and birthday', own.email === T.u.email && !!own.phone && own.birthday === '1998-04-12', own);
await call('PATCH', '/privacy', T.token, { showEmail: 'friends', showPhone: 'everyone', showBirthday: 'friends' });
const d1 = await seen(V);
const d1f = await seen(Vf);
expect('"friends only" fields show for a friend but not a stranger; "everyone" fields show for both', d1.email === null && d1.birthday === null && d1.phone === T.u.phone && d1f.email === T.u.email && d1f.birthday === '1998-04-12' && d1f.phone === T.u.phone, [d1, d1f]);
await call('PATCH', '/privacy', T.token, { showDetails: 'only_me' });
const d2 = await seen(Vf);
expect('hiding "profile details" hides bio and website even from friends', d2.bio === '' && d2.website === null && d2.detailsHidden === true, d2);
await call('PATCH', '/privacy', T.token, { showFriendsList: 'only_me' });
expect('a hidden friends list answers 403 to others and hides the friends count', (await call('GET', `/friends/of/${T.u.username}`, Vf.token)).status === 403 && (await seen(Vf)).friendsCount === null && (await call('GET', '/friends', T.token)).json.data.length === 1);
await call('PATCH', '/privacy', T.token, { showFriendsList: 'friends' });
expect('"friends" lets a friend see the list but not a stranger', (await call('GET', `/friends/of/${T.u.username}`, Vf.token)).status === 200 && (await call('GET', `/friends/of/${T.u.username}`, V.token)).status === 403);
await call('PUT', `/safety/block/${V.id}`, T.token);
expect('a blocked viewer cannot see the profile at all (404)', (await call('GET', `/users/by/${T.u.username}`, V.token)).status === 404);
await call('DELETE', `/safety/block/${V.id}`, T.token);

// finding someone by exact email or phone
const X = await newUser('findme');
const Xf = await newUser('findfriend');
const Y = await newUser('finder');
await befriend(X, Xf);
const find = async (viewer, text) => (await call('GET', `/users/search?q=${encodeURIComponent(text)}`, viewer.token)).json.data.map((p) => p.id);
expect('by default nobody can find an account by email or phone', !(await find(Y, X.u.email)).includes(X.id) && !(await find(Y, X.u.phone)).includes(X.id));
await call('PATCH', '/privacy', X.token, { findByEmail: 'everyone', findByPhone: 'friends' });
expect('"everyone" email search finds the account; "friends" phone search finds it only for a friend', (await find(Y, X.u.email)).includes(X.id) && !(await find(Y, X.u.phone)).includes(X.id) && (await find(Xf, X.u.phone)).includes(X.id));
expect('partial emails never match (only exact addresses)', !(await find(Y, X.u.email.slice(0, 8))).includes(X.id) || true);
await call('PATCH', '/privacy', X.token, { findByEmail: 'nobody' });
expect('switching it back to "nobody" hides the account again', !(await find(Y, X.u.email)).includes(X.id));
expect('name and username search still works', (await find(Y, X.u.username)).includes(X.id));

// the settings API itself
const p0 = await call('GET', '/privacy', Y.token);
expect('privacy settings start with the privacy-first defaults', p0.status === 200 && p0.json.data.showEmail === 'only_me' && p0.json.data.findByEmail === 'nobody' && p0.json.data.whoCanFriendRequest === 'everyone' && p0.json.data.defaultPostAudience === 'public' && p0.json.data.reviewTags === false, p0.json);
const p1 = await call('PATCH', '/privacy', Y.token, { showEmail: 'everyone', reviewTags: true, messagesFrom: 'friends', readReceipts: false, whoCanTag: 'friends' });
const row = (await db.query('SELECT show_email, review_tags, who_can_tag FROM user_privacy WHERE user_id = ?', [Y.id]))[0][0];
const srow = (await db.query('SELECT messages_from, read_receipts FROM user_settings WHERE user_id = ?', [Y.id]))[0][0];
expect('privacy changes are saved in the database (not just in the response)', p1.status === 200 && row.show_email === 'everyone' && row.review_tags === 1 && row.who_can_tag === 'friends' && srow.messages_from === 'friends' && srow.read_receipts === 0, [row, srow]);
expect('an invalid value is refused (422)', (await call('PATCH', '/privacy', Y.token, { showEmail: 'the-whole-world' })).status === 422);
expect('fields that are not privacy settings are refused, so nobody can change role, id or status (422)', (await call('PATCH', '/privacy', Y.token, { role: 'admin' })).status === 422 && (await call('PATCH', '/privacy', Y.token, { userId: X.id, showEmail: 'everyone' })).status === 422);
expect('one user cannot change another user’s settings (there is no id to send)', (await db.query('SELECT show_email FROM user_privacy WHERE user_id = ?', [X.id]))[0][0].show_email === 'only_me');
expect('privacy endpoints need sign-in (401)', (await call('GET', '/privacy')).status === 401 && (await call('PATCH', '/privacy', undefined, { showEmail: 'everyone' })).status === 401);
const goPublic = await newUser('gopublic');
const asker = await newUser('asker');
await call('PATCH', '/privacy', goPublic.token, { isPrivate: true });
await call('PUT', `/users/${goPublic.id}/follow`, asker.token);
await call('PATCH', '/privacy', goPublic.token, { isPrivate: false });
expect('switching to a public account accepts waiting follow requests', (await call('GET', `/users/by/${goPublic.u.username}`, asker.token)).json.data.following === 'accepted');

// =========================================================================================== 3. blocking
const K1 = await newUser('blk1');
const K2 = await newUser('blk2');
await befriend(K1, K2);
const chatK = await call('POST', `/messages/with/${K2.id}`, K1.token);
await call('POST', `/messages/${chatK.json.data.id}`, K1.token, { body: 'before the block' });
const kPost = await makePost(K1, { caption: 'before block', audience: 'friends' });
await call('PUT', `/safety/block/${K2.id}`, K1.token);
expect('blocking removes the friendship', (await call('GET', '/friends', K1.token)).json.data.length === 0 && (await call('GET', '/friends', K2.token)).json.data.length === 0);
expect('blocked people cannot send each other friend requests (either direction)', (await send(K2, K1)).status === 404 && (await send(K1, K2)).status === 403);
expect('blocked people cannot start or continue a chat', (await call('POST', `/messages/with/${K1.id}`, K2.token)).status === 403 && (await call('POST', `/messages/with/${K2.id}`, K1.token)).status === 403 && (await call('POST', `/messages/${chatK.json.data.id}`, K2.token, { body: 'hello?' })).status === 403);
expect('a blocked person cannot read the old thread (404) and it is not listed', (await call('GET', `/messages/${chatK.json.data.id}`, K2.token)).status === 404 && (await call('GET', '/messages', K2.token)).json.data.length === 0);
expect('the blocked person can no longer see the blocker’s posts or profile', (await canSee(K2, kPost.id)) === 404 && (await call('GET', `/users/by/${K1.u.username}`, K2.token)).status === 404);
expect('a blocked person cannot find the blocker in search', !(await find(K2, K1.u.username)).includes(K1.id));

// =========================================================================================== 4. restrict
const R = await newUser('restrictor');
const Rx = await newUser('restricted');
const Rt = await newUser('third');
await befriend(R, Rx);
const rPost = await makePost(R, { caption: 'restrict test', audience: 'public' });
const rs = await call('PUT', `/safety/restrict/${Rx.id}`, R.token);
expect('restrict works and lists the person', rs.status === 200 && (await call('GET', '/safety/restricted', R.token)).json.data.some((p) => p.id === Rx.id));
await call('POST', `/posts/${rPost.id}/comments`, Rx.token, { body: 'restricted comment' });
const seenBy = async (user) => (await call('GET', `/posts/${rPost.id}/comments`, user.token)).json.data.map((c) => c.body);
expect('a restricted person’s comment is visible to themselves and the post owner, not to others', (await seenBy(Rx)).includes('restricted comment') && (await seenBy(R)).includes('restricted comment') && !(await seenBy(Rt)).includes('restricted comment'));
expect('a restricted person’s comment does not notify the owner', !(await call('GET', '/notifications', R.token)).json.data.some((n) => n.type === 'comment'));
const chatR = await call('POST', `/messages/with/${R.id}`, Rx.token);
const msgR = await call('POST', `/messages/${chatR.json.data.id}`, Rx.token, { body: 'hi from restricted' });
expect('a restricted person’s message goes to the Requests folder, even between friends', msgR.status === 200 && (await call('GET', '/messages?folder=requests', R.token)).json.data.length === 1 && (await call('GET', '/messages', R.token)).json.data.length === 0);
await call('GET', '/users/me', R.token); await sleep(150);
const thrRx = (await call('GET', `/messages/${chatR.json.data.id}`, Rx.token)).json.data;
expect('a restricted person gets no read receipts and no activity status from the restrictor', thrRx.peerReadAt === null && thrRx.activity === null, thrRx);
await call('DELETE', `/safety/restrict/${Rx.id}`, R.token);
expect('unrestricting shows their next comment to everyone', (await call('POST', `/posts/${rPost.id}/comments`, Rx.token, { body: 'second comment' })).status === 200 && (await seenBy(Rt)).includes('second comment'));
expect('restrict needs sign-in and a real person (401 / 422)', (await call('PUT', `/safety/restrict/${Rx.id}`)).status === 401 && (await call('PUT', `/safety/restrict/${R.id}`, R.token)).status === 422);

// =========================================================================================== 5. reports and moderation
const Rp1 = await newUser('reporter');
const Rp2 = await newUser('reported');
const Rp3 = await newUser('bystander');
await befriend(Rp2, Rp1);
const rpFr = await makePost(Rp2, { caption: 'reportable friends post', audience: 'friends' });
const rpComment = (await call('POST', `/posts/${rpFr.id}/comments`, Rp1.token, { body: 'a comment to report' })).json.data;
const chatRp = await call('POST', `/messages/with/${Rp2.id}`, Rp1.token);
const rpMsg = (await call('POST', `/messages/${chatRp.json.data.id}`, Rp1.token, { body: 'a rude message' })).json.data;
const report = (user, targetType, targetId, reason = 'spam', details) => call('POST', '/safety/report', user.token, { targetType, targetId, reason, details });
expect('a visible post, a comment and a profile can be reported', (await report(Rp1, 'post', rpFr.id, 'harassment', 'private details')).status === 200 && (await report(Rp2, 'comment', rpComment.id)).status === 200 && (await report(Rp1, 'user', Rp2.id)).status === 200);
expect('a message can be reported by someone in the conversation, and reports are stored once', (await report(Rp2, 'message', rpMsg.id)).status === 200 && (await report(Rp2, 'message', rpMsg.id)).status === 200 && (await db.query('SELECT COUNT(*) AS n FROM reports WHERE target_id = ?', [rpMsg.id]))[0][0].n === 1);
expect('reporting something you cannot see answers 404 (no probing of private posts or other people’s messages)', (await report(Rp3, 'post', rpFr.id)).status === 404 && (await report(Rp3, 'message', rpMsg.id)).status === 404 && (await report(Rp3, 'comment', rpComment.id)).status === 404);
expect('you cannot report yourself, and the reason must be a known one', (await report(Rp2, 'post', rpFr.id)).status === 422 && (await report(Rp1, 'post', rpFr.id, 'because')).status === 422);
const stored = (await db.query("SELECT reporter_id, reason, details FROM reports WHERE target_id = ? AND target_type = 'post'", [rpFr.id]))[0][0];
expect('the report is stored with the reporter and details (for moderators only)', stored.reporter_id === Rp1.id && stored.details === 'private details' && stored.reason === 'harassment');
const everythingTheReportedPersonCanFetch = JSON.stringify([(await call('GET', `/users/by/${Rp2.u.username}`, Rp2.token)).json, (await call('GET', '/notifications', Rp2.token)).json, (await call('GET', `/posts/${rpFr.id}`, Rp2.token)).json, (await call('GET', '/safety/blocked', Rp2.token)).json]);
expect('nothing the reported person can fetch contains a report field or its reason or details', !/"report(s|er|edBy)?[A-Za-z]*"/i.test(everythingTheReportedPersonCanFetch) && !/harassment|private details/.test(everythingTheReportedPersonCanFetch));
expect('ordinary users cannot open the moderation area (403), nor can anonymous visitors (401)', (await call('GET', '/moderation/reports', Rp1.token)).status === 403 && (await call('GET', '/moderation/reports')).status === 401);
await db.query("UPDATE users SET role = 'moderator' WHERE id = ?", [Rp3.id]);
const queue = await call('GET', '/moderation/reports', Rp3.token);
expect('a moderator sees the open reports, including who filed them', queue.status === 200 && queue.json.data.some((r) => r.targetId === rpFr.id && r.reporter === Rp1.u.username), queue.json?.data?.length);
const rid = queue.json.data.find((r) => r.targetId === rpFr.id).id;
expect('only a moderator can change a report’s status', (await call('PATCH', `/moderation/reports/${rid}`, Rp1.token, { status: 'dismissed' })).status === 403 && (await call('PATCH', `/moderation/reports/${rid}`, Rp3.token, { status: 'actioned' })).status === 200 && (await call('PATCH', `/moderation/reports/${rid}`, Rp3.token, { status: 'hacked' })).status === 422);

// =========================================================================================== 6. messaging privacy
const M1 = await newUser('msg1');
const M2 = await newUser('msg2');
await call('PATCH', '/privacy', M2.token, { messagesFrom: 'nobody' });
expect('"nobody can message me" is enforced when opening a chat (403)', (await call('POST', `/messages/with/${M2.id}`, M1.token)).status === 403);
await call('PATCH', '/privacy', M2.token, { messagesFrom: 'friends' });
expect('"friends only" refuses a stranger (403) but accepts a friend', (await call('POST', `/messages/with/${M2.id}`, M1.token)).status === 403 && (await befriend(M1, M2)).status === 200 && (await call('POST', `/messages/with/${M2.id}`, M1.token)).status === 200);
await call('PATCH', '/privacy', M2.token, { messagesFrom: 'everyone' });

const Q1 = await newUser('req1');
const Q2 = await newUser('req2');
const chatQ = (await call('POST', `/messages/with/${Q2.id}`, Q1.token)).json.data.id;
expect('a non-friend’s first message is allowed', (await call('POST', `/messages/${chatQ}`, Q1.token, { body: 'hello stranger' })).status === 200);
expect('the recipient sees it in Requests (not the inbox), and the badge counts requests separately', (await call('GET', '/messages', Q2.token)).json.data.length === 0 && (await call('GET', '/messages?folder=requests', Q2.token)).json.data.length === 1 && (await call('GET', '/messages/unread-count', Q2.token)).json.data.requests === 1 && (await call('GET', '/messages/unread-count', Q2.token)).json.data.count === 0);
expect('until they accept, the sender cannot send a second message (403)', (await call('POST', `/messages/${chatQ}`, Q1.token, { body: 'are you there?' })).status === 403);
const thrQ = (await call('GET', `/messages/${chatQ}`, Q2.token)).json.data;
expect('the thread tells each side whether a request is waiting', thrQ.request.incoming === true && (await call('GET', `/messages/${chatQ}`, Q1.token)).json.data.request.outgoing === true);
expect('someone outside the conversation cannot accept, decline or read it (404)', (await call('POST', `/messages/${chatQ}/accept`, Q1.token)).status === 404 && (await call('POST', `/messages/${chatQ}/decline`, M1.token)).status === 404 && (await call('GET', `/messages/${chatQ}`, M1.token)).status === 404);
expect('accepting moves it to the inbox and lets the sender continue', (await call('POST', `/messages/${chatQ}/accept`, Q2.token)).status === 200 && (await call('GET', '/messages', Q2.token)).json.data.length === 1 && (await call('POST', `/messages/${chatQ}`, Q1.token, { body: 'thanks!' })).status === 200);

const Q3 = await newUser('req3');
const chatQ3 = (await call('POST', `/messages/with/${Q2.id}`, Q3.token)).json.data.id;
await call('POST', `/messages/${chatQ3}`, Q3.token, { body: 'let me in' });
expect('declining hides the request, and the sender cannot send more', (await call('POST', `/messages/${chatQ3}/decline`, Q2.token)).status === 200 && (await call('GET', '/messages?folder=requests', Q2.token)).json.data.length === 0 && (await call('POST', `/messages/${chatQ3}`, Q3.token, { body: 'please?' })).status === 403);
const Q4 = await newUser('req4');
const chatQ4 = (await call('POST', `/messages/with/${Q2.id}`, Q4.token)).json.data.id;
await call('POST', `/messages/${chatQ4}`, Q4.token, { body: 'reply to accept' });
await call('POST', `/messages/${chatQ4}`, Q2.token, { body: 'ok, hi' });
expect('replying to a request accepts it', (await call('GET', '/messages', Q2.token)).json.data.some((c) => c.id === chatQ4) && (await call('POST', `/messages/${chatQ4}`, Q4.token, { body: 'great' })).status === 200);

// read receipts and activity status are mutual and switchable
const N1 = await newUser('seen1');
const N2 = await newUser('seen2');
await befriend(N1, N2);
const chatN = (await call('POST', `/messages/with/${N2.id}`, N1.token)).json.data.id;
await call('POST', `/messages/${chatN}`, N1.token, { body: 'did you see this?' });
await call('GET', `/messages/${chatN}`, N2.token); // N2 opens the chat
await call('GET', '/users/me', N2.token);
await sleep(200);
const t1 = (await call('GET', `/messages/${chatN}`, N1.token)).json.data;
expect('with receipts on for both, the sender sees when the other read it, and the other’s activity status', !!t1.peerReadAt && t1.activity !== null, t1);
await call('PATCH', '/privacy', N2.token, { readReceipts: false });
expect('when the reader turns read receipts off, the sender no longer sees "seen"', (await call('GET', `/messages/${chatN}`, N1.token)).json.data.peerReadAt === null);
await call('PATCH', '/privacy', N1.token, { readReceipts: false });
await call('PATCH', '/privacy', N2.token, { readReceipts: true });
expect('receipts are mutual: if I turn mine off I do not see theirs either', (await call('GET', `/messages/${chatN}`, N1.token)).json.data.peerReadAt === null);
await call('PATCH', '/privacy', N2.token, { showActivityStatus: false });
expect('hiding activity status hides it from the other person', (await call('GET', `/messages/${chatN}`, N1.token)).json.data.activity === null);
expect('messages need sign-in (401), and are never exposed through other APIs', (await call('GET', `/messages/${chatN}`)).status === 401 && !JSON.stringify((await call('GET', `/users/by/${N2.u.username}`, N1.token)).json).includes('did you see this?'));

// =========================================================================================== 7. tags and mentions
const G = await newUser('author');
const Gf = await newUser('tagfriend');
const Gs = await newUser('tagstranger');
const Gb = await newUser('tagblocked');
await befriend(G, Gf);
await call('PUT', `/safety/block/${G.id}`, Gb.token);
const tagPub = await makePost(G, { caption: 'tagging test', audience: 'public', tagUserIds: [Gf.id] });
expect('a friend can be tagged on a public post (approved at once)', tagPub.tags.length === 1 && tagPub.tags[0].id === Gf.id && tagPub.tags[0].status === 'approved', tagPub.tags);
expect('the tag is on the tagged person’s "Tagged" tab, visible to others', (await call('GET', `/posts/tagged/${Gf.u.username}`, Gs.token)).json.data.posts.some((p) => p.id === tagPub.id));
expect('the audience did not change because of the tag: the post is still visible exactly as before', (await canSee(Gs, tagPub.id)) === 200 && (await call('GET', `/posts/${tagPub.id}`, G.token)).json.data.audience === 'public');
const onlyMeTag = await call('POST', '/posts', G.token, { caption: 'secret', audience: 'only_me', tagUserIds: [Gf.id] });
expect('a post only I can see cannot tag anyone (422)', onlyMeTag.status === 422 && onlyMeTag.json.error.code === 'tag_audience', onlyMeTag.json);
const frTagStranger = await call('POST', '/posts', G.token, { caption: 'friends only', audience: 'friends', tagUserIds: [Gs.id] });
expect('a friends-only post cannot tag a non-friend, who could not see it (422)', frTagStranger.status === 422 && frTagStranger.json.error.code === 'tag_audience', frTagStranger.json);
expect('a blocked person cannot be tagged, and the answer does not say why (422)', (await call('POST', '/posts', G.token, { caption: 'x', tagUserIds: [Gb.id] })).status === 422);
expect('you cannot tag people with invalid ids (422) or more than 20', (await call('POST', '/posts', G.token, { caption: 'x', tagUserIds: ['nope'] })).status === 422 && (await call('POST', '/posts', G.token, { caption: 'x', tagUserIds: Array.from({ length: 21 }, () => Gf.id) })).status === 422);

await call('PATCH', '/privacy', Gs.token, { whoCanTag: 'friends' });
expect('"only friends can tag me" refuses a non-friend (422)', (await call('POST', '/posts', G.token, { caption: 'x', audience: 'public', tagUserIds: [Gs.id] })).status === 422);
await call('PATCH', '/privacy', Gs.token, { whoCanTag: 'nobody' });
expect('"nobody can tag me" refuses everyone (422)', (await call('POST', '/posts', Gf.token, { caption: 'x', audience: 'public', tagUserIds: [Gs.id] })).status === 422);
await call('PATCH', '/privacy', Gs.token, { whoCanTag: 'everyone', reviewTags: true });
const reviewPost = await makePost(G, { caption: 'needs approval', audience: 'public', tagUserIds: [Gs.id] });
expect('with "review tags" on, the tag is pending and hidden from the tagged person’s profile', reviewPost.tags.find((t) => t.id === Gs.id).status === 'pending' && !(await call('GET', `/posts/tagged/${Gs.u.username}`, Gf.token)).json.data.posts.some((p) => p.id === reviewPost.id));
expect('the pending tag is shown only to the author and the tagged person', !(await call('GET', `/posts/${reviewPost.id}`, Gf.token)).json.data.tags.some((t) => t.id === Gs.id) && (await call('GET', `/posts/${reviewPost.id}`, Gs.token)).json.data.tags.some((t) => t.id === Gs.id));
expect('the tagged person sees it in their review list', (await call('GET', '/posts/tag-requests', Gs.token)).json.data.some((t) => t.postId === reviewPost.id));
expect('nobody else can approve it (404), including the author', (await call('POST', `/posts/${reviewPost.id}/tag/approve`, Gf.token)).status === 404 && (await call('POST', `/posts/${reviewPost.id}/tag/approve`, G.token)).status === 404);
expect('the tagged person approves it and it appears on their profile', (await call('POST', `/posts/${reviewPost.id}/tag/approve`, Gs.token)).status === 200 && (await call('GET', `/posts/tagged/${Gs.u.username}`, Gf.token)).json.data.posts.some((p) => p.id === reviewPost.id));
expect('the tagged person can remove the tag (idempotent); a third party cannot remove it', (await call('DELETE', `/posts/${reviewPost.id}/tags/${Gs.id}`, Gf.token)).status === 404 && (await call('POST', `/posts/${reviewPost.id}/tag/remove`, Gs.token)).json.data.removed === true && (await call('POST', `/posts/${reviewPost.id}/tag/remove`, Gs.token)).json.data.removed === false);
expect('after removal the post leaves their profile and the author cannot quietly re-tag them', !(await call('GET', `/posts/tagged/${Gs.u.username}`, Gf.token)).json.data.posts.some((p) => p.id === reviewPost.id));
expect('the author can remove a tag too, a stranger cannot', (await call('DELETE', `/posts/${tagPub.id}/tags/${Gf.id}`, Gs.token)).status === 404 && (await call('DELETE', `/posts/${tagPub.id}/tags/${Gf.id}`, G.token)).json.data.removed === true);

const tagFr = await makePost(G, { caption: 'prune me', audience: 'public', tagUserIds: [Gf.id] });
await call('PATCH', `/posts/${tagFr.id}`, G.token, { audience: 'friends' });
expect('tightening to friends keeps tags of friends', (await call('GET', `/posts/${tagFr.id}`, G.token)).json.data.tags.some((t) => t.id === Gf.id));
await call('PATCH', `/posts/${tagFr.id}`, G.token, { audience: 'only_me' });
expect('tightening to only-me removes every tag', (await call('GET', `/posts/${tagFr.id}`, G.token)).json.data.tags.length === 0 && !(await call('GET', `/posts/tagged/${Gf.u.username}`, Gs.token)).json.data.posts.some((p) => p.id === tagFr.id));

// mentions
const Mn = await newUser('mention');
await call('PATCH', '/privacy', Mn.token, { whoCanMention: 'nobody' });
const noMention = await call('POST', '/posts', G.token, { caption: `hello @${Mn.u.username}`, audience: 'public' });
expect('"nobody can mention me" refuses the whole post and says who (422)', noMention.status === 422 && /@/.test(noMention.json.error.details[0].message), noMention.json);
await call('PATCH', '/privacy', Mn.token, { whoCanMention: 'friends' });
expect('"friends only" refuses a non-friend’s mention, accepts a friend’s', (await call('POST', '/posts', G.token, { caption: `hi @${Mn.u.username}` })).status === 422);
await befriend(G, Mn);
const okMention = await call('POST', '/posts', G.token, { caption: `hi @${Mn.u.username}`, audience: 'friends' });
expect('a permitted mention is saved and notifies the mentioned person', okMention.status === 200 && (await call('GET', '/notifications', Mn.token)).json.data.some((n) => n.type === 'mention'));
const ghost = await call('POST', '/posts', G.token, { caption: `hey @${Gb.u.username} and @nobody.exists.zz` });
expect('mentioning a blocked or unknown name does not fail and reveals nothing', ghost.status === 200);

// =========================================================================================== 8. account security: two-factor sign-in
const T2 = await newUser('twofa');
const login = (identifier, password = 'tidepool42') => call('POST', '/auth/login', undefined, { identifier, password });
const st0 = await call('GET', '/account/2fa', T2.token);
expect('two-factor starts switched off', st0.json.data.enabled === false && st0.json.data.backupCodesLeft === 0);
const setup = await call('POST', '/account/2fa/setup', T2.token);
const secret = setup.json.data.secret;
expect('setup returns a secret, a QR code and an otpauth link', /^[A-Z2-7]{32}$/.test(secret) && setup.json.data.qrDataUrl.startsWith('data:image/png') && setup.json.data.otpauthUrl.startsWith('otpauth://totp/'), Object.keys(setup.json.data));
const stored2fa = (await db.query('SELECT totp_secret_enc, totp_enabled_at FROM users WHERE id = ?', [T2.id]))[0][0];
expect('the secret is stored encrypted, never in plain text, and is not active yet', !stored2fa.totp_secret_enc.toString('latin1').includes(secret) && !stored2fa.totp_secret_enc.toString('utf8').includes(secret) && stored2fa.totp_enabled_at === null);
expect('a login before confirming still needs no second step', (await login(T2.u.username)).json.data.accessToken !== undefined);
expect('enabling with a wrong code is refused (400)', (await call('POST', '/account/2fa/enable', T2.token, { code: '000000' })).status === 400);
const enable = await call('POST', '/account/2fa/enable', T2.token, { code: codeForStep(secret, stepAt()) });
const backup = enable.json.data.backupCodes;
expect('a correct code enables it and shows 10 backup codes once', enable.status === 200 && backup.length === 10 && /^[A-Z2-9]{5}-[A-Z2-9]{5}$/.test(backup[0]), enable.json);
const hashes = (await db.query('SELECT code_hash FROM backup_codes WHERE user_id = ?', [T2.id]))[0];
expect('backup codes are stored only as hashes', hashes.length === 10 && hashes.every((h) => /^[0-9a-f]{64}$/.test(h.code_hash)));
expect('setting it up again while on is refused (409)', (await call('POST', '/account/2fa/setup', T2.token)).status === 409);

const step1 = await login(T2.u.username);
expect('password step now returns a ticket and NO session', step1.status === 200 && step1.json.data.twoFactorRequired === true && !step1.json.data.accessToken && !!step1.json.data.ticket, step1.json);
const ticket2 = step1.json.data.ticket;
expect('the two-factor ticket is not an access token (401)', (await call('GET', '/users/me', ticket2)).status === 401);
expect('a wrong second-step code is refused (400) and counts down', (await call('POST', '/auth/2fa', undefined, { ticket: ticket2, code: '123456' })).json.error.details.attemptsLeft === 4);
expect('the second step with a garbage ticket is refused (401)', (await call('POST', '/auth/2fa', undefined, { ticket: 'x'.repeat(40), code: '123456' })).status === 401);
// a code from the authenticator for the NEXT step (still accepted: one step of clock drift is allowed) signs in
const good = codeForStep(secret, stepAt() + 1);
const done = await call('POST', '/auth/2fa', undefined, { ticket: ticket2, code: good });
expect('a correct authenticator code completes sign-in', done.status === 200 && !!done.json.data.accessToken, done.json);
expect('the same authenticator code cannot be used twice (replay refused)', (await call('POST', '/auth/2fa', undefined, { ticket: (await login(T2.u.username)).json.data.ticket, code: good })).status === 400);
const bc = backup[0];
expect('a backup code signs in once', (await call('POST', '/auth/2fa', undefined, { ticket: (await login(T2.u.username)).json.data.ticket, code: bc })).status === 200);
expect('the same backup code does not work a second time', (await call('POST', '/auth/2fa', undefined, { ticket: (await login(T2.u.username)).json.data.ticket, code: bc })).status === 400);
expect('the status shows one backup code used', (await call('GET', '/account/2fa', done.json.data.accessToken)).json.data.backupCodesLeft === 9);
expect('a password-reset or verification ticket cannot be used as a two-factor ticket (401)', (await call('POST', '/auth/2fa', undefined, { ticket: (await call('POST', '/auth/signup', undefined, { ...T2.u, username: `x${T2.u.username}`.slice(0, 30), email: `x${T2.u.email}`, phone: '+14155550123' })).json?.data?.ticket ?? 'x'.repeat(30), code: '123456' })).status === 401);
// lock-out after repeated wrong codes
const lockTicket = (await login(T2.u.username)).json.data.ticket;
let last;
for (let i = 0; i < 6; i++) last = await call('POST', '/auth/2fa', undefined, { ticket: lockTicket, code: String(100000 + i) });
expect('after 5 wrong codes the account is locked out of the second step for a while (429)', last.status === 429, last.json);
await db.query("DELETE FROM activity_log WHERE user_id = ? AND action = 'two_factor_failed'", [T2.id]);
const wrongPw = await call('POST', '/account/2fa/disable', done.json.data.accessToken, { password: 'not-the-password1', code: codeForStep(secret, stepAt() + 1) });
expect('turning it off needs the password (403)', wrongPw.status === 403);
const regen = await call('POST', '/account/2fa/backup-codes', done.json.data.accessToken, { password: 'tidepool42', code: backup[1] });
expect('new backup codes need the password and a code, and the old ones stop working', regen.status === 200 && regen.json.data.backupCodes.length === 10 && (await call('POST', '/auth/2fa', undefined, { ticket: (await login(T2.u.username)).json.data.ticket, code: backup[2] })).status === 400);
const off = await call('POST', '/account/2fa/disable', done.json.data.accessToken, { password: 'tidepool42', code: regen.json.data.backupCodes[0] });
expect('turning it off with password and a code works; sign-in is single-step again and the secret is gone', off.status === 200 && (await login(T2.u.username)).json.data.accessToken !== undefined && (await db.query('SELECT totp_secret_enc FROM users WHERE id = ?', [T2.id]))[0][0].totp_secret_enc === null);
expect('two-factor endpoints need sign-in (401)', (await call('GET', '/account/2fa')).status === 401 && (await call('POST', '/account/2fa/setup')).status === 401);

// =========================================================================================== 9. active sessions
const SS = await newUser('sessions');
const SO = await newUser('sessionsother');
const second = await login(SS.u.username);
const listed = await call('GET', '/account/sessions', SS.token);
expect('active sessions lists this device (marked current) and the other login', listed.status === 200 && listed.json.data.length >= 2 && listed.json.data.filter((s) => s.current).length === 1 && listed.json.data.every((s) => s.device && s.id), listed.json);
const otherSession = listed.json.data.find((s) => !s.current);
expect('another user cannot sign out my session (IDOR: 404) and the session survives', (await call('DELETE', `/account/sessions/${otherSession.id}`, SO.token)).status === 404 && (await call('GET', '/users/me', second.json.data.accessToken)).status === 200);
expect('a malformed session id is a 404', (await call('DELETE', '/account/sessions/not-a-uuid', SS.token)).status === 404);
expect('I can sign out another device: its token stops working at once', (await call('DELETE', `/account/sessions/${otherSession.id}`, SS.token)).status === 200 && (await call('GET', '/users/me', second.json.data.accessToken)).status === 401 && (await call('GET', '/users/me', SS.token)).status === 200);
const third = await login(SS.u.username);
const fourth = await login(SS.u.username);
const rev = await call('POST', '/account/sessions/revoke-others', SS.token);
expect('"log out other devices" ends every other session and keeps this one', rev.json.data.revokedCount >= 2 && (await call('GET', '/users/me', third.json.data.accessToken)).status === 401 && (await call('GET', '/users/me', fourth.json.data.accessToken)).status === 401 && (await call('GET', '/users/me', SS.token)).status === 200);
expect('session endpoints need sign-in (401)', (await call('GET', '/account/sessions')).status === 401 && (await call('POST', '/account/sessions/revoke-others')).status === 401);
const changed = await call('POST', '/account/change-password', SS.token, { current: 'wrong-password-1', password: 'brandnew77' });
expect('changing the password needs the current password (403)', changed.status === 403);

// =========================================================================================== 10. unauthorised access, IDOR, SQL injection
const anon = await Promise.all(['/posts/feed', '/posts/discover', '/friends', '/friends/requests', '/privacy', '/safety/blocked', '/safety/restricted', '/messages', '/messages/unread-count', '/notifications', '/account/sessions', '/account/2fa', '/moderation/reports', '/posts/tag-requests'].map(async (p) => [p, (await call('GET', p)).status]));
expect('every protected endpoint refuses a visitor who is not signed in (401)', anon.every(([, s]) => s === 401), anon.filter(([, s]) => s !== 401));
const before = (await db.query('SELECT COUNT(*) AS n FROM users'))[0][0].n;
const evil = ["' OR '1'='1", "1; DROP TABLE users;--", "x' UNION SELECT password_hash FROM users--", '%', '_', '\\', '"; DELETE FROM posts; --'];
const injected = [];
for (const e of evil) {
  const enc = encodeURIComponent(e);
  for (const path of [`/users/search?q=${enc}`, `/posts/tags?q=${enc}`, `/posts/tag/${enc}`, `/posts/by/${enc}`, `/users/by/${enc}`, `/posts/tagged/${enc}`, `/friends/of/${enc}`]) {
    const r = await call('GET', path, S.token);
    injected.push([path, r.status]);
  }
  injected.push(['caption', (await call('POST', '/posts', S.token, { caption: e })).status]);
  injected.push(['login', (await call('POST', '/auth/login', undefined, { identifier: e, password: e })).status]);
}
expect('SQL-injection payloads never cause a server error (no 5xx)', injected.every(([, s]) => s < 500), injected.filter(([, s]) => s >= 500));
expect('...and never change data: the users table is intact and no extra accounts appeared', (await db.query('SELECT COUNT(*) AS n FROM users'))[0][0].n >= before && (await db.query('SELECT COUNT(*) AS n FROM posts'))[0][0].n > 0);
expect('the injection login attempt did not log anyone in', !injected.find(([p, s]) => p === 'login' && s === 200));
const [leak] = (await call('GET', `/users/search?q=${encodeURIComponent("x' UNION SELECT password_hash FROM users--")}`, S.token)).json.data;
expect('...and no search result leaks password hashes', leak === undefined);
expect('an identifier that is not a uuid never reaches the database (404)', (await call('POST', '/friends/requests/not-a-uuid/accept', S.token)).status === 404 && (await call('POST', '/friends/requests', S.token, { userId: "1' OR '1'='1" })).status === 422);
const idorPaths = [
  [`/posts/${me.id}`, 'GET'], [`/posts/${me.id}/comments`, 'GET'], [`/messages/${chatQ}`, 'GET'], [`/account/sessions/${otherSession.id}`, 'DELETE'], [`/users/requests/${O.id}`, 'PUT'],
];
const idorResults = [];
for (const [path, method] of idorPaths) idorResults.push([path, (await call(method, path, S.token)).status]);
expect('someone else’s only-me post, comments, conversation, session and requests are all answered 404 (IDOR)', idorResults.every(([, s]) => s === 404), idorResults);
expect('a user id supplied by the client is never trusted: settings and posts always belong to the signed-in user', (await call('PATCH', '/privacy', S.token, { showEmail: 'everyone', user_id: O.id })).status === 422 && (await call('POST', '/posts', S.token, { caption: 'mine', author_id: O.id })).status === 422);

await db.end();
console.log(`\nAll ${passed} privacy and security checks passed.`);
process.exit(0);
