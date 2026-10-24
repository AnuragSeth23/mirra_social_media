-- Privacy and security (additive only: nothing here drops or rewrites existing data).
--   * posts.audience               who may see a post: public / friends / only me
--   * friendships                  friend requests and accepted friendships (one row per pair)
--   * user_privacy                 what other people may see and do (profile fields, search, requests, tags, mentions)
--   * restrictions                 "restrict" a person quietly (clearly defined behaviour in docs/PRIVACY.md)
--   * post_tags                    people tagged in a post, with approval status
--   * user_settings               + read receipts, + the new "friends" option for who may message you
--   * users                       + last_active_at (activity status), + TOTP columns (two-factor sign-in)
--   * backup_codes                 one-time recovery codes for two-factor sign-in (only hashes are stored)

SET NAMES utf8mb4;

-- ---------- post audience ----------
ALTER TABLE posts
  ADD COLUMN audience ENUM('public','friends','only_me') NOT NULL DEFAULT 'public' AFTER kind,
  ADD KEY idx_posts_author_audience (author_id, audience, deleted_at, created_at);

-- ---------- friends ----------
-- One row per pair of people. pair_key = the two ids (smaller first) so the same pair can never appear twice,
-- whichever of them sent the request. The primary key records who asked whom.
CREATE TABLE friendships (
  requester_id  BINARY(16) NOT NULL,
  addressee_id  BINARY(16) NOT NULL,
  status        ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  pair_key      BINARY(32) NOT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  responded_at  DATETIME(3) NULL,
  PRIMARY KEY (requester_id, addressee_id),
  UNIQUE KEY uq_friendships_pair (pair_key),
  KEY idx_friendships_addressee (addressee_id, status, created_at),
  KEY idx_friendships_requester (requester_id, status, created_at),
  CONSTRAINT fk_friendships_requester FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_friendships_addressee FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- privacy settings (one row per user, created on first use; the defaults below are the privacy-first defaults) ----------
CREATE TABLE user_privacy (
  user_id                  BINARY(16) NOT NULL,
  show_email               ENUM('everyone','friends','only_me') NOT NULL DEFAULT 'only_me',
  show_phone               ENUM('everyone','friends','only_me') NOT NULL DEFAULT 'only_me',
  show_birthday            ENUM('everyone','friends','only_me') NOT NULL DEFAULT 'only_me',
  show_details             ENUM('everyone','friends','only_me') NOT NULL DEFAULT 'everyone',   -- bio and website
  show_friends_list        ENUM('everyone','friends','only_me') NOT NULL DEFAULT 'everyone',
  find_by_email            ENUM('everyone','friends','nobody') NOT NULL DEFAULT 'nobody',
  find_by_phone            ENUM('everyone','friends','nobody') NOT NULL DEFAULT 'nobody',
  who_can_friend_request   ENUM('everyone','friends_of_friends','nobody') NOT NULL DEFAULT 'everyone',
  default_post_audience    ENUM('public','friends','only_me') NOT NULL DEFAULT 'public',
  who_can_tag              ENUM('everyone','friends','nobody') NOT NULL DEFAULT 'everyone',
  who_can_mention          ENUM('everyone','friends','nobody') NOT NULL DEFAULT 'everyone',
  review_tags              BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at               DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (user_id),
  CONSTRAINT fk_privacy_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- restrict ----------
CREATE TABLE restrictions (
  restrictor_id  BINARY(16) NOT NULL,
  restricted_id  BINARY(16) NOT NULL,
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (restrictor_id, restricted_id),
  KEY idx_restrictions_restricted (restricted_id),
  CONSTRAINT fk_restrictions_restrictor FOREIGN KEY (restrictor_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_restrictions_restricted FOREIGN KEY (restricted_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- tags ----------
-- A tag never widens a post's audience: the tagged person can only be tagged if they could already see the post.
CREATE TABLE post_tags (
  post_id         BINARY(16) NOT NULL,
  tagged_user_id  BINARY(16) NOT NULL,
  tagged_by       BINARY(16) NOT NULL,
  status          ENUM('pending','approved','removed') NOT NULL DEFAULT 'approved',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  responded_at    DATETIME(3) NULL,
  PRIMARY KEY (post_id, tagged_user_id),
  KEY idx_post_tags_user (tagged_user_id, status, created_at),
  CONSTRAINT fk_post_tags_post FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_user FOREIGN KEY (tagged_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_post_tags_by FOREIGN KEY (tagged_by) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ---------- messaging privacy, activity status ----------
ALTER TABLE user_settings
  MODIFY COLUMN messages_from ENUM('everyone','following','friends','nobody') NOT NULL DEFAULT 'everyone',
  ADD COLUMN read_receipts BOOLEAN NOT NULL DEFAULT TRUE AFTER show_activity_status;

ALTER TABLE users ADD COLUMN last_active_at DATETIME(3) NULL;

-- ---------- two-factor sign-in (TOTP) ----------
-- totp_secret_enc is AES-256-GCM encrypted (same scheme as phone numbers). totp_enabled_at stays NULL until the user
-- proves they can generate a code. totp_last_step blocks re-using a code inside its 30-second window.
ALTER TABLE users
  ADD COLUMN totp_secret_enc VARBINARY(128) NULL,
  ADD COLUMN totp_enabled_at DATETIME(3) NULL,
  ADD COLUMN totp_last_step BIGINT UNSIGNED NULL;

CREATE TABLE backup_codes (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id    BINARY(16) NOT NULL,
  code_hash  BINARY(32) NOT NULL,
  used_at    DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_backup_codes_user (user_id, used_at),
  CONSTRAINT fk_backup_codes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
