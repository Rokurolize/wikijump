-- Email tokens for the shared account recovery and verification lane
-- (#2128 password recovery, #2130 email verification).
--
-- Stores only the hex of the token hash; the plaintext token exists only
-- in the delivery sent to the account's email address and is never
-- persisted. Tokens are bound to (user, email, purpose), expire after a
-- short local-default TTL, and are consumed atomically on redeem.
-- TTLs are local defaults pending Wikidot evidence.
CREATE TABLE email_token (
    email_token_id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(user_id),
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_ip TEXT NOT NULL
);

CREATE INDEX idx_email_token_active
    ON email_token (user_id, purpose)
    WHERE consumed_at IS NULL;
