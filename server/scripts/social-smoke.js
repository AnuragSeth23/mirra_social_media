/*
 * End-to-end check of posts, likes, comments, shares, follows and photo upload against a running API.
 * Usage: npm run smoke:social   (one-time codes are read from verification_codes.dev_code, dev only)
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Reads the latest one-time code from verification_codes.dev_code (filled in development only).
const db = await mysql.createConnection(config.DATABASE_URL);
const code = async (channel, who) =>
  (
    await db.query(
      `SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id
      WHERE (u.email = ? OR u.username = ?) AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`,
      [who, who, channel],
    )
  )[0][0].dev_code;

async function call(method, path, token, body, raw) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': raw?.type ?? 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: raw ? raw.data : body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null), res };
}

async function newUser(tag) {
  const n = `${Date.now().toString().slice(-6)}${tag}`;
  const u = {
    fullName: `Test ${tag}`,
    username: `t${n}`,
    email: `t${n}@example.com`,
    phone: `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
    password: 'tidepool42',
    dateOfBirth: '1998-04-12',
  };
  const s = await call('POST', '/auth/signup', undefined, u);
  const ticket = s.json.data.ticket;
  await sleep(300);
  await call('POST', '/auth/verify', undefined, { ticket, channel: 'email', code: await code('email', u.email) });
  const v = await call('POST', '/auth/verify', undefined, { ticket, channel: 'phone', code: await code('phone', u.username) });
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

const a = await newUser('a');
const b = await newUser('b');
expect('two users signed up', !!a.token && !!b.token);

const empty = await call('POST', '/posts', a.token, { caption: '' });
expect('empty post is rejected', empty.status === 422, empty.json);

const text = await call('POST', '/posts', a.token, { caption: 'hello socialambak' });
expect('text post is created', text.status === 200 && text.json.data.caption === 'hello socialambak', text.json);
const postId = text.json.data.id;

// 1x1 PNG
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAHWbuugAAAABJRU5ErkJggg==', 'base64');
const bad = await call('POST', '/media', a.token, undefined, { type: 'image/png', data: Buffer.from('not an image at all') });
expect('fake image bytes are rejected', bad.status === 415, bad.json);
const up = await call('POST', '/media', a.token, undefined, { type: 'image/png', data: png });
expect('png upload returns a key', up.status === 200 && /\.png$/.test(up.json.data.key), up.json);
const withImg = await call('POST', '/posts', a.token, { caption: '', mediaKey: up.json.data.key });
expect('photo post is created', withImg.status === 200 && !!withImg.json.data.mediaUrl, withImg.json);
const served = await fetch(`http://localhost:4000${withImg.json.data.mediaUrl}`);
expect('uploaded photo is served', served.status === 200 && served.headers.get('content-type') === 'image/png');

const l1 = await call('PUT', `/posts/${postId}/like`, b.token);
const l2 = await call('PUT', `/posts/${postId}/like`, b.token);
expect('like is idempotent (count stays 1)', l1.json.data.likeCount === 1 && l2.json.data.likeCount === 1 && l2.json.data.liked, l2.json);
const un = await call('DELETE', `/posts/${postId}/like`, b.token);
expect('unlike returns count to 0', un.json.data.likeCount === 0 && !un.json.data.liked, un.json);

const c = await call('POST', `/posts/${postId}/comments`, b.token, { body: 'nice one' });
expect('comment is added', c.status === 200 && c.json.data.body === 'nice one', c.json);
const list = await call('GET', `/posts/${postId}/comments`, a.token);
expect('comment list shows it with correct author', list.json.data.length === 1 && list.json.data[0].mine === false, list.json);
const blank = await call('POST', `/posts/${postId}/comments`, b.token, { body: '   ' });
expect('blank comment is rejected', blank.status === 422, blank.json);
const cnt = await call('GET', `/posts/${postId}`, a.token);
expect('comment_count is 1', cnt.json.data.commentCount === 1, cnt.json);
const ownerDel = await call('DELETE', `/posts/${postId}/comments/${c.json.data.id}`, a.token);
const afterDel = await call('GET', `/posts/${postId}`, a.token);
expect("the post's owner can delete a comment on their own post (count drops to 0)", ownerDel.status === 204 && afterDel.json.data.commentCount === 0, [ownerDel.status, afterDel.json]);

const sh = await call('POST', `/posts/${postId}/share`, b.token);
expect('share count increments', sh.json.data.shareCount === 1, sh.json);

const f0 = await call('GET', '/posts/feed', b.token);
expect("feed before following excludes A's posts", f0.json.data.posts.length === 0, f0.json);
const fol = await call('PUT', `/users/${a.id}/follow`, b.token);
const fol2 = await call('PUT', `/users/${a.id}/follow`, b.token);
expect('follow is accepted and idempotent', fol.json.data.following === 'accepted' && fol2.status === 200);
const meA = await call('GET', '/users/me', a.token);
expect('followers_count is 1 (not double counted)', meA.json.data.followersCount === 1 && meA.json.data.postsCount === 2, meA.json);
const f1 = await call('GET', '/posts/feed', b.token);
expect("feed after following shows A's 2 posts, newest first", f1.json.data.posts.length === 2 && f1.json.data.posts[0].id === withImg.json.data.id, f1.json);
const self = await call('PUT', `/users/${b.id}/follow`, b.token);
expect("can't follow yourself", self.status === 422);

const noDel = await call('DELETE', `/posts/${postId}`, b.token);
expect("can't delete someone else's post", noDel.status === 404);
const del = await call('DELETE', `/posts/${postId}`, a.token);
const gone = await call('GET', `/posts/${postId}`, b.token);
expect('owner deletes post; it disappears', del.status === 204 && gone.status === 404);
const noAuth = await call('GET', '/posts/feed');
expect('feed requires sign-in', noAuth.status === 401);

// ---- follow back, profiles, unfollow
const sug = await call('GET', '/users/suggestions', a.token);
const bInSug = sug.json.data.find((p) => p.id === b.id);
expect('A sees B (who follows A) as "follows you" in suggestions', bInSug?.followsYou === true && bInSug.following === 'none', sug.json);
expect('followers who are not followed back are listed first', sug.json.data[0].followsYou === true, sug.json.data.slice(0, 2));

const prof = await call('GET', `/users/by/${b.u.username}`, a.token);
expect("A can open B's profile with relation info", prof.status === 200 && prof.json.data.followsYou === true && prof.json.data.following === 'none' && prof.json.data.canView === true, prof.json);
const me2 = await call('GET', `/users/by/${a.u.username}`, a.token);
expect('own profile reports isMe', me2.json.data.isMe === true);
const nobody = await call('GET', '/users/by/nobody.exists.zz', a.token);
expect('unknown username is 404', nobody.status === 404);
const theirPosts = await call('GET', `/posts/by/${b.u.username}`, a.token);
expect('profile posts endpoint works (B has none)', theirPosts.status === 200 && theirPosts.json.data.posts.length === 0, theirPosts.json);
const followers = await call('GET', `/users/by/${a.u.username}/connections?type=followers`, b.token);
expect(
  "A's followers list contains B",
  followers.json.data.some((p) => p.id === b.id),
  followers.json,
);
const following = await call('GET', `/users/by/${b.u.username}/connections?type=following`, b.token);
expect(
  "B's following list contains A",
  following.json.data.some((p) => p.id === a.id),
  following.json,
);

await call('PUT', `/users/${b.id}/follow`, a.token);
const mutual = await call('GET', `/users/by/${b.u.username}`, a.token);
expect('follow back makes it mutual', mutual.json.data.following === 'accepted' && mutual.json.data.followsYou === true, mutual.json);
const unf = await call('DELETE', `/users/${b.id}/follow`, a.token);
const unf2 = await call('DELETE', `/users/${b.id}/follow`, a.token);
const after = await call('GET', '/users/me', a.token);
expect(
  'unfollow works, is idempotent, counters stay correct',
  unf.json.data.following === 'none' && unf2.status === 200 && after.json.data.followingCount === 0 && after.json.data.followersCount === 1,
  after.json,
);

// ---- forgot / reset password
const gen1 = await call('POST', '/auth/forgot', undefined, { identifier: a.u.email });
const gen2 = await call('POST', '/auth/forgot', undefined, { identifier: 'no.such.user.zz' });
expect(
  'forgot answers 200 "sent" for real and unknown accounts (apart from the development-only on-screen hint)',
  gen1.status === 200 && gen2.status === 200 && gen1.json.data.sent === true && gen2.json.data.sent === true,
  [gen1.json, gen2.json],
);
expect(
  'in development the reset code is also returned for the screen, and matches the database',
  /^\d{6}$/.test(gen1.json.data.dev?.code ?? '') && gen1.json.data.dev.code === (await code('email', a.u.email)),
  gen1.json,
);
expect('an unknown identifier gets a development note instead of a code', !gen2.json.data.dev?.code && /No account matches/.test(gen2.json.data.dev?.note ?? ''), gen2.json);
await sleep(300);
const badReset = await call('POST', '/auth/reset', undefined, { identifier: a.u.email, code: '000000', password: 'brandnew99' });
expect('wrong reset code is rejected and counted', badReset.status === 400 && badReset.json.error.details.attemptsLeft === 4, badReset.json);
const weak = await call('POST', '/auth/reset', undefined, { identifier: a.u.email, code: await code('email', a.u.email), password: 'short' });
expect('weak new password is rejected', weak.status === 422, weak.json);
const reset = await call('POST', '/auth/reset', undefined, { identifier: a.u.email, code: await code('email', a.u.email), password: 'brandnew99' });
expect('correct code resets the password', reset.status === 200 && reset.json.data.reset === true, reset.json);
const reuse = await call('POST', '/auth/reset', undefined, { identifier: a.u.email, code: await code('email', a.u.email), password: 'another123' });
expect('a reset code cannot be used twice', reuse.status === 400, reuse.json);
const oldPw = await call('POST', '/auth/login', undefined, { identifier: a.u.email, password: a.u.password });
const newPw = await call('POST', '/auth/login', undefined, { identifier: a.u.username, password: 'brandnew99' });
expect('old password stops working, new one works', oldPw.status === 401 && newPw.status === 200, [oldPw.json, newPw.json]);
const oldToken = await call('GET', '/users/me', a.token);
expect('reset signs out existing sessions', oldToken.status === 401, oldToken.json);

// ---- video, reels, explore, saved, notifications, stories, search, edit profile, messages
const aT = newPw.json.data.accessToken;
const mp4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70]), Buffer.from('mp42'), Buffer.alloc(32)]);
const vup = await call('POST', '/media', aT, undefined, { type: 'video/mp4', data: mp4 });
expect('mp4 upload is accepted as video', vup.status === 200 && vup.json.data.mediaType === 'video' && /\.mp4$/.test(vup.json.data.key), vup.json);
const textAsVideo = await call('POST', '/media', aT, undefined, { type: 'video/mp4', data: Buffer.from('this is not a video file at all') });
expect('fake video bytes are rejected', textAsVideo.status === 415, textAsVideo.json);

const reelNoVideo = await call('POST', '/posts', aT, { caption: 'x', kind: 'reel' });
expect('reel without a video is rejected', reelNoVideo.status === 422, reelNoVideo.json);
const reelWithImage = await call('POST', '/posts', aT, { caption: 'x', kind: 'reel', mediaKey: up.json.data.key });
expect('reel with an image is rejected', reelWithImage.status === 422, reelWithImage.json);
const reel = await call('POST', '/posts', aT, { caption: 'my reel', kind: 'reel', mediaKey: vup.json.data.key });
expect('reel is created', reel.status === 200 && reel.json.data.kind === 'reel' && reel.json.data.mediaType === 'video', reel.json);
const reels = await call('GET', '/posts/reels', b.token);
expect(
  'reels feed shows it to another user',
  reels.json.data.posts.some((p) => p.id === reel.json.data.id),
  reels.json,
);
const vserved = await fetch(`http://localhost:4000${reel.json.data.mediaUrl}`, { headers: { Range: 'bytes=0-9' } });
expect('video is served with Range support (206)', vserved.status === 206, vserved.status);
const exp = await call('GET', '/posts/explore', b.token);
expect('explore lists public media posts from others', exp.status === 200 && exp.json.data.posts.length >= 2 && exp.json.data.posts.every((p) => !p.mine && p.mediaUrl), exp.json);

const sv = await call('PUT', `/posts/${reel.json.data.id}/save`, b.token);
await call('PUT', `/posts/${reel.json.data.id}/save`, b.token);
const saved = await call('GET', '/posts/saved', b.token);
expect('save is idempotent and shows in saved list', sv.json.data.saved === true && saved.json.data.posts.length === 1 && saved.json.data.posts[0].saved === true, saved.json);
await call('DELETE', `/posts/${reel.json.data.id}/save`, b.token);
const saved2 = await call('GET', '/posts/saved', b.token);
expect('unsave removes it', saved2.json.data.posts.length === 0);

const n0 = await call('POST', '/notifications/read', aT);
await call('PUT', `/posts/${reel.json.data.id}/like`, b.token);
await call('PUT', `/posts/${reel.json.data.id}/like`, aT);
const n1 = await call('GET', '/notifications', aT);
const likeN = n1.json.data.filter((n) => n.type === 'post_like' && n.actor.username === b.u.username && !n.read);
expect('liking my post notifies me (and my own like does not)', n0.status === 204 && likeN.length === 1 && !n1.json.data.some((n) => n.actor.username === a.u.username), n1.json);
const cnt1 = await call('GET', '/notifications/unread-count', aT);
await call('POST', '/notifications/read', aT);
const cnt2 = await call('GET', '/notifications/unread-count', aT);
expect('unread count goes to 0 after mark-all-read', cnt1.json.data.count >= 1 && cnt2.json.data.count === 0, [cnt1.json, cnt2.json]);

const st = await call('POST', '/stories', aT, { mediaKey: up.json.data.key, caption: 'hi story' });
expect('story is created', st.status === 200 && !!st.json.data.id, st.json);
const tray = await call('GET', '/stories', b.token);
const group = tray.json.data.find((g) => g.author.username === a.u.username);
expect("follower sees A's story, unviewed", !!group && group.items[0].viewed === false && group.allViewed === false, tray.json);
await call('POST', `/stories/${st.json.data.id}/view`, b.token);
await call('POST', `/stories/${st.json.data.id}/view`, b.token);
const tray2 = await call('GET', '/stories', b.token);
const mine = await call('GET', '/stories', aT);
expect('viewing marks it seen once; owner sees view count 1', tray2.json.data.find((g) => g.author.username === a.u.username).allViewed === true && mine.json.data[0].items[0].viewCount === 1, [
  tray2.json,
  mine.json,
]);
const cTray = await call('GET', '/stories', (await newUser('c')).token);
expect('a non-follower does not see the story', cTray.json.data.length === 0, cTray.json);
const delSt = await call('DELETE', `/stories/${st.json.data.id}`, aT);
expect('owner deletes the story', delSt.status === 204);

const s1 = await call('GET', `/users/search?q=${encodeURIComponent(b.u.username.slice(0, 5))}`, aT);
expect(
  'search finds users by username prefix',
  s1.json.data.some((p) => p.id === b.id),
  s1.json,
);
const s2 = await call('GET', '/users/search?q=zzzzqqq', aT);
expect('search with no match returns empty list', s2.json.data.length === 0);

const edit = await call('PATCH', '/users/me', aT, { bio: 'hello there', isPrivate: false, avatarKey: up.json.data.key });
expect('edit profile saves bio and avatar', edit.status === 200 && edit.json.data.bio === 'hello there' && /\.png\?e=\d+&s=/.test(edit.json.data.avatarUrl), edit.json);
const badAvatar = await call('PATCH', '/users/me', aT, { avatarKey: vup.json.data.key });
expect('a video cannot be an avatar', badAvatar.status === 422, badAvatar.json);
const badSite = await call('PATCH', '/users/me', aT, { website: 'not a url' });
expect('invalid website is rejected', badSite.status === 422, badSite.json);

// Messages from non-friends go to the Requests folder (tested in privacy-smoke); these two become friends first.
await call('POST', '/friends/requests', b.token, { userId: a.id });
await call('POST', `/friends/requests/${b.id}/accept`, aT);
const chat = await call('POST', `/messages/with/${a.id}`, b.token);
const chat2 = await call('POST', `/messages/with/${a.id}`, b.token);
const chatBack = await call('POST', `/messages/with/${b.id}`, aT);
expect('opening a chat is unique per pair (both directions)', chat.status === 200 && chat.json.data.id === chat2.json.data.id && chatBack.json.data.id === chat.json.data.id, [
  chat.json,
  chatBack.json,
]);
const cid = chat.json.data.id;
const m1 = await call('POST', `/messages/${cid}`, b.token, { body: 'hello A' });
const blankMsg = await call('POST', `/messages/${cid}`, b.token, { body: '  ' });
expect('message is sent; blank is rejected', m1.status === 200 && blankMsg.status === 422, [m1.json, blankMsg.json]);
const un1 = await call('GET', '/messages/unread-count', aT);
const list1 = await call('GET', '/messages', aT);
expect(
  'recipient sees unread count and the conversation',
  un1.json.data.count === 1 && list1.json.data[0].unread === 1 && list1.json.data[0].lastMessage === 'hello A' && list1.json.data[0].peer.username === b.u.username,
  [un1.json, list1.json],
);
const th = await call('GET', `/messages/${cid}`, aT);
const un2 = await call('GET', '/messages/unread-count', aT);
expect('opening the thread returns messages and marks them read', th.json.data.messages.length === 1 && th.json.data.messages[0].mine === false && un2.json.data.count === 0, [th.json, un2.json]);
const outsider = await call('GET', `/messages/${cid}`, (await newUser('d')).token);
expect('a non-member cannot read the thread', outsider.status === 404, outsider.json);
const selfChat = await call('POST', `/messages/with/${a.id}`, aT);
expect("can't message yourself", selfChat.status === 422);

console.log(`\nAll ${passed} social checks passed.`);
process.exit(0); // open keep-alive sockets from the media fetches would otherwise hold the process
