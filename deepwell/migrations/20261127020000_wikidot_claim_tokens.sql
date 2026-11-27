-- Claim tokens for self-service activation of imported Wikidot accounts (T17).
--
-- Stores only the hex of the k12 token hash; the plaintext token exists only
-- in the claim link/response and is never persisted. Tokens are bound to a
-- `wikidot_user` row (not a Wikijump `user` row, which does not exist until
-- activation), parameterized by `proof_kind`, and consumed atomically on
-- redemption only after `verified_at` is set.
CREATE TABLE wikidot_claim_token (
    wikidot_claim_token_id BIGSERIAL PRIMARY KEY,
    wikidot_user_id INTEGER NOT NULL REFERENCES wikidot_user (user_id),
    proof_kind TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    challenge_nonce TEXT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    verified_at TIMESTAMPTZ NULL,
    consumed_at TIMESTAMPTZ NULL,
    created_ip INET NOT NULL
);

CREATE INDEX idx_wikidot_claim_token_active
    ON wikidot_claim_token (wikidot_user_id)
    WHERE consumed_at IS NULL;

CREATE INDEX idx_wikidot_claim_token_lookup
    ON wikidot_claim_token (token_hash);

CREATE INDEX idx_wikidot_claim_token_ip_throttle
    ON wikidot_claim_token (created_ip, created_at);
