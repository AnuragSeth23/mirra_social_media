-- 1) One sign-up code, sent where the person chooses (email OR phone), like Instagram / Facebook.
--    users.signup_channel remembers the choice, so a sign-in attempt before verifying re-sends the code to the same place.
--    Accounts that are mid-way through the old two-code sign-up keep going from where they are (email first, then phone).
ALTER TABLE users ADD COLUMN signup_channel ENUM('email','phone') NOT NULL DEFAULT 'phone';
UPDATE users SET signup_channel = IF(email_verified_at IS NULL, 'email', 'phone'), updated_at = updated_at WHERE status = 'pending_verification';

-- 2) Several accounts may share one mobile number (the app caps it at 5), so "find my accounts by phone" can list them all.
--    The phone is still stored encrypted; phone_hash stays as the lookup index, no longer unique.
ALTER TABLE users DROP INDEX uq_users_phone_hash, ADD INDEX ix_users_phone_hash (phone_hash);

-- 3) Account recovery (forgot password / forgot username). A request belongs to a CONTACT (an email or a phone), not to one account:
--    proving the code proves the contact, and then every account that uses that contact can be listed or reset.
--    Only an HMAC of the code is stored, plus the plain code in development (dev_code, same as verification_codes).
CREATE TABLE recovery_requests (
  id            CHAR(36)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  channel       ENUM('email','phone') NOT NULL,
  contact_hash  CHAR(64)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  code_hash     CHAR(64)    CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  dev_code      CHAR(6)     DEFAULT NULL,
  attempts      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts  TINYINT UNSIGNED NOT NULL DEFAULT 5,
  expires_at    DATETIME(3) NOT NULL,
  verified_at   DATETIME(3) DEFAULT NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_recovery_contact (channel, contact_hash, created_at),
  KEY idx_recovery_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
