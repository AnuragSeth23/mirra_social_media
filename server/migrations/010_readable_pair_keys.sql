-- friendships.pair_key and conversations.dm_key were the two user ids glued together as 64 hex characters (no dashes).
-- They become the two ids themselves, readable and in order: "<smaller id>_<larger id>" (73 characters), e.g.
--   01a16c7d-cfa9-70af-98c3-ea11fc8425d9_01a16c82-22e3-70a3-afaf-cab2c9267bb5
-- Same order as before (ids sort the same as text and as bytes), so every existing pair keeps its key's meaning and the unique indexes stay.

ALTER TABLE friendships MODIFY pair_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;
UPDATE friendships SET pair_key = CONCAT(
  SUBSTR(pair_key, 1, 8), '-', SUBSTR(pair_key, 9, 4), '-', SUBSTR(pair_key, 13, 4), '-', SUBSTR(pair_key, 17, 4), '-', SUBSTR(pair_key, 21, 12), '_',
  SUBSTR(pair_key, 33, 8), '-', SUBSTR(pair_key, 41, 4), '-', SUBSTR(pair_key, 45, 4), '-', SUBSTR(pair_key, 49, 4), '-', SUBSTR(pair_key, 53, 12))
 WHERE CHAR_LENGTH(pair_key) = 64;
ALTER TABLE friendships MODIFY pair_key CHAR(73) CHARACTER SET ascii COLLATE ascii_bin NOT NULL;

ALTER TABLE conversations MODIFY dm_key VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL;
UPDATE conversations SET dm_key = CONCAT(
  SUBSTR(dm_key, 1, 8), '-', SUBSTR(dm_key, 9, 4), '-', SUBSTR(dm_key, 13, 4), '-', SUBSTR(dm_key, 17, 4), '-', SUBSTR(dm_key, 21, 12), '_',
  SUBSTR(dm_key, 33, 8), '-', SUBSTR(dm_key, 41, 4), '-', SUBSTR(dm_key, 45, 4), '-', SUBSTR(dm_key, 49, 4), '-', SUBSTR(dm_key, 53, 12))
 WHERE dm_key IS NOT NULL AND CHAR_LENGTH(dm_key) = 64;
ALTER TABLE conversations MODIFY dm_key CHAR(73) CHARACTER SET ascii COLLATE ascii_bin NULL;
