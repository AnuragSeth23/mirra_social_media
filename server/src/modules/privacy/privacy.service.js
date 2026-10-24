/*
 * The Privacy & Security settings in one place. The values live in three existing homes, but the screen reads and
 * writes them through this one service:
 *   users.is_private                      public or private account
 *   user_privacy                          profile fields, search, friend requests, default audience, tags, mentions
 *   user_settings                         who may message me, read receipts, activity status
 * Only the signed-in user's own row is ever read or written (the id comes from the verified session, never from the request).
 */
import { exec, pool, q } from '../../db/pool.js';
import { toBin } from '../../lib/ids.js';
import { PRIVACY_DEFAULTS } from '../../lib/permissions.js';
import { updateProfile } from '../users/users.service.js';

const SHOW = ['everyone', 'friends', 'only_me'];
const FIND = ['everyone', 'friends', 'nobody'];

// request key -> where it is stored and which values are allowed (anything else is refused by the route's schema)
export const FIELDS = {
  showEmail: { table: 'user_privacy', column: 'show_email', values: SHOW },
  showPhone: { table: 'user_privacy', column: 'show_phone', values: SHOW },
  showBirthday: { table: 'user_privacy', column: 'show_birthday', values: SHOW },
  showDetails: { table: 'user_privacy', column: 'show_details', values: SHOW },
  showFriendsList: { table: 'user_privacy', column: 'show_friends_list', values: SHOW },
  findByEmail: { table: 'user_privacy', column: 'find_by_email', values: FIND },
  findByPhone: { table: 'user_privacy', column: 'find_by_phone', values: FIND },
  whoCanFriendRequest: { table: 'user_privacy', column: 'who_can_friend_request', values: ['everyone', 'friends_of_friends', 'nobody'] },
  defaultPostAudience: { table: 'user_privacy', column: 'default_post_audience', values: ['public', 'friends', 'only_me'] },
  whoCanTag: { table: 'user_privacy', column: 'who_can_tag', values: FIND },
  whoCanMention: { table: 'user_privacy', column: 'who_can_mention', values: FIND },
  reviewTags: { table: 'user_privacy', column: 'review_tags', bool: true },
  messagesFrom: { table: 'user_settings', column: 'messages_from', values: ['everyone', 'following', 'friends', 'nobody'] },
  readReceipts: { table: 'user_settings', column: 'read_receipts', bool: true },
  showActivityStatus: { table: 'user_settings', column: 'show_activity_status', bool: true },
};

export async function getPrivacy(me) {
  await exec(pool, 'INSERT IGNORE INTO user_privacy (user_id) VALUES (?)', [toBin(me)]);
  await exec(pool, 'INSERT IGNORE INTO user_settings (user_id) VALUES (?)', [toBin(me)]);
  const [row] = await q(
    pool,
    `SELECT u.is_private, up.*, us.messages_from, us.read_receipts, us.show_activity_status
       FROM users u JOIN user_privacy up ON up.user_id = u.id JOIN user_settings us ON us.user_id = u.id WHERE u.id = ?`,
    [toBin(me)],
  );
  const out = { isPrivate: !!row.is_private };
  for (const [key, f] of Object.entries(FIELDS)) out[key] = f.bool ? !!row[f.column] : row[f.column] ?? PRIVACY_DEFAULTS[f.column];
  return out;
}

export async function updatePrivacy(me, patch) {
  await exec(pool, 'INSERT IGNORE INTO user_privacy (user_id) VALUES (?)', [toBin(me)]);
  await exec(pool, 'INSERT IGNORE INTO user_settings (user_id) VALUES (?)', [toBin(me)]);
  if (patch.isPrivate !== undefined) await updateProfile(me, { isPrivate: patch.isPrivate }); // going public also accepts waiting follow requests
  for (const table of ['user_privacy', 'user_settings']) {
    const sets = [];
    const args = [];
    for (const [key, f] of Object.entries(FIELDS)) {
      if (f.table !== table || patch[key] === undefined) continue;
      sets.push(`${f.column} = ?`);
      args.push(f.bool ? (patch[key] ? 1 : 0) : patch[key]);
    }
    if (sets.length) await exec(pool, `UPDATE ${table} SET ${sets.join(', ')} WHERE user_id = ?`, [...args, toBin(me)]);
  }
  return getPrivacy(me);
}
