-- IDs become readable UUID text (CHAR(36), lowercase, e.g. 019b7c3e-1a2b-7c3d-8e4f-5a6b7c8d9e0f) instead of BINARY(16),
-- so every database client shows them (no "BLOB") and they can be searched with WHERE id = '...'.
-- IDs are identifiers, not secrets: they are intentionally NOT encrypted.
-- Applies to 68 columns in 30 tables, including every foreign key column.
-- MySQL will not change the type of a column used by a foreign key, so: (A) drop all 56 foreign keys, (B) convert, (C) add the
-- same 56 keys back with the same names and ON DELETE rules. Adding them back checks every existing row, so any orphan would fail loudly.
-- Per table: (1) reinterpret the 16 raw bytes as latin1 text, (2) rewrite them as UUID text, (3) make the final ascii column.
-- Tables with ON UPDATE CURRENT_TIMESTAMP keep their updated_at (updated_at = updated_at), so this is not seen as an edit.

-- A. drop foreign keys
ALTER TABLE activity_log DROP FOREIGN KEY fk_activity_user;
ALTER TABLE backup_codes DROP FOREIGN KEY fk_backup_codes_user;
ALTER TABLE blocks DROP FOREIGN KEY fk_blocks_blocked;
ALTER TABLE blocks DROP FOREIGN KEY fk_blocks_blocker;
ALTER TABLE comment_likes DROP FOREIGN KEY fk_comment_likes_comment;
ALTER TABLE comment_likes DROP FOREIGN KEY fk_comment_likes_user;
ALTER TABLE comments DROP FOREIGN KEY fk_comments_author;
ALTER TABLE comments DROP FOREIGN KEY fk_comments_parent;
ALTER TABLE comments DROP FOREIGN KEY fk_comments_post;
ALTER TABLE conversation_members DROP FOREIGN KEY fk_members_conversation;
ALTER TABLE conversation_members DROP FOREIGN KEY fk_members_user;
ALTER TABLE conversations DROP FOREIGN KEY fk_conversations_creator;
ALTER TABLE follows DROP FOREIGN KEY fk_follows_followee;
ALTER TABLE follows DROP FOREIGN KEY fk_follows_follower;
ALTER TABLE friendships DROP FOREIGN KEY fk_friendships_addressee;
ALTER TABLE friendships DROP FOREIGN KEY fk_friendships_requester;
ALTER TABLE messages DROP FOREIGN KEY fk_messages_conversation;
ALTER TABLE messages DROP FOREIGN KEY fk_messages_post;
ALTER TABLE messages DROP FOREIGN KEY fk_messages_reply;
ALTER TABLE messages DROP FOREIGN KEY fk_messages_sender;
ALTER TABLE mutes DROP FOREIGN KEY fk_mutes_muted;
ALTER TABLE mutes DROP FOREIGN KEY fk_mutes_muter;
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_actor;
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_comment;
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_post;
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_recipient;
ALTER TABLE notifications DROP FOREIGN KEY fk_notifications_story;
ALTER TABLE post_hashtags DROP FOREIGN KEY fk_post_hashtags_post;
ALTER TABLE post_hashtags DROP FOREIGN KEY fk_post_hashtags_tag;
ALTER TABLE post_likes DROP FOREIGN KEY fk_post_likes_post;
ALTER TABLE post_likes DROP FOREIGN KEY fk_post_likes_user;
ALTER TABLE post_media DROP FOREIGN KEY fk_post_media_post;
ALTER TABLE post_mentions DROP FOREIGN KEY fk_mentions_post;
ALTER TABLE post_mentions DROP FOREIGN KEY fk_mentions_user;
ALTER TABLE post_tags DROP FOREIGN KEY fk_post_tags_by;
ALTER TABLE post_tags DROP FOREIGN KEY fk_post_tags_post;
ALTER TABLE post_tags DROP FOREIGN KEY fk_post_tags_user;
ALTER TABLE posts DROP FOREIGN KEY fk_posts_author;
ALTER TABLE reports DROP FOREIGN KEY fk_reports_reporter;
ALTER TABLE reports DROP FOREIGN KEY fk_reports_resolver;
ALTER TABLE restrictions DROP FOREIGN KEY fk_restrictions_restricted;
ALTER TABLE restrictions DROP FOREIGN KEY fk_restrictions_restrictor;
ALTER TABLE saved_collections DROP FOREIGN KEY fk_collections_user;
ALTER TABLE saved_posts DROP FOREIGN KEY fk_saved_collection;
ALTER TABLE saved_posts DROP FOREIGN KEY fk_saved_post;
ALTER TABLE saved_posts DROP FOREIGN KEY fk_saved_user;
ALTER TABLE search_history DROP FOREIGN KEY fk_search_hashtag;
ALTER TABLE search_history DROP FOREIGN KEY fk_search_target;
ALTER TABLE search_history DROP FOREIGN KEY fk_search_user;
ALTER TABLE sessions DROP FOREIGN KEY fk_sessions_user;
ALTER TABLE stories DROP FOREIGN KEY fk_stories_author;
ALTER TABLE story_views DROP FOREIGN KEY fk_story_views_story;
ALTER TABLE story_views DROP FOREIGN KEY fk_story_views_viewer;
ALTER TABLE user_privacy DROP FOREIGN KEY fk_privacy_user;
ALTER TABLE user_settings DROP FOREIGN KEY fk_settings_user;
ALTER TABLE verification_codes DROP FOREIGN KEY fk_codes_user;

-- activity_log
ALTER TABLE activity_log
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY target_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE activity_log SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), target_id = BIN_TO_UUID(CAST(target_id AS BINARY(16)));
ALTER TABLE activity_log
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- backup_codes
ALTER TABLE backup_codes
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE backup_codes SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE backup_codes
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- blocks
ALTER TABLE blocks
  MODIFY blocker_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY blocked_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE blocks SET blocker_id = BIN_TO_UUID(CAST(blocker_id AS BINARY(16))), blocked_id = BIN_TO_UUID(CAST(blocked_id AS BINARY(16)));
ALTER TABLE blocks
  MODIFY blocker_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY blocked_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- comment_likes
ALTER TABLE comment_likes
  MODIFY comment_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE comment_likes SET comment_id = BIN_TO_UUID(CAST(comment_id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE comment_likes
  MODIFY comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- comments
ALTER TABLE comments
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY author_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY parent_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE comments SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), author_id = BIN_TO_UUID(CAST(author_id AS BINARY(16))), parent_id = BIN_TO_UUID(CAST(parent_id AS BINARY(16)));
ALTER TABLE comments
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY parent_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- conversation_members
ALTER TABLE conversation_members
  MODIFY conversation_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE conversation_members SET conversation_id = BIN_TO_UUID(CAST(conversation_id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE conversation_members
  MODIFY conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- conversations
ALTER TABLE conversations
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY created_by VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE conversations SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), created_by = BIN_TO_UUID(CAST(created_by AS BINARY(16)));
ALTER TABLE conversations
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY created_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- follows
ALTER TABLE follows
  MODIFY follower_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY followee_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE follows SET follower_id = BIN_TO_UUID(CAST(follower_id AS BINARY(16))), followee_id = BIN_TO_UUID(CAST(followee_id AS BINARY(16)));
ALTER TABLE follows
  MODIFY follower_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY followee_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- friendships
ALTER TABLE friendships
  MODIFY requester_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY addressee_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE friendships SET requester_id = BIN_TO_UUID(CAST(requester_id AS BINARY(16))), addressee_id = BIN_TO_UUID(CAST(addressee_id AS BINARY(16)));
ALTER TABLE friendships
  MODIFY requester_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY addressee_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- messages
ALTER TABLE messages
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY conversation_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY sender_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY shared_post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY reply_to_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE messages SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), conversation_id = BIN_TO_UUID(CAST(conversation_id AS BINARY(16))), sender_id = BIN_TO_UUID(CAST(sender_id AS BINARY(16))), shared_post_id = BIN_TO_UUID(CAST(shared_post_id AS BINARY(16))), reply_to_id = BIN_TO_UUID(CAST(reply_to_id AS BINARY(16)));
ALTER TABLE messages
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY sender_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY shared_post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY reply_to_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- mutes
ALTER TABLE mutes
  MODIFY muter_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY muted_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE mutes SET muter_id = BIN_TO_UUID(CAST(muter_id AS BINARY(16))), muted_id = BIN_TO_UUID(CAST(muted_id AS BINARY(16)));
ALTER TABLE mutes
  MODIFY muter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY muted_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- notifications
ALTER TABLE notifications
  MODIFY recipient_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY actor_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY comment_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY story_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE notifications SET recipient_id = BIN_TO_UUID(CAST(recipient_id AS BINARY(16))), actor_id = BIN_TO_UUID(CAST(actor_id AS BINARY(16))), post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), comment_id = BIN_TO_UUID(CAST(comment_id AS BINARY(16))), story_id = BIN_TO_UUID(CAST(story_id AS BINARY(16)));
ALTER TABLE notifications
  MODIFY recipient_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY comment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY story_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- post_hashtags
ALTER TABLE post_hashtags
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE post_hashtags SET post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16)));
ALTER TABLE post_hashtags
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- post_likes
ALTER TABLE post_likes
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE post_likes SET post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE post_likes
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- post_media
ALTER TABLE post_media
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE post_media SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16)));
ALTER TABLE post_media
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- post_mentions
ALTER TABLE post_mentions
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE post_mentions SET post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE post_mentions
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- post_tags
ALTER TABLE post_tags
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY tagged_user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY tagged_by VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE post_tags SET post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), tagged_user_id = BIN_TO_UUID(CAST(tagged_user_id AS BINARY(16))), tagged_by = BIN_TO_UUID(CAST(tagged_by AS BINARY(16)));
ALTER TABLE post_tags
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY tagged_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY tagged_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- posts
ALTER TABLE posts
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY author_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE posts SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), author_id = BIN_TO_UUID(CAST(author_id AS BINARY(16))), updated_at = updated_at;
ALTER TABLE posts
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- reports
ALTER TABLE reports
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY reporter_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL,
  MODIFY target_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY resolved_by VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE reports SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), reporter_id = BIN_TO_UUID(CAST(reporter_id AS BINARY(16))), target_id = BIN_TO_UUID(CAST(target_id AS BINARY(16))), resolved_by = BIN_TO_UUID(CAST(resolved_by AS BINARY(16)));
ALTER TABLE reports
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY reporter_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY resolved_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- restrictions
ALTER TABLE restrictions
  MODIFY restrictor_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY restricted_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE restrictions SET restrictor_id = BIN_TO_UUID(CAST(restrictor_id AS BINARY(16))), restricted_id = BIN_TO_UUID(CAST(restricted_id AS BINARY(16)));
ALTER TABLE restrictions
  MODIFY restrictor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY restricted_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- saved_collections
ALTER TABLE saved_collections
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE saved_collections SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE saved_collections
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- saved_posts
ALTER TABLE saved_posts
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY post_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY collection_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE saved_posts SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), post_id = BIN_TO_UUID(CAST(post_id AS BINARY(16))), collection_id = BIN_TO_UUID(CAST(collection_id AS BINARY(16)));
ALTER TABLE saved_posts
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY post_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY collection_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- search_history
ALTER TABLE search_history
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY target_user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE search_history SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), target_user_id = BIN_TO_UUID(CAST(target_user_id AS BINARY(16)));
ALTER TABLE search_history
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- sessions
ALTER TABLE sessions
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY family_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY replaced_by VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE sessions SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), family_id = BIN_TO_UUID(CAST(family_id AS BINARY(16))), replaced_by = BIN_TO_UUID(CAST(replaced_by AS BINARY(16)));
ALTER TABLE sessions
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY family_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY replaced_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- stories
ALTER TABLE stories
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY author_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE stories SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), author_id = BIN_TO_UUID(CAST(author_id AS BINARY(16)));
ALTER TABLE stories
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- story_views
ALTER TABLE story_views
  MODIFY story_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY viewer_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE story_views SET story_id = BIN_TO_UUID(CAST(story_id AS BINARY(16))), viewer_id = BIN_TO_UUID(CAST(viewer_id AS BINARY(16)));
ALTER TABLE story_views
  MODIFY story_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY viewer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- user_privacy
ALTER TABLE user_privacy
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE user_privacy SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), updated_at = updated_at;
ALTER TABLE user_privacy
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- user_settings
ALTER TABLE user_settings
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE user_settings SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16))), updated_at = updated_at;
ALTER TABLE user_settings
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- users
ALTER TABLE users
  MODIFY id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE users SET id = BIN_TO_UUID(CAST(id AS BINARY(16))), updated_at = updated_at;
ALTER TABLE users
  MODIFY id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- verification_codes
ALTER TABLE verification_codes
  MODIFY user_id VARCHAR(36) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE verification_codes SET user_id = BIN_TO_UUID(CAST(user_id AS BINARY(16)));
ALTER TABLE verification_codes
  MODIFY user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- C. add the foreign keys back (validates every row)
ALTER TABLE activity_log ADD CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE backup_codes ADD CONSTRAINT fk_backup_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE blocks ADD CONSTRAINT fk_blocks_blocked FOREIGN KEY (blocked_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE blocks ADD CONSTRAINT fk_blocks_blocker FOREIGN KEY (blocker_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE comment_likes ADD CONSTRAINT fk_comment_likes_comment FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE;
ALTER TABLE comment_likes ADD CONSTRAINT fk_comment_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT fk_comments_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT fk_comments_parent FOREIGN KEY (parent_id) REFERENCES comments (id) ON DELETE CASCADE;
ALTER TABLE comments ADD CONSTRAINT fk_comments_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE conversation_members ADD CONSTRAINT fk_members_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE;
ALTER TABLE conversation_members ADD CONSTRAINT fk_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT fk_conversations_creator FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE follows ADD CONSTRAINT fk_follows_followee FOREIGN KEY (followee_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE follows ADD CONSTRAINT fk_follows_follower FOREIGN KEY (follower_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE friendships ADD CONSTRAINT fk_friendships_addressee FOREIGN KEY (addressee_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE friendships ADD CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT fk_messages_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE;
ALTER TABLE messages ADD CONSTRAINT fk_messages_post FOREIGN KEY (shared_post_id) REFERENCES posts (id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT fk_messages_reply FOREIGN KEY (reply_to_id) REFERENCES messages (id) ON DELETE SET NULL;
ALTER TABLE messages ADD CONSTRAINT fk_messages_sender FOREIGN KEY (sender_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE mutes ADD CONSTRAINT fk_mutes_muted FOREIGN KEY (muted_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE mutes ADD CONSTRAINT fk_mutes_muter FOREIGN KEY (muter_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_actor FOREIGN KEY (actor_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_comment FOREIGN KEY (comment_id) REFERENCES comments (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_recipient FOREIGN KEY (recipient_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE notifications ADD CONSTRAINT fk_notifications_story FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE;
ALTER TABLE post_hashtags ADD CONSTRAINT fk_post_hashtags_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE post_hashtags ADD CONSTRAINT fk_post_hashtags_tag FOREIGN KEY (hashtag_id) REFERENCES hashtags (id) ON DELETE CASCADE;
ALTER TABLE post_likes ADD CONSTRAINT fk_post_likes_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE post_likes ADD CONSTRAINT fk_post_likes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE post_media ADD CONSTRAINT fk_post_media_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE post_mentions ADD CONSTRAINT fk_mentions_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE post_mentions ADD CONSTRAINT fk_mentions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE post_tags ADD CONSTRAINT fk_post_tags_by FOREIGN KEY (tagged_by) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE post_tags ADD CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE post_tags ADD CONSTRAINT fk_post_tags_user FOREIGN KEY (tagged_user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE posts ADD CONSTRAINT fk_posts_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE reports ADD CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE reports ADD CONSTRAINT fk_reports_resolver FOREIGN KEY (resolved_by) REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE restrictions ADD CONSTRAINT fk_restrictions_restricted FOREIGN KEY (restricted_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE restrictions ADD CONSTRAINT fk_restrictions_restrictor FOREIGN KEY (restrictor_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE saved_collections ADD CONSTRAINT fk_collections_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE saved_posts ADD CONSTRAINT fk_saved_collection FOREIGN KEY (collection_id) REFERENCES saved_collections (id) ON DELETE SET NULL;
ALTER TABLE saved_posts ADD CONSTRAINT fk_saved_post FOREIGN KEY (post_id) REFERENCES posts (id) ON DELETE CASCADE;
ALTER TABLE saved_posts ADD CONSTRAINT fk_saved_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE search_history ADD CONSTRAINT fk_search_hashtag FOREIGN KEY (hashtag_id) REFERENCES hashtags (id) ON DELETE CASCADE;
ALTER TABLE search_history ADD CONSTRAINT fk_search_target FOREIGN KEY (target_user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE search_history ADD CONSTRAINT fk_search_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE stories ADD CONSTRAINT fk_stories_author FOREIGN KEY (author_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE story_views ADD CONSTRAINT fk_story_views_story FOREIGN KEY (story_id) REFERENCES stories (id) ON DELETE CASCADE;
ALTER TABLE story_views ADD CONSTRAINT fk_story_views_viewer FOREIGN KEY (viewer_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE user_privacy ADD CONSTRAINT fk_privacy_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE user_settings ADD CONSTRAINT fk_settings_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE verification_codes ADD CONSTRAINT fk_codes_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE;
