-- Voice and video calls inside a chat.
--   calls         one row per call: who called whom, voice or video, and how it went (ringing -> active -> ended / declined / missed / cancelled)
--   call_signals  the short-lived WebRTC "handshake" messages (offer, answer, ICE candidates) the two browsers pass to each other through the API.
--                 The audio and video themselves never touch the server: they go directly between the two browsers.
--   messages.call_id  when a call ends, a message is added to the chat ("Voice call 2:31", "Missed video call") that points at its call.
-- caller_seen_at / callee_seen_at are updated every time that side checks in; a side silent for ~20 s means the call dropped.

CREATE TABLE calls (
  id              CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  conversation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  caller_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  callee_id       CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  kind            ENUM('voice','video') NOT NULL,
  status          ENUM('ringing','active','ended','declined','missed','cancelled') NOT NULL DEFAULT 'ringing',
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  answered_at     DATETIME(3) DEFAULT NULL,
  ended_at        DATETIME(3) DEFAULT NULL,
  ended_by        CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  caller_seen_at  DATETIME(3) DEFAULT NULL,
  callee_seen_at  DATETIME(3) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_calls_callee (callee_id, status, created_at),
  KEY idx_calls_caller (caller_id, status, created_at),
  KEY idx_calls_conversation (conversation_id, created_at),
  CONSTRAINT fk_calls_conversation FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
  CONSTRAINT fk_calls_caller FOREIGN KEY (caller_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_calls_callee FOREIGN KEY (callee_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_calls_ended_by FOREIGN KEY (ended_by) REFERENCES users (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE call_signals (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  call_id    CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  from_user  CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  type       ENUM('offer','answer','ice') NOT NULL,
  payload    JSON NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_signals_call (call_id, id),
  CONSTRAINT fk_signals_call FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE CASCADE,
  CONSTRAINT fk_signals_user FOREIGN KEY (from_user) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

ALTER TABLE messages
  ADD COLUMN call_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin DEFAULT NULL,
  ADD KEY idx_messages_call (call_id),
  ADD CONSTRAINT fk_messages_call FOREIGN KEY (call_id) REFERENCES calls (id) ON DELETE SET NULL;
