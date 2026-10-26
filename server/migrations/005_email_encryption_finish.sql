-- Step 2 of 2: run only after `npm run encrypt:emails` (fails safely, rolling back nothing, if any row is still unencrypted).
-- Enforces the new columns and removes the plain-text email column and its unique index.
ALTER TABLE users
  MODIFY COLUMN email_ciphertext VARBINARY(512) NOT NULL,
  MODIFY COLUMN email_hash       BINARY(32)     NOT NULL,
  ADD UNIQUE KEY uq_users_email_hash (email_hash),
  DROP INDEX uq_users_email,
  DROP COLUMN email;
