-- Encrypted / hashed values become lowercase-hex text (CHAR/VARCHAR ascii_bin) instead of BINARY/VARBINARY,
-- so database clients show them like password_hash instead of "BLOB". UUID id / *_id columns stay BINARY(16).
-- Per table: (1) reinterpret the raw bytes as latin1 text (byte-exact, keeps the unique indexes),
--            (2) rewrite every value as LOWER(HEX(bytes)), (3) shrink to the final ascii column.
-- 32-byte values -> 64 hex chars. Ciphertext = iv(12) | tag(16) | data, hex-encoded (2 chars per byte).

-- backup_codes
ALTER TABLE backup_codes MODIFY code_hash VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE backup_codes SET code_hash = LOWER(HEX(CAST(code_hash AS BINARY)));
ALTER TABLE backup_codes MODIFY code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- conversations
ALTER TABLE conversations MODIFY dm_key VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE conversations SET dm_key = LOWER(HEX(CAST(dm_key AS BINARY)));
ALTER TABLE conversations MODIFY dm_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL;

-- friendships (pair_key is two 16-byte ids = 32 bytes)
ALTER TABLE friendships MODIFY pair_key VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE friendships SET pair_key = LOWER(HEX(CAST(pair_key AS BINARY)));
ALTER TABLE friendships MODIFY pair_key CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- sessions
ALTER TABLE sessions MODIFY refresh_token_hash VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE sessions SET refresh_token_hash = LOWER(HEX(CAST(refresh_token_hash AS BINARY)));
ALTER TABLE sessions MODIFY refresh_token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- verification_codes
ALTER TABLE verification_codes MODIFY code_hash VARCHAR(64) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL;
UPDATE verification_codes SET code_hash = LOWER(HEX(CAST(code_hash AS BINARY)));
ALTER TABLE verification_codes MODIFY code_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

-- users
ALTER TABLE users
  MODIFY email_ciphertext VARCHAR(1024) CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY email_hash       VARCHAR(64)   CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY phone_ciphertext VARCHAR(256)  CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY phone_hash       VARCHAR(64)   CHARACTER SET latin1 COLLATE latin1_bin NOT NULL,
  MODIFY totp_secret_enc  VARCHAR(256)  CHARACTER SET latin1 COLLATE latin1_bin NULL;
UPDATE users SET
  email_ciphertext = LOWER(HEX(CAST(email_ciphertext AS BINARY))),
  email_hash       = LOWER(HEX(CAST(email_hash AS BINARY))),
  phone_ciphertext = LOWER(HEX(CAST(phone_ciphertext AS BINARY))),
  phone_hash       = LOWER(HEX(CAST(phone_hash AS BINARY))),
  totp_secret_enc  = LOWER(HEX(CAST(totp_secret_enc AS BINARY)));
ALTER TABLE users
  MODIFY email_ciphertext VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY email_hash       CHAR(64)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY phone_ciphertext VARCHAR(256)  CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY phone_hash       CHAR(64)      CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  MODIFY totp_secret_enc  VARCHAR(256)  CHARACTER SET ascii COLLATE ascii_bin NULL;
