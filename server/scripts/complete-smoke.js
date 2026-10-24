/*
 * API checks for the second wave of features and the security fixes: blocking, reports, comment replies,
 * hashtags, editing posts, follow requests for private accounts, settings, change password, deactivate,
 * website-link validation and the sign-up ticket rules.
 * Usage: npm run smoke:complete   (API must be running; one-time codes come from verification_codes.dev_code)
 */
import mysql from 'mysql2/promise';
import { config } from '../src/config/env.js';

const API = process.env.API_URL ?? 'http://localhost:4000/api/v1';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = await mysql.createConnection(config.DATABASE_URL);
const code = async (channel, who) =>
  (
    await db.query(
      `SELECT vc.dev_code FROM verification_codes vc JOIN users u ON u.id = vc.user_id
      WHERE (u.email = ? OR u.username = ?) AND vc.channel = ? ORDER BY vc.id DESC LIMIT 1`,
      [who, who, channel],
    )
  )[0][0].dev_code;

async function call(method, path, token, body) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-SocialAmbak-Client': 'web', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, json: res.status === 204 ? null : await res.json().catch(() => null) };
}

let n = 0;
async function newUser(tag) {
  const id = `${Date.now().toString(36).slice(-5)}${tag}${n++}`;
  const u = {
    fullName: `Test ${tag}`,
    username: `c${id}`,
    email: `c${id}@example.com`,
    phone: `+1415${2 + Math.floor(Math.random() * 8)}${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
    password: 'tidepool42',
    dateOfBirth: '1998-04-12',
  };
  const s = await call('POST', '/auth/signup', undefined, u);
  if (s.status !== 201) throw new Error('signup failed ' + JSON.stringify(s.json));
  const ticket = s.json.data.ticket;
  await sleep(150);
  await call('POST', '/auth/verify', undefined, { ticket, channel: 'email', code: await code('email', u.email) });
  const v = await call('POST', '/auth/verify', undefined, { ticket, channel: 'phone', code: await code('phone', u.username) });
  return { id: v.json.data.user.id, token: v.json.data.accessToken, u, ticket };
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
const c = await newUser('c');

// ---------- sign-up rules
const badDob = await call('POST', '/auth/signup', undefined, { ...a.u, username: `x${a.u.username}`, email: `x${a.u.email}`, phone: '+14155559999', dateOfBirth: '2020-02-31' });
expect('an impossible birth date (31 Feb) is a validation error, not a crash', badDob.status === 422, badDob.json);
const reuse = await call('POST', '/auth/verify', undefined, { ticket: a.ticket, channel: 'email', code: '123456' });
expect('a finished sign-up ticket cannot be used to get a session', reuse.status === 409 && !reuse.json?.data?.accessToken, reuse.json);

// ---------- profile website must be a web link
for (const bad of ['javascript:alert(1)', 'data:text/html,<script>1</script>', 'ftp://example.com', 'not a link']) {
  const r = await call('PATCH', '/users/me', a.token, { website: bad });
  expect(`website "${bad.slice(0, 22)}" is rejected`, r.status === 422, r.json);
}
const okSite = await call('PATCH', '/users/me', a.token, { website: 'https://example.com/me' });
expect('an https link is accepted', okSite.status === 200 && okSite.json.data.website === 'https://example.com/me', okSite.json);
const clearSite = await call('PATCH', '/users/me', a.token, { website: '' });
expect('an empty website clears it', clearSite.status === 200 && clearSite.json.data.website === null, clearSite.json);

// ---------- hashtags, edit post
const p1 = await call('POST', '/posts', a.token, { caption: 'Sunset at the lake #Sunset #lake #sunset and an email a@b.com' });
const tagA = `lake`;
expect('hashtags are found in a caption (case-insensitive, unique)', p1.status === 200, p1.json);
const tagList = await call('GET', `/posts/tag/${tagA}`, b.token);
expect(
  'the tag page lists the post',
  tagList.json.data.posts.some((p) => p.id === p1.json.data.id),
  tagList.json,
);
const tagSearch = await call('GET', '/posts/tags?q=sun', b.token);
const sun = tagSearch.json.data.find((t) => t.tag === 'sunset');
expect('tag search returns the tag with its count', !!sun && sun.postCount >= 1, tagSearch.json);
const edited = await call('PATCH', `/posts/${p1.json.data.id}`, a.token, { caption: 'Now about #mountains only' });
const oldTag = await call('GET', '/posts/tag/lake', b.token);
const newTag = await call('GET', '/posts/tag/mountains', b.token);
expect(
  'editing a caption moves the post between tags',
  edited.status === 200 && !oldTag.json.data.posts.some((p) => p.id === p1.json.data.id) && newTag.json.data.posts.some((p) => p.id === p1.json.data.id),
  [oldTag.json, newTag.json],
);
const notOwner = await call('PATCH', `/posts/${p1.json.data.id}`, b.token, { caption: 'hijack' });
expect("someone else can't edit your post", notOwner.status === 404, notOwner.json);
const emptyEdit = await call('PATCH', `/posts/${p1.json.data.id}`, a.token, { caption: '' });
expect('a text-only post cannot be edited to nothing', emptyEdit.status === 422, emptyEdit.json);
await call('DELETE', `/posts/${p1.json.data.id}`, a.token);
const goneTag = await call('GET', '/posts/tag/mountains', b.token);
expect('deleting a post removes it from the tag page', !goneTag.json.data.posts.some((p) => p.id === p1.json.data.id), goneTag.json);

// ---------- comment replies
const post = await call('POST', '/posts', a.token, { caption: 'reply test' });
const pid = post.json.data.id;
const top = await call('POST', `/posts/${pid}/comments`, b.token, { body: 'top level' });
const reply = await call('POST', `/posts/${pid}/comments`, c.token, { body: 'a reply', parentId: top.json.data.id });
expect('a reply is created under its parent', reply.status === 200 && reply.json.data.parentId === top.json.data.id, reply.json);
const nested = await call('POST', `/posts/${pid}/comments`, a.token, { body: 'reply to a reply', parentId: reply.json.data.id });
expect('replies cannot be nested a second level', nested.status === 422, nested.json);
const tree = await call('GET', `/posts/${pid}/comments`, a.token);
expect('comments come back as a tree', tree.json.data.length === 1 && tree.json.data[0].replies.length === 1 && tree.json.data[0].replies[0].body === 'a reply', tree.json);
const cnt = await call('GET', `/posts/${pid}`, a.token);
expect('comment_count counts replies too (2)', cnt.json.data.commentCount === 2, cnt.json);
const bNotes = await call('GET', '/notifications', b.token);
expect(
  'the parent comment author is told about the reply',
  bNotes.json.data.some((x) => x.type === 'comment_reply' && x.actor.username === c.u.username),
  bNotes.json,
);
const delByC = await call('DELETE', `/posts/${pid}/comments/${top.json.data.id}`, c.token);
expect("a stranger can't delete someone else's comment", delByC.status === 404, delByC.json);
const delTop = await call('DELETE', `/posts/${pid}/comments/${top.json.data.id}`, b.token);
const cnt2 = await call('GET', `/posts/${pid}`, a.token);
const tree2 = await call('GET', `/posts/${pid}/comments`, a.token);
expect('deleting a comment also removes its replies and fixes the count', delTop.status === 204 && cnt2.json.data.commentCount === 0 && tree2.json.data.length === 0, [cnt2.json, tree2.json]);

// ---------- reports
const rep = await call('POST', '/safety/report', c.token, { targetType: 'post', targetId: pid, reason: 'spam', details: 'looks like spam' });
const rep2 = await call('POST', '/safety/report', c.token, { targetType: 'post', targetId: pid, reason: 'spam' });
const [{ n: reports }] = (await db.query("SELECT COUNT(*) AS n FROM reports WHERE target_type='post' AND target_id = UNHEX(REPLACE(?, '-', ''))", [pid]))[0];
expect('a report is stored once even if sent twice', rep.status === 200 && rep2.status === 200 && Number(reports) === 1, reports);
const selfRep = await call('POST', '/safety/report', a.token, { targetType: 'post', targetId: pid, reason: 'spam' });
expect("you can't report your own post", selfRep.status === 422, selfRep.json);
const badReason = await call('POST', '/safety/report', c.token, { targetType: 'post', targetId: pid, reason: 'because' });
expect('an unknown report reason is rejected', badReason.status === 422, badReason.json);

// ---------- blocking
await call('PUT', `/users/${a.id}/follow`, b.token);
await call('PUT', `/users/${b.id}/follow`, a.token);
const blk = await call('PUT', `/safety/block/${b.id}`, a.token);
const meA = await call('GET', '/users/me', a.token);
expect('blocking removes follows both ways and fixes the counters', blk.status === 200 && meA.json.data.followersCount === 0 && meA.json.data.followingCount === 0, meA.json);
const viewBlocked = await call('GET', `/users/by/${a.u.username}`, b.token);
expect('a blocked user sees the blocker as "not found"', viewBlocked.status === 404, viewBlocked.json);
const viewBlocker = await call('GET', `/users/by/${b.u.username}`, a.token);
expect(
  'the blocker still sees the profile, marked as blocked, with no posts access',
  viewBlocker.status === 200 && viewBlocker.json.data.blockedByMe === true && viewBlocker.json.data.canView === false,
  viewBlocker.json,
);
const sB = await call('GET', `/users/search?q=${encodeURIComponent(a.u.username)}`, b.token);
const sA = await call('GET', `/users/search?q=${encodeURIComponent(b.u.username)}`, a.token);
expect('blocked people do not appear in each other’s search', !sB.json.data.some((p) => p.id === a.id) && !sA.json.data.some((p) => p.id === b.id), [sB.json, sA.json]);
const sugB = await call('GET', '/users/suggestions', b.token);
expect('they are hidden from suggestions too', !sugB.json.data.some((p) => p.id === a.id), sugB.json);
const postSeen = await call('GET', `/posts/${pid}`, b.token);
expect("a blocked user can't open the blocker's posts", postSeen.status === 404, postSeen.json);
const likeBlocked = await call('PUT', `/posts/${pid}/like`, b.token);
expect('...or like them', likeBlocked.status === 404, likeBlocked.json);
const followBlocked = await call('PUT', `/users/${a.id}/follow`, b.token);
expect('...or follow', followBlocked.status === 404, followBlocked.json);
const followBlocker = await call('PUT', `/users/${b.id}/follow`, a.token);
expect('the blocker has to unblock before following', followBlocker.status === 403, followBlocker.json);
const dmBlocked = await call('POST', `/messages/with/${a.id}`, b.token);
const dmBlocker = await call('POST', `/messages/with/${b.id}`, a.token);
expect('neither side can start a chat', dmBlocked.status === 403 && dmBlocker.status === 403, [dmBlocked.json, dmBlocker.json]);
const list = await call('GET', '/safety/blocked', a.token);
expect('the blocked list shows who you blocked', list.json.data.length === 1 && list.json.data[0].id === b.id, list.json);
const unb = await call('DELETE', `/safety/block/${b.id}`, a.token);
const back = await call('GET', `/users/by/${a.u.username}`, b.token);
expect('unblocking restores visibility (but not the old follows)', unb.status === 200 && back.status === 200 && back.json.data.following === 'none', back.json);
const selfBlock = await call('PUT', `/safety/block/${a.id}`, a.token);
expect("you can't block yourself", selfBlock.status === 422);

// ---------- follow requests (private account)
const priv = await newUser('p');
await call('PATCH', '/users/me', priv.token, { isPrivate: true });
const ask = await call('PUT', `/users/${priv.id}/follow`, b.token);
const ask2 = await call('PUT', `/users/${priv.id}/follow`, b.token);
expect('following a private account sends a request (and repeating shows the real state)', ask.json.data.following === 'pending' && ask2.json.data.following === 'pending', [ask.json, ask2.json]);
const reqList = await call('GET', '/users/requests', priv.token);
expect('the owner sees the pending request', reqList.json.data.length === 1 && reqList.json.data[0].id === b.id, reqList.json);
const privPostsBefore = await call('GET', `/posts/by/${priv.u.username}`, b.token);
await call('POST', '/posts', priv.token, { caption: 'private words' });
const hidden = await call('GET', `/posts/by/${priv.u.username}`, b.token);
expect('a pending requester cannot see private posts', hidden.json.data.posts.length === 0, [privPostsBefore.json, hidden.json]);
const stranger = await call('PUT', `/users/requests/${c.id}`, priv.token);
expect('accepting a request that does not exist is a 404', stranger.status === 404, stranger.json);
const accept = await call('PUT', `/users/requests/${b.id}`, priv.token);
const meP = await call('GET', '/users/me', priv.token);
const meB = await call('GET', '/users/me', b.token);
const visible = await call('GET', `/posts/by/${priv.u.username}`, b.token);
expect(
  'accepting works: counters move, the follower can now see the posts',
  accept.status === 200 && meP.json.data.followersCount === 1 && meB.json.data.followingCount >= 1 && visible.json.data.posts.length === 1,
  [meP.json, visible.json],
);
const acceptedNote = await call('GET', '/notifications', b.token);
expect(
  'the requester is told it was accepted',
  acceptedNote.json.data.some((x) => x.type === 'follow_accepted'),
  acceptedNote.json,
);
await call('PUT', `/users/${priv.id}/follow`, c.token);
const decline = await call('DELETE', `/users/requests/${c.id}`, priv.token);
const afterDecline = await call('GET', `/users/by/${priv.u.username}`, c.token);
expect('declining removes the request', decline.status === 200 && afterDecline.json.data.following === 'none', afterDecline.json);
await call('PUT', `/users/${priv.id}/follow`, c.token);
await call('PATCH', '/users/me', priv.token, { isPrivate: false });
const afterPublic = await call('GET', `/users/by/${priv.u.username}`, c.token);
const meP2 = await call('GET', '/users/me', priv.token);
expect('going public accepts waiting requests', afterPublic.json.data.following === 'accepted' && meP2.json.data.followersCount === 2, [afterPublic.json, meP2.json]);

// ---------- settings
const set0 = await call('GET', '/account/settings', c.token);
expect('settings start with sensible defaults', set0.json.data.messagesFrom === 'everyone' && set0.json.data.notifyLikes === true, set0.json);
const set1 = await call('PATCH', '/account/settings', c.token, { notifyLikes: false, messagesFrom: 'following' });
expect('settings can be changed', set1.json.data.notifyLikes === false && set1.json.data.messagesFrom === 'following', set1.json);
const badSet = await call('PATCH', '/account/settings', c.token, { messagesFrom: 'martians' });
expect('an invalid setting value is rejected', badSet.status === 422, badSet.json);
const cPost = await call('POST', '/posts', c.token, { caption: 'likes are off' });
await call('PUT', `/posts/${cPost.json.data.id}/like`, b.token);
const cNotes = await call('GET', '/notifications', c.token);
expect('with "likes" notifications off, a like creates none', !cNotes.json.data.some((x) => x.type === 'post_like'), cNotes.json);
const dmNotFollowed = await call('POST', `/messages/with/${c.id}`, a.token);
expect('"messages from people I follow" blocks a stranger from starting a chat', dmNotFollowed.status === 403, dmNotFollowed.json);

// ---------- change password and deactivate
const wrongCur = await call('POST', '/account/change-password', c.token, { current: 'not-the-password1', password: 'brandnew77' });
expect('change password needs the right current password', wrongCur.status === 403, wrongCur.json);
const weak = await call('POST', '/account/change-password', c.token, { current: c.u.password, password: 'short' });
expect('and a valid new password', weak.status === 422, weak.json);
const login2 = await call('POST', '/auth/login', undefined, { identifier: c.u.username, password: c.u.password });
const other = login2.json.data.accessToken;
const chg = await call('POST', '/account/change-password', c.token, { current: c.u.password, password: 'brandnew77' });
const stillMe = await call('GET', '/users/me', c.token);
const otherDevice = await call('GET', '/users/me', other);
expect('password changes; this device stays signed in, other devices are signed out', chg.status === 200 && stillMe.status === 200 && otherDevice.status === 401, [
  chg.json,
  stillMe.status,
  otherDevice.status,
]);
const newLogin = await call('POST', '/auth/login', undefined, { identifier: c.u.username, password: 'brandnew77' });
expect('the new password works', newLogin.status === 200);
const wrongDeact = await call('POST', '/account/deactivate', c.token, { password: 'nope-nope-1' });
expect('deactivating needs the password', wrongDeact.status === 403);
const deact = await call('POST', '/account/deactivate', c.token, { password: 'brandnew77' });
const gone = await call('GET', `/users/by/${c.u.username}`, a.token);
const deadToken = await call('GET', '/users/me', c.token);
expect('a deactivated account disappears and is signed out', deact.status === 200 && gone.status === 404 && deadToken.status === 401, [deact.json, gone.status, deadToken.status]);
const back2 = await call('POST', '/auth/login', undefined, { identifier: c.u.username, password: 'brandnew77' });
const visibleAgain = await call('GET', `/users/by/${c.u.username}`, a.token);
expect('signing in again reactivates it', back2.status === 200 && visibleAgain.status === 200, [back2.json, visibleAgain.status]);

// ---------- password reset must not reveal account details before the code is right
const oracleReal = await call('POST', '/auth/reset', undefined, { identifier: a.u.email, code: '000000', password: `${a.u.username}99` });
const oracleFake = await call('POST', '/auth/reset', undefined, { identifier: 'nobody.here@example.com', code: '000000', password: 'whatever99' });
expect('reset with a wrong code answers the same for real and unknown accounts', oracleReal.status === 400 && oracleFake.status === 400 && oracleReal.json.error.code === oracleFake.json.error.code, [
  oracleReal.json,
  oracleFake.json,
]);

// ---------- "Suggested for you": public posts for people with nobody to follow
const fresh = await newUser('n');
const pubU = await newUser('pu');
const privU = await newUser('pv');
const blockedU = await newUser('bk');
await call('PATCH', '/users/me', privU.token, { isPrivate: true });
const pubPost = await call('POST', '/posts', pubU.token, { caption: 'a public post for newcomers' });
const secretPost = await call('POST', '/posts', privU.token, { caption: 'a private post, never suggested' });
const blockedPost = await call('POST', '/posts', blockedU.token, { caption: 'from someone the newcomer blocks' });
const ownPost = await call('POST', '/posts', fresh.token, { caption: 'my own post' });
await call('PUT', `/safety/block/${blockedU.id}`, fresh.token);
const feed0 = await call('GET', '/posts/feed', fresh.token);
expect('a new user with nobody to follow has only their own posts in the main feed', feed0.json.data.posts.length === 1 && feed0.json.data.posts[0].id === ownPost.json.data.id, feed0.json);
const disc = await call('GET', '/posts/discover', fresh.token);
const ids = disc.json.data.posts.map((p) => p.id);
expect('discover shows public posts from strangers', ids.includes(pubPost.json.data.id), disc.json);
expect(
  'discover never shows private accounts, blocked people or my own posts',
  !ids.includes(secretPost.json.data.id) && !ids.includes(blockedPost.json.data.id) && !ids.includes(ownPost.json.data.id),
  ids,
);
expect('the blocked person cannot see the newcomer in discover either', !(await call('GET', '/posts/discover', blockedU.token)).json.data.posts.some((p) => p.id === ownPost.json.data.id));
await call('PUT', `/users/${pubU.id}/follow`, fresh.token);
const feed1 = await call('GET', '/posts/feed', fresh.token);
const disc1 = await call('GET', '/posts/discover', fresh.token);
expect(
  'once followed, the post moves to the main feed and leaves discover',
  feed1.json.data.posts.some((p) => p.id === pubPost.json.data.id) && !disc1.json.data.posts.some((p) => p.id === pubPost.json.data.id),
  [feed1.json, disc1.json],
);
for (let i = 0; i < 12; i++) await call('POST', '/posts', pubU.token, { caption: `bulk public ${i}` });
const nobody = await newUser('z');
const page1 = await call('GET', '/posts/discover', nobody.token);
const page2 = await call('GET', `/posts/discover?before=${page1.json.data.nextCursor}`, nobody.token);
const every = [...page1.json.data.posts, ...page2.json.data.posts].map((p) => p.id);
expect(
  'discover pages with a cursor and never repeats a post',
  page1.json.data.posts.length === 10 && !!page1.json.data.nextCursor && page2.json.data.posts.length >= 3 && new Set(every).size === every.length,
  [page1.json.data.posts.length, page2.json.data.posts.length],
);
const unauth = await call('GET', '/posts/discover');
expect('discover needs sign-in', unauth.status === 401);

// ---------- mobile numbers: at most 10 digits, India must be a real 10-digit mobile number
const base = { fullName: 'Phone Rules', password: 'tidepool42', dateOfBirth: '1998-04-12' };
const stamp = Date.now().toString(36).slice(-6);
const inValid = await call('POST', '/auth/signup', undefined, { ...base, username: `in${stamp}`, email: `in${stamp}@example.com`, phone: `+9198${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` });
expect('an Indian number with 10 digits is accepted', inValid.status === 201, inValid.json);
const tooLong = await call('POST', '/auth/signup', undefined, { ...base, username: `tl${stamp}`, email: `tl${stamp}@example.com`, phone: '+4915112345678' });
expect('a number with more than 10 digits is rejected (even if valid in its country)', tooLong.status === 422 && tooLong.json.error.details.some((d) => d.field === 'phone' && /at most 10 digits/.test(d.message)), tooLong.json);
const badIndia = await call('POST', '/auth/signup', undefined, { ...base, username: `bi${stamp}`, email: `bi${stamp}@example.com`, phone: '+911234567890' });
expect('an Indian number that does not start with 6-9 is rejected', badIndia.status === 422 && badIndia.json.error.details.some((d) => d.field === 'phone'), badIndia.json);

// ---------- trending hashtags (search page, nothing typed)
const tagHider = await newUser('tg');
await call('PATCH', '/users/me', tagHider.token, { isPrivate: true });
const secretTag = `secret${stamp}`;
await call('POST', '/posts', tagHider.token, { caption: `quiet #${secretTag}` });
const publicTag = `open${stamp}`;
await call('POST', '/posts', a.token, { caption: `loud #${publicTag}` });
await call('POST', '/posts', a.token, { caption: `louder #${publicTag}` });
const trending = await call('GET', '/posts/tags?q=', b.token);
const names = trending.json.data.map((t) => t.tag);
expect('trending returns at most 10 tags with counts', trending.status === 200 && trending.json.data.length <= 10 && trending.json.data.every((t) => t.tag && t.postCount >= 1), trending.json);
expect('trending never counts private accounts', !names.includes(secretTag), names);

await db.end();
console.log(`\nAll ${passed} extended checks passed.`);
process.exit(0);
