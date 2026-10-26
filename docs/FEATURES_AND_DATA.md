# SocialAmbak: features and where everything is stored

This file is generated from the real code and database (92 API endpoints, 33 tables). The rules behind it:

- **IDs are never encrypted.** They are readable UUID text (`CHAR(36)`), so you can search them in any database client.
- **Phone, email, passwords, one-time codes and tokens are never stored in plain text** (details in section 3).
- Everything else (names, usernames, bio, captions, comments, **chat messages**) is stored as normal readable text.

## 1. Features

**Account**
- Sign up with name, username, mobile number (up to 5 accounts may share one number), password and birth date. **The email is optional**: it is needed only if you choose to get the code by email; an email, when given, belongs to one account.
- **One verification code**, sent to the email **or** the phone, whichever you choose (like Instagram / Facebook).
- Sign in with username, email or mobile number (on a shared number the password picks the account). The last username is suggested on the sign-in page; the browser does not pre-fill it.
- Forgot password and forgot username in one flow: code to the phone (or the email, if the account has one), then every account that uses it is listed; sign in as one or reset its password.
- Two-factor sign-in (authenticator app + backup codes), change password, active sessions list, sign out one / other / all devices, deactivate the account.
- Privacy settings (who sees email, phone, birthday, details, friends; who can find, tag, mention, message or send a friend request), private account, notification and theme settings.

**People**
- Profile with avatar, bio, website; followers and following counts; follow / unfollow; private accounts with follow requests.
- Friends: send, accept, reject, remove. Block, restrict, mute. Report a user, post, comment, story or message.
- Search people and hashtags; suggestions ("People to follow"); find by email/phone only if the owner allows it.

**Content**
- Posts with text, photo or video; edit the caption or audience (public / friends / only me); delete.
- **Reels:** 1 to 10 photos and/or videos in one reel; a photo shows for 5 s (change 1 to 30 s with − / +); reorder and remove before sharing; the reel plays item by item with a progress bar per item.
- Stories (24 hours) with a viewer list; camera photo and video recording.
- Likes, comments with replies, save posts (collections), hashtags, @mentions, tag people (with approval), share (copy link, WhatsApp, Facebook, X, Telegram, email, or a card in chat).
- Home feed, "Suggested for you", Explore, Reels feed, saved list, tag pages.
- **Double-click anywhere on Home or Reels refreshes the page** (text boxes, pop-ups and video controls keep their own double-click).

**Chat**
- One-to-one chats: text, **photo or video**, and shared posts/reels shown as a card with a preview.
- Message requests: from a non-friend you get one message in Requests until you accept; the sender sees "Message request sent..." instead of an error.
- Unread counts, read receipts and activity status (both sides must allow), a back button inside the chat.

**Alerts and safety**
- Notifications for likes, comments, replies, follows, requests, tags and mentions; unread badge.
- Reports and a moderator queue; rate limits on sign-in, sign-up, codes and messages; blocks hide people from each other everywhere.

## 2. Where data is stored

| Place | What is in it |
| --- | --- |
| **MySQL database `mirra`** (own server on port 3308, folder `C:\Users\Anurag Seth\mysql-mirra\`) | All text data: 33 tables listed in section 5. The app connects with `DATABASE_URL` from `server/.env`. |
| **`server/uploads/` folder** | The photo and video files. The database keeps only each file's random key. Files are served through signed links that expire (6 to 12 hours), never from a public folder. |
| **`server/.env`** | Secrets: database password, JWT secret, the four keys (phone/email encryption, blind-index hash, code hash). Never in git. |
| **Browser memory** | The 15-minute access token (lost on refresh, then renewed silently). |
| **Browser cookie `socialambak_rt`** | The long-lived refresh token: httpOnly, SameSite=Strict, so scripts cannot read it. The database holds only its hash. |
| **Browser `localStorage`** | The theme choice, and `mirra.signinId`: the last username (nothing else) so sign-in can suggest it. |
| **Browser `sessionStorage`** | The sign-up verification ticket, only until the tab closes. |
| **API console (development only)** | One-time codes are printed as `[dev-otp]`, because no real email/SMS provider is connected yet. |

## 3. How each sensitive thing is stored

| Data | How it is stored | Column |
| --- | --- | --- |
| IDs (users, posts, every `*_id`) | Plain, readable UUID text | `id`, `user_id`, ... |
| Password | argon2id hash (never the password) | `users.password_hash` |
| Mobile number | AES-256-GCM ciphertext (tied to the user id) + HMAC hash to look it up | `phone_ciphertext`, `phone_hash` |
| Email | AES-256-GCM ciphertext + HMAC hash | `email_ciphertext`, `email_hash` |
| Sign-up / recovery codes | HMAC of the code only (plus the plain code in `dev_code`, development only) | `code_hash`, `dev_code` |
| Login session | SHA-256 hash of the refresh token | `sessions.refresh_token_hash` |
| Two-factor secret | AES-256-GCM ciphertext; backup codes hashed | `totp_secret_enc`, `backup_codes.code_hash` |
| Chat and friend pair keys | The two ids themselves, smaller then larger, as readable text (id_id) | `dm_key`, `pair_key` |
| Name, username, bio, website, birth date | Plain text | `users` |
| Posts, captions, comments | Plain text | `posts`, `comments` |
| **Chat messages** | **Plain text (not encrypted)** | `messages.body` |
| Device and IP of a session | Plain text | `sessions.user_agent`, `sessions.ip` |
| Photos and videos | Files on disk; the database has only the key | `post_media.storage_key`, `messages.storage_key`, `stories.storage_key`, `users.avatar_key` |

Ciphertexts and hashes are saved as lowercase hex text, so a database client shows them like `password_hash` instead of "BLOB".

## 4. API endpoints (92)

**account** (12): `GET /account/settings` · `PATCH /account/settings` · `POST /account/change-password` · `POST /account/deactivate` · `GET /account/sessions` · `POST /account/sessions/revoke-others` · `DELETE /account/sessions/:id` · `GET /account/2fa` · `POST /account/2fa/setup` · `POST /account/2fa/enable` · `POST /account/2fa/disable` · `POST /account/2fa/backup-codes`

**auth** (12): `POST /auth/signup` · `GET /auth/availability` · `POST /auth/verify` · `POST /auth/resend` · `POST /auth/login` · `POST /auth/recover/start` · `POST /auth/recover/verify` · `POST /auth/recover/reset` · `POST /auth/2fa` · `POST /auth/refresh` · `POST /auth/logout` · `POST /auth/logout-all`

**friends** (8): `GET /friends` · `GET /friends/requests` · `GET /friends/of/:username` · `POST /friends/requests` · `POST /friends/requests/:userId/accept` · `POST /friends/requests/:userId/reject` · `DELETE /friends/requests/:userId` · `DELETE /friends/:userId`

**messages** (7): `GET /messages` · `GET /messages/unread-count` · `POST /messages/with/:userId` · `POST /messages/:id/accept` · `POST /messages/:id/decline` · `GET /messages/:id` · `POST /messages/:id`

**moderation** (2): `GET /moderation/reports` · `PATCH /moderation/reports/:id`

**notifications** (3): `GET /notifications` · `GET /notifications/unread-count` · `POST /notifications/read`

**posts** (25): `GET /posts/feed` · `GET /posts/discover` · `GET /posts/reels` · `GET /posts/explore` · `GET /posts/saved` · `GET /posts/tags` · `GET /posts/tag/:tag` · `GET /posts/by/:username` · `POST /posts` · `GET /posts/tagged/:username` · `GET /posts/tag-requests` · `POST /posts/:id/tag/approve` · `POST /posts/:id/tag/remove` · `DELETE /posts/:id/tags/:userId` · `GET /posts/:id` · `PATCH /posts/:id` · `DELETE /posts/:id` · `PUT /posts/:id/like` · `DELETE /posts/:id/like` · `PUT /posts/:id/save` · `DELETE /posts/:id/save` · `POST /posts/:id/share` · `GET /posts/:id/comments` · `POST /posts/:id/comments` · `DELETE /posts/:id/comments/:cid`

**privacy** (2): `GET /privacy` · `PATCH /privacy`

**safety** (7): `GET /safety/restricted` · `PUT /safety/restrict/:id` · `DELETE /safety/restrict/:id` · `GET /safety/blocked` · `PUT /safety/block/:id` · `DELETE /safety/block/:id` · `POST /safety/report`

**stories** (4): `GET /stories` · `POST /stories` · `POST /stories/:id/view` · `DELETE /stories/:id`

**users** (7): `GET /users/me` · `PATCH /users/me` · `GET /users/search` · `GET /users/requests` · `GET /users/suggestions` · `GET /users/by/:username` · `GET /users/by/:username/connections`

**media** (2): `POST /media` (upload, raw bytes) · `GET /media/:key` (signed link)

**health** (1): `GET /health`


## 5. Tables and columns (33)

`?` after a type means the column may be empty. 🔒 encrypted, #️⃣ hash/key, 🔑 password hash.

### activity_log
Security and account events (login, failed login, password reset, 2FA...).

- `id bigint unsigned`
- `user_id char(36)?`
- `action varchar(40)`
- `target_type varchar(20)?`
- `target_id char(36)?`
- `metadata json?`
- `created_at datetime(3)`

### backup_codes
Two-factor backup codes (stored hashed, each usable once).

- `id bigint unsigned`
- `user_id char(36)`
- `code_hash char(64)` #️⃣ hash / key (hex text)
- `used_at datetime(3)?`
- `created_at datetime(3)`

### blocks
Who blocked whom.

- `blocker_id char(36)`
- `blocked_id char(36)`
- `created_at datetime(3)`

### comment_likes
Who liked which comment.

- `comment_id char(36)`
- `user_id char(36)`
- `created_at datetime(3)`

### comments
Comments and replies (soft delete).

- `id char(36)`
- `post_id char(36)`
- `author_id char(36)`
- `parent_id char(36)?`
- `body varchar(2200)`
- `like_count int unsigned`
- `reply_count int unsigned`
- `created_at datetime(3)`
- `deleted_at datetime(3)?`

### conversation_members
Each member of a chat: request pending, muted, last read, left.

- `conversation_id char(36)`
- `user_id char(36)`
- `is_admin tinyint(1)`
- `request_pending tinyint(1)`
- `muted tinyint(1)`
- `last_read_at datetime(3)?`
- `joined_at datetime(3)`
- `left_at datetime(3)?`

### conversations
A chat between two people (unique per pair).

- `id char(36)`
- `is_group tinyint(1)`
- `title varchar(100)?`
- `dm_key char(73)?`
- `created_by char(36)?`
- `created_at datetime(3)`
- `last_message_at datetime(3)`

### follows
Who follows whom (pending until a private account accepts).

- `follower_id char(36)`
- `followee_id char(36)`
- `status enum('pending','accepted')`
- `created_at datetime(3)`
- `accepted_at datetime(3)?`

### friendships
Friend requests and friends (one row per pair).

- `requester_id char(36)`
- `addressee_id char(36)`
- `status enum('pending','accepted','rejected')`
- `pair_key char(73)`
- `created_at datetime(3)`
- `responded_at datetime(3)?`

### hashtags
Every hashtag and how many posts use it.

- `id bigint unsigned`
- `tag varchar(100)`
- `post_count int unsigned`
- `created_at datetime(3)`

### messages
Messages: text, a photo/video key, or a shared post. Not encrypted.

- `id char(36)`
- `conversation_id char(36)`
- `sender_id char(36)?`
- `body varchar(4000)?`
- `media_type enum('image','video')?`
- `storage_key varchar(300)?`
- `shared_post_id char(36)?`
- `reply_to_id char(36)?`
- `created_at datetime(3)`
- `edited_at datetime(3)?`
- `deleted_at datetime(3)?`

### mutes
Muted posts / stories per person.

- `muter_id char(36)`
- `muted_id char(36)`
- `mute_posts tinyint(1)`
- `mute_stories tinyint(1)`
- `created_at datetime(3)`

### notifications
Likes, comments, follows, requests... shown in Activity.

- `id bigint unsigned`
- `recipient_id char(36)`
- `actor_id char(36)?`
- `type varchar(32)`
- `post_id char(36)?`
- `comment_id char(36)?`
- `story_id char(36)?`
- `read_at datetime(3)?`
- `created_at datetime(3)`

### post_hashtags
Which post uses which hashtag.

- `post_id char(36)`
- `hashtag_id bigint unsigned`
- `created_at datetime(3)`

### post_likes
Who liked which post.

- `post_id char(36)`
- `user_id char(36)`
- `created_at datetime(3)`

### post_media
The photos/videos of a post or reel, in order, with a photo's time in a reel.

- `id char(36)`
- `post_id char(36)`
- `position tinyint unsigned`
- `media_type enum('image','video')`
- `storage_key varchar(300)`
- `thumbnail_key varchar(300)?`
- `width int unsigned?`
- `height int unsigned?`
- `duration_ms int unsigned?`
- `alt_text varchar(300)?`

### post_mentions
Who was @mentioned in which post.

- `post_id char(36)`
- `user_id char(36)`

### post_tags
People tagged in a photo (pending / approved / removed).

- `post_id char(36)`
- `tagged_user_id char(36)`
- `tagged_by char(36)`
- `status enum('pending','approved','removed')`
- `created_at datetime(3)`
- `responded_at datetime(3)?`

### posts
Posts and reels: caption, audience, counters, soft delete.

- `id char(36)`
- `author_id char(36)`
- `kind enum('post','reel')`
- `audience enum('public','friends','only_me')`
- `caption varchar(2200)`
- `location varchar(100)?`
- `comments_disabled tinyint(1)`
- `hide_like_count tinyint(1)`
- `like_count int unsigned`
- `comment_count int unsigned`
- `share_count int unsigned`
- `view_count bigint unsigned`
- `created_at datetime(3)`
- `updated_at datetime(3)`
- `deleted_at datetime(3)?`

### recovery_requests
Forgot password / username requests: tied to an email or phone (hashed), HMAC of the code, attempts, when it was verified.

- `id char(36)`
- `channel enum('email','phone')`
- `contact_hash char(64)` #️⃣ hash / key (hex text)
- `code_hash char(64)` #️⃣ hash / key (hex text)
- `dev_code char(6)?` ⚠️ plain, development only
- `attempts tinyint unsigned`
- `max_attempts tinyint unsigned`
- `expires_at datetime(3)`
- `verified_at datetime(3)?`
- `created_at datetime(3)`

### reports
Reports of a user / post / comment / story / message and what moderators did.

- `id char(36)`
- `reporter_id char(36)?`
- `target_type enum('user','post','comment','story','message')`
- `target_id char(36)`
- `reason varchar(50)`
- `details varchar(1000)?`
- `status enum('open','reviewing','actioned','dismissed')`
- `resolved_by char(36)?`
- `resolved_at datetime(3)?`
- `created_at datetime(3)`

### restrictions
Restricted people (their messages go to Requests, no receipts).

- `restrictor_id char(36)`
- `restricted_id char(36)`
- `created_at datetime(3)`

### saved_collections
Named collections of saved posts.

- `id char(36)`
- `user_id char(36)`
- `name varchar(50)`
- `created_at datetime(3)`

### saved_posts
Posts a person saved (optionally in a collection).

- `user_id char(36)`
- `post_id char(36)`
- `collection_id char(36)?`
- `created_at datetime(3)`

### schema_migrations
Which database migration files have been applied.

- `name varchar(255)`
- `applied_at datetime(3)`

### search_history
A person's recent searches.

- `id bigint unsigned`
- `user_id char(36)`
- `query varchar(100)?`
- `target_user_id char(36)?`
- `hashtag_id bigint unsigned?`
- `created_at datetime(3)`

### sessions
One row per signed-in device: hash of the refresh token, device, IP, expiry, revoked or rotated.

- `id char(36)`
- `user_id char(36)`
- `family_id char(36)`
- `refresh_token_hash char(64)` #️⃣ hash / key (hex text)
- `user_agent varchar(300)?`
- `ip varchar(45)?`
- `created_at datetime(3)`
- `last_used_at datetime(3)`
- `expires_at datetime(3)`
- `revoked_at datetime(3)?`
- `replaced_by char(36)?`

### stories
24-hour stories: media key, caption, expiry, view count.

- `id char(36)`
- `author_id char(36)`
- `media_type enum('image','video')`
- `storage_key varchar(300)`
- `thumbnail_key varchar(300)?`
- `duration_ms int unsigned?`
- `caption varchar(300)?`
- `view_count int unsigned`
- `created_at datetime(3)`
- `expires_at datetime(3)`

### story_views
Who viewed (and liked) which story.

- `story_id char(36)`
- `viewer_id char(36)`
- `liked tinyint(1)`
- `viewed_at datetime(3)`

### user_privacy
Per-person privacy: who sees email / phone / birthday / details / friends, who can find them, who can tag or mention, default post audience.

- `user_id char(36)`
- `show_email enum('everyone','friends','only_me')`
- `show_phone enum('everyone','friends','only_me')`
- `show_birthday enum('everyone','friends','only_me')`
- `show_details enum('everyone','friends','only_me')`
- `show_friends_list enum('everyone','friends','only_me')`
- `find_by_email enum('everyone','friends','nobody')`
- `find_by_phone enum('everyone','friends','nobody')`
- `who_can_friend_request enum('everyone','friends_of_friends','nobody')`
- `default_post_audience enum('public','friends','only_me')`
- `who_can_tag enum('everyone','friends','nobody')`
- `who_can_mention enum('everyone','friends','nobody')`
- `review_tags tinyint(1)`
- `updated_at datetime(3)`

### user_settings
Per-person settings: theme, who may message/mention, read receipts, activity status, notification switches.

- `user_id char(36)`
- `theme enum('system','light','dark')`
- `messages_from enum('everyone','following','friends','nobody')`
- `mentions_from enum('everyone','following','nobody')`
- `show_activity_status tinyint(1)`
- `read_receipts tinyint(1)`
- `notify_likes tinyint(1)`
- `notify_comments tinyint(1)`
- `notify_follows tinyint(1)`
- `notify_messages tinyint(1)`
- `updated_at datetime(3)`

### users
Every account: name, username, encrypted email and phone, password hash, profile, counters, status, 2-factor secret.

- `id char(36)`
- `username varchar(30)`
- `full_name varchar(60)`
- `email_ciphertext varchar(1024)?` 🔒 encrypted (AES-256-GCM, hex text)
- `email_hash char(64)?` #️⃣ hash / key (hex text)
- `email_key_version smallint unsigned`
- `email_verified_at datetime(3)?`
- `phone_ciphertext varchar(256)` 🔒 encrypted (AES-256-GCM, hex text)
- `phone_hash char(64)` #️⃣ hash / key (hex text)
- `phone_key_version smallint unsigned`
- `phone_verified_at datetime(3)?`
- `password_hash varchar(255)` 🔑 argon2id hash
- `password_changed_at datetime(3)`
- `date_of_birth date`
- `bio varchar(150)`
- `website varchar(200)?`
- `avatar_key varchar(300)?`
- `is_private tinyint(1)`
- `status enum('pending_verification','active','deactivated','suspended')`
- `role enum('user','moderator','admin')`
- `followers_count int unsigned`
- `following_count int unsigned`
- `posts_count int unsigned`
- `last_login_at datetime(3)?`
- `created_at datetime(3)`
- `updated_at datetime(3)`
- `deleted_at datetime(3)?`
- `last_active_at datetime(3)?`
- `totp_secret_enc varchar(256)?` 🔒 encrypted (AES-256-GCM, hex text)
- `totp_enabled_at datetime(3)?`
- `totp_last_step bigint unsigned?`
- `signup_channel enum('email','phone')`

### verification_codes
Sign-up codes (and other one-time codes): only an HMAC of the code, attempts, expiry.

- `id bigint unsigned`
- `user_id char(36)`
- `channel enum('email','phone')`
- `purpose enum('signup','login','password_reset','change_contact')`
- `code_hash char(64)` #️⃣ hash / key (hex text)
- `dev_code char(6)?` ⚠️ plain, development only
- `attempts tinyint unsigned`
- `max_attempts tinyint unsigned`
- `expires_at datetime(3)`
- `consumed_at datetime(3)?`
- `created_at datetime(3)`

## 6. Known limits

- Chat messages and captions are plain text in the database (only phone, email, passwords, codes, tokens and the 2-factor secret are protected).
- Photos/videos on the server's disk are not encrypted; they are only reachable through signed, expiring links (a link someone copied works until it expires).
- Codes are not sent by a real email or SMS service yet (they appear in the API console and on screen in development).
- A message request allows one message until accepted; there are no group chats or real-time sockets (the chat refreshes every 4 seconds).
