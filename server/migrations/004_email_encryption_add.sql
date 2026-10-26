-- Step 1 of 2: add the encrypted email columns (nullable until scripts/encrypt-emails.js has filled every row).
--   email_ciphertext = AES-256-GCM(iv | tag | ciphertext), AAD bound to the user id (same layout as phone_ciphertext)
--   email_hash       = HMAC-SHA256 blind index of the lowercased email, used for uniqueness and sign-in lookup
ALTER TABLE users
  ADD COLUMN email_ciphertext  VARBINARY(512) NULL AFTER email,
  ADD COLUMN email_hash        BINARY(32)     NULL AFTER email_ciphertext,
  ADD COLUMN email_key_version SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER email_hash;
