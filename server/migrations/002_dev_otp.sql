-- Plain-text copy of the one-time code, filled ONLY when OTP_DELIVERY=console outside production,
-- so a developer or tester can read the code straight from the table. Production refuses console
-- delivery, so this column stays NULL there (only code_hash is stored).
ALTER TABLE verification_codes ADD COLUMN dev_code CHAR(6) NULL AFTER code_hash;
