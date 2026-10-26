import { exec, pool, q, tx } from '../../db/pool.js';
import { decryptField, emailAad, emailIndex } from '../../lib/crypto.js';
import { AppError } from '../../lib/errors.js';
import { fromBin, toBin } from '../../lib/ids.js';
import { maskPhone } from '../../lib/phone.js';
import { NOT_BLOCKED } from '../../lib/blocks.js';
import { mediaUrl, requireMedia } from '../../lib/media.js';
import { blindIndex } from '../../lib/crypto.js';
import { FRIENDS_SQL, allowedBy, privacyOf, relation } from '../../lib/permissions.js';
import { normalizePhone } from '../../lib/phone.js';
import { friendsCount, friendshipLabel } from '../friends/friends.service.js';
import { notify } from '../notifications/notifications.service.js';

/** The signed-in user's own profile. The phone is decrypted only to produce a masked version. */
export async function getProfile(userId) {
  const rows = await q(
    pool,
    `SELECT username, full_name, email_ciphertext, email_key_version, phone_ciphertext, phone_key_version, bio, website, avatar_key, is_private,
            followers_count, following_count, posts_count, email_verified_at, phone_verified_at, created_at
       FROM users WHERE id = ? AND deleted_at IS NULL`,
    [toBin(userId)],
  );
  const u = rows[0];
  if (!u) throw new AppError(404, 'not_found', 'Account not found.');
  return {
    id: userId,
    username: u.username,
    fullName: u.full_name,
    email: u.email_ciphertext ? decryptField(u.email_ciphertext, emailAad(userId), u.email_key_version) : null, // optional: none if the account signed up with a phone only
    phoneMasked: maskPhone(decryptField(u.phone_ciphertext, `users.phone:${userId}`, u.phone_key_version)),
    bio: u.bio,
    website: u.website,
    avatarUrl: mediaUrl(u.avatar_key),
    isPrivate: !!u.is_private,
    followersCount: u.followers_count,
    followingCount: u.following_count,
    postsCount: u.posts_count,
    emailVerified: !!u.email_verified_at,
    phoneVerified: !!u.phone_verified_at,
    createdAt: u.created_at.toISOString(),
  };
}

// Columns that describe how the viewer (placeholders: me, me) relates to user `u`.
const REL = `COALESCE((SELECT f.status FROM follows f WHERE f.follower_id = ? AND f.followee_id = u.id), 'none') AS rel,
  EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = u.id AND f.followee_id = ? AND f.status = 'accepted') AS follows_you`;

const toPerson = (r) => ({
  id: fromBin(r.id),
  username: r.username,
  fullName: r.full_name,
  avatarUrl: mediaUrl(r.avatar_key),
  isPrivate: !!r.is_private,
  following: r.rel,
  followsYou: !!r.follows_you,
});

/** People you don't follow yet. People who already follow you come first, so they show as "Follow back". */
export async function suggestions(me) {
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key, u.is_private, ${REL} FROM users u
      WHERE u.id <> ? AND u.status = 'active' AND u.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = u.id)
        AND ${NOT_BLOCKED('u.id')}
      ORDER BY follows_you DESC, (u.posts_count > 0) DESC, u.followers_count DESC, u.created_at DESC LIMIT 8`,
    [toBin(me), toBin(me), toBin(me), toBin(me), toBin(me), toBin(me)],
  );
  return rows.map(toPerson);
}

async function findByUsername(me, username) {
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key, u.bio, u.website, u.is_private, u.followers_count, u.following_count, u.posts_count,
            u.email_ciphertext, u.email_key_version, u.phone_ciphertext, u.phone_key_version, u.date_of_birth, ${REL},
            EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = u.id) AS i_blocked,
            EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = u.id AND b.blocked_id = ?) AS blocked_me
       FROM users u WHERE u.username = ? AND u.status = 'active' AND u.deleted_at IS NULL`,
    [toBin(me), toBin(me), toBin(me), toBin(me), username.toLowerCase()],
  );
  // Someone who blocked you looks exactly like an account that doesn't exist.
  if (!rows[0] || rows[0].blocked_me) throw new AppError(404, 'not_found', 'No account with that username.');
  return rows[0];
}

/**
 * Anyone signed in can open a profile, but each detail is shown only if its owner allows this viewer to see it:
 * email, phone, birthday, bio and website, and the friends count each have their own setting (everyone / friends / only me).
 * Name, username and photo are always shown (people need them to recognise an account).
 * A private account's posts and lists stay hidden until its owner accepts you (or you are friends).
 */
export async function publicProfile(me, username) {
  const r = await findByUsername(me, username);
  const id = fromBin(r.id);
  const rel = await relation(pool, me, id);
  const privacy = await privacyOf(pool, id);
  const show = (level) => allowedBy(level, rel);
  const isMe = rel.self;
  return {
    id,
    username: r.username,
    fullName: r.full_name,
    avatarUrl: mediaUrl(r.avatar_key),
    bio: show(privacy.show_details) ? r.bio : '',
    website: show(privacy.show_details) ? r.website : null,
    email: show(privacy.show_email) && r.email_ciphertext ? decryptField(r.email_ciphertext, emailAad(id), r.email_key_version) : null,
    phone: show(privacy.show_phone) ? decryptField(r.phone_ciphertext, `users.phone:${id}`, r.phone_key_version) : null,
    birthday: show(privacy.show_birthday) ? new Date(r.date_of_birth).toISOString().slice(0, 10) : null,
    detailsHidden: !show(privacy.show_details),
    isPrivate: !!r.is_private,
    followersCount: r.followers_count,
    followingCount: r.following_count,
    postsCount: r.posts_count,
    friendsCount: show(privacy.show_friends_list) ? await friendsCount(pool, id) : null,
    isMe,
    following: r.rel,
    followsYou: !!r.follows_you,
    friendship: isMe ? 'self' : friendshipLabel(rel),
    canFriendRequest: !isMe && !rel.blocked && privacy.who_can_friend_request !== 'nobody',
    restrictedByMe: rel.iRestricted,
    blockedByMe: !!r.i_blocked,
    canView: !r.i_blocked && (isMe || !r.is_private || r.rel === 'accepted' || rel.friends),
  };
}

export async function connections(me, username, type) {
  const p = await publicProfile(me, username);
  if (!p.canView) throw new AppError(403, 'private_account', 'This account is private.');
  const [mine, theirs] = type === 'followers' ? ['follower_id', 'followee_id'] : ['followee_id', 'follower_id'];
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key, u.is_private, ${REL}
       FROM follows x JOIN users u ON u.id = x.${mine}
      WHERE x.${theirs} = ? AND x.status = 'accepted' AND u.status = 'active' AND u.deleted_at IS NULL AND ${NOT_BLOCKED('u.id')}
      ORDER BY x.created_at DESC LIMIT 100`,
    [toBin(me), toBin(me), toBin(p.id), toBin(me), toBin(me)],
  );
  return rows.map(toPerson);
}

/** Follow (pending when the account is private) or unfollow. Counters change only when a row really changed. */
export async function setFollow(me, target, follow) {
  if (me === target) throw new AppError(422, 'self_follow', "You can't follow yourself.");
  const rows = await q(
    pool,
    `SELECT is_private,
      EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?) AS i_blocked,
      EXISTS (SELECT 1 FROM blocks WHERE blocker_id = ? AND blocked_id = ?) AS blocked_me
    FROM users WHERE id = ? AND status = 'active' AND deleted_at IS NULL`,
    [toBin(me), toBin(target), toBin(target), toBin(me), toBin(target)],
  );
  if (!rows[0] || rows[0].blocked_me) throw new AppError(404, 'not_found', 'Account not found.');
  if (follow && rows[0].i_blocked) throw new AppError(403, 'blocked', 'Unblock this account first.');
  const status = rows[0].is_private ? 'pending' : 'accepted';
  return tx(async (c) => {
    if (follow) {
      const r = await exec(c, "INSERT IGNORE INTO follows (follower_id, followee_id, status, accepted_at) VALUES (?, ?, ?, IF(? = 'accepted', NOW(3), NULL))", [
        toBin(me),
        toBin(target),
        status,
        status,
      ]);
      if (r.affectedRows) await notify(c, { recipient: target, actor: me, type: status === 'accepted' ? 'follow' : 'follow_request' });
      if (r.affectedRows && status === 'accepted') {
        await exec(c, 'UPDATE users SET following_count = following_count + 1 WHERE id = ?', [toBin(me)]);
        await exec(c, 'UPDATE users SET followers_count = followers_count + 1 WHERE id = ?', [toBin(target)]);
      }
      // Report what is really stored: a stale button must not claim "Requested" for a follow that is already accepted.
      const [row] = await q(c, 'SELECT status FROM follows WHERE follower_id = ? AND followee_id = ?', [toBin(me), toBin(target)]);
      return row?.status ?? status;
    }
    const [cur] = await q(c, 'SELECT status FROM follows WHERE follower_id = ? AND followee_id = ?', [toBin(me), toBin(target)]);
    const r = await exec(c, 'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', [toBin(me), toBin(target)]);
    if (r.affectedRows && cur?.status === 'accepted') {
      await exec(c, 'UPDATE users SET following_count = GREATEST(following_count, 1) - 1 WHERE id = ?', [toBin(me)]);
      await exec(c, 'UPDATE users SET followers_count = GREATEST(followers_count, 1) - 1 WHERE id = ?', [toBin(target)]);
    }
    return 'none';
  });
}

/** Find people by username or name. Prefix matches first. */
/** Looks like an email address, or like a phone number someone typed? Then search that exact value instead of names. */
function contactQuery(raw) {
  const text = raw.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) return { kind: 'email', hash: emailIndex(text) };
  const digits = text.replace(/\D/g, '');
  const e164 = text.startsWith('+') ? normalizePhone(text) : digits.length === 10 && /^[6-9]/.test(digits) ? normalizePhone(`+91${digits}`) : null;
  return e164 ? { kind: 'phone', hash: blindIndex(e164) } : null;
}

/**
 * Find people by name or username. A typed email address or phone number finds only the one account that has it AND whose owner
 * allows being found that way (everyone / friends / nobody; the default is nobody), so contact details cannot be probed.
 */
export async function search(me, text) {
  const contact = contactQuery(text);
  if (contact) {
    const column = contact.kind === 'email' ? 'u.email_hash' : 'u.phone_hash';
    const setting = contact.kind === 'email' ? 'find_by_email' : 'find_by_phone';
    const rows = await q(
      pool,
      `SELECT u.id, u.username, u.full_name, u.avatar_key, u.is_private, ${REL} FROM users u
         LEFT JOIN user_privacy up ON up.user_id = u.id
        WHERE ${column} = ? AND u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ? AND ${NOT_BLOCKED('u.id')}
          AND (COALESCE(up.${setting}, 'nobody') = 'everyone' OR (COALESCE(up.${setting}, 'nobody') = 'friends' AND ${FRIENDS_SQL('?', 'u.id')}))
        LIMIT 5`, // an email is one account; a mobile number may be shared by a few
      [toBin(me), toBin(me), contact.hash, toBin(me), toBin(me), toBin(me), toBin(me), toBin(me)],
    );
    return rows.map(toPerson);
  }
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[%_\\]/g, '');
  if (t.length < 1) return [];
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key, u.is_private, ${REL} FROM users u
      WHERE u.status = 'active' AND u.deleted_at IS NULL AND u.id <> ? AND ${NOT_BLOCKED('u.id')}
        AND (u.username LIKE ? OR u.full_name LIKE ?)
      ORDER BY (u.username LIKE ?) DESC, u.followers_count DESC LIMIT 20`,
    [toBin(me), toBin(me), toBin(me), toBin(me), toBin(me), `%${t}%`, `%${t}%`, `${t}%`],
  );
  return rows.map(toPerson);
}

export async function updateProfile(me, edit) {
  if (edit.avatarKey) await requireMedia(edit.avatarKey, 'image');
  const sets = [];
  const args = [];
  const add = (col, v) => {
    sets.push(`${col} = ?`);
    args.push(v);
  };
  if (edit.fullName !== undefined) add('full_name', edit.fullName);
  if (edit.bio !== undefined) add('bio', edit.bio);
  if (edit.website !== undefined) add('website', edit.website);
  if (edit.isPrivate !== undefined) add('is_private', edit.isPrivate);
  if (edit.avatarKey !== undefined) add('avatar_key', edit.avatarKey);
  if (sets.length) await exec(pool, `UPDATE users SET ${sets.join(', ')} WHERE id = ?`, [...args, toBin(me)]);
  // Going public means nobody needs approval any more, so waiting requests are accepted.
  if (edit.isPrivate === false)
    await tx(async (c) => {
      await acceptRequests(c, me);
    });
  return getProfile(me);
}

// ---------------------------------------------------------------- follow requests (private accounts)

/** Accepts the given pending requests (or all of them) for `me`, moving both counters in step. */
async function acceptRequests(c, me, only) {
  const pending = await q(
    c,
    `SELECT follower_id FROM follows WHERE followee_id = ? AND status = 'pending' ${only ? 'AND follower_id = ?' : ''} FOR UPDATE`,
    only ? [toBin(me), toBin(only)] : [toBin(me)],
  );
  for (const p of pending) {
    const r = await exec(c, "UPDATE follows SET status = 'accepted', accepted_at = NOW(3) WHERE follower_id = ? AND followee_id = ? AND status = 'pending'", [p.follower_id, toBin(me)]);
    if (!r.affectedRows) continue;
    await exec(c, 'UPDATE users SET following_count = following_count + 1 WHERE id = ?', [p.follower_id]);
    await exec(c, 'UPDATE users SET followers_count = followers_count + 1 WHERE id = ?', [toBin(me)]);
    await notify(c, { recipient: fromBin(p.follower_id), actor: me, type: 'follow_accepted' });
  }
  return pending.length;
}

export async function incomingRequests(me) {
  const rows = await q(
    pool,
    `SELECT u.id, u.username, u.full_name, u.avatar_key, u.is_private, ${REL}
       FROM follows x JOIN users u ON u.id = x.follower_id
      WHERE x.followee_id = ? AND x.status = 'pending' AND u.status = 'active' AND u.deleted_at IS NULL AND ${NOT_BLOCKED('u.id')}
      ORDER BY x.created_at DESC LIMIT 100`,
    [toBin(me), toBin(me), toBin(me), toBin(me), toBin(me)],
  );
  return rows.map(toPerson);
}

/** Accept or decline one person's request to follow me. */
export async function respondToRequest(me, followerId, accept) {
  return tx(async (c) => {
    if (accept) {
      const n = await acceptRequests(c, me, followerId);
      if (!n) throw new AppError(404, 'not_found', 'That request is no longer pending.');
      return { status: 'accepted' };
    }
    const r = await exec(c, "DELETE FROM follows WHERE follower_id = ? AND followee_id = ? AND status = 'pending'", [toBin(followerId), toBin(me)]);
    if (!r.affectedRows) throw new AppError(404, 'not_found', 'That request is no longer pending.');
    return { status: 'declined' };
  });
}
