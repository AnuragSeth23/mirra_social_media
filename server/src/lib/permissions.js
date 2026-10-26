/*
 * The one place that decides "who may see or do what". Routes and services call these helpers instead of
 * writing their own rules, so a rule fixed here is fixed everywhere (feed, profile, direct links, search, tag pages, notifications).
 *
 * People relate to each other in a few ways:
 *   self      : it is me
 *   friends   : an accepted friendship (both agreed)
 *   follower  : I follow them and they accepted (private accounts) or it is a public account
 *   blocked   : either of us blocked the other: we cannot see or contact each other at all
 *   restricted: they restricted me (quiet limits, see docs/PRIVACY.md)
 */
import { q } from '../db/pool.js';
import { NOT_BLOCKED } from './blocks.js';
import { toBin } from './ids.js';

/** The same pair of people always gets the same key, whoever asked whom. */
export const pairKey = (a, b) => [toBin(a), toBin(b)].sort().join('_'); // "<smaller id>_<larger id>", readable

/** SQL: true when a and b are accepted friends. `a` and `b` are SQL expressions; four placeholders are NOT used, the expressions are inlined. */
export const FRIENDS_SQL = (a, b) => `EXISTS (SELECT 1 FROM friendships fr WHERE fr.status = 'accepted'
    AND ((fr.requester_id = ${a} AND fr.addressee_id = ${b}) OR (fr.requester_id = ${b} AND fr.addressee_id = ${a})))`;

/**
 * SQL for "this viewer may see this post". Aliases: `p` = posts row, `u` = its author's users row.
 *
 * A post is visible when it is live, its author is active, nobody blocked anybody, and then:
 *   - it is my own post, or
 *   - its audience is public and the account is public (or I am an accepted follower of a private account), or
 *   - its audience is public or friends and I am an accepted friend of the author.
 * "Only me" matches none of the branches except my own post, so nobody else can ever see it.
 * Placeholders, in order: me, me (blocks) · me (own) · me (follow) · me, me (friend) = 6.
 */
export const postVisibleSql = (p = 'p', u = 'u') => `${p}.deleted_at IS NULL AND ${u}.deleted_at IS NULL AND ${u}.status = 'active'
  AND ${NOT_BLOCKED(`${p}.author_id`)}
  AND (${p}.author_id = ?
       OR (${p}.audience = 'public' AND (${u}.is_private = 0
            OR EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = ${p}.author_id AND f.status = 'accepted')))
       OR (${p}.audience IN ('public', 'friends') AND EXISTS (SELECT 1 FROM friendships fr WHERE fr.status = 'accepted'
            AND ((fr.requester_id = ? AND fr.addressee_id = ${p}.author_id) OR (fr.requester_id = ${p}.author_id AND fr.addressee_id = ?)))))`;
export const POST_VIS_N = 6;
export const postVisParams = (me) => Array.from({ length: POST_VIS_N }, () => toBin(me));

/** How `me` stands with `other`, in one query. Used for profile pages, friend requests, messaging and tagging. */
export async function relation(db, me, other) {
  const [r] = await q(
    db,
    `SELECT
       EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = ?) AS i_blocked,
       EXISTS (SELECT 1 FROM blocks b WHERE b.blocker_id = ? AND b.blocked_id = ?) AS blocked_me,
       EXISTS (SELECT 1 FROM restrictions r WHERE r.restrictor_id = ? AND r.restricted_id = ?) AS i_restricted,
       EXISTS (SELECT 1 FROM restrictions r WHERE r.restrictor_id = ? AND r.restricted_id = ?) AS restricted_me,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = ? AND f.status = 'accepted') AS i_follow,
       EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = ? AND f.followee_id = ? AND f.status = 'accepted') AS follows_me,
       (SELECT fr.status FROM friendships fr WHERE fr.pair_key = ?) AS friend_status,
       (SELECT fr.requester_id = ? FROM friendships fr WHERE fr.pair_key = ?) AS i_requested`,
    [
      toBin(me), toBin(other), toBin(other), toBin(me), toBin(me), toBin(other), toBin(other), toBin(me),
      toBin(me), toBin(other), toBin(other), toBin(me), pairKey(me, other), toBin(me), pairKey(me, other),
    ],
  );
  return {
    self: me === other,
    iBlocked: !!r.i_blocked,
    blockedMe: !!r.blocked_me,
    blocked: !!r.i_blocked || !!r.blocked_me,
    iRestricted: !!r.i_restricted,
    restrictedMe: !!r.restricted_me,
    iFollow: !!r.i_follow,
    followsMe: !!r.follows_me,
    friends: r.friend_status === 'accepted',
    friendStatus: r.friend_status ?? null,
    iRequested: r.i_requested === null ? null : !!r.i_requested,
  };
}

export const areFriends = async (db, a, b) => (await relation(db, a, b)).friends;

/**
 * May a viewer see something the owner shares with 'everyone' | 'friends' | 'only_me'?
 * (The owner always can; blocked people never can.)
 */
export function allowedBy(level, rel) {
  if (rel.self) return true;
  if (rel.blocked) return false;
  if (level === 'everyone') return true;
  if (level === 'friends') return rel.friends;
  return false;
}

/** Same idea for settings phrased as who may DO something: 'everyone' | 'friends' | 'nobody'. */
export function mayDo(level, rel) {
  if (rel.self || rel.blocked) return false;
  if (level === 'everyone') return true;
  if (level === 'friends') return rel.friends;
  return false;
}

export const PRIVACY_DEFAULTS = Object.freeze({
  show_email: 'only_me', show_phone: 'only_me', show_birthday: 'only_me', show_details: 'everyone', show_friends_list: 'everyone',
  find_by_email: 'nobody', find_by_phone: 'nobody', who_can_friend_request: 'everyone', default_post_audience: 'public',
  who_can_tag: 'everyone', who_can_mention: 'everyone', review_tags: 0,
});

/** A user's privacy row, with defaults filled in when they never changed anything. */
export async function privacyOf(db, userId) {
  const [row] = await q(db, 'SELECT * FROM user_privacy WHERE user_id = ?', [toBin(userId)]);
  return { ...PRIVACY_DEFAULTS, ...(row ?? {}) };
}
