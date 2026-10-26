-- The email is optional: someone may sign up with just a mobile number (the code goes to the phone).
-- The encrypted email and its blind-index hash may now be empty. uq_users_email_hash stays UNIQUE: MySQL allows any number of
-- NULLs in a unique index, so only real emails must be different.
ALTER TABLE users
  MODIFY email_ciphertext VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NULL,
  MODIFY email_hash       CHAR(64)      CHARACTER SET ascii COLLATE ascii_bin NULL;
