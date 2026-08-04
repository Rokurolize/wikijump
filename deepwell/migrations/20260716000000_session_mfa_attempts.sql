-- Failed MFA verification is serialized and accounted against the restricted
-- session row. Normal authenticated sessions never carry this state.
ALTER TABLE session
    ADD COLUMN mfa_failed_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (mfa_failed_attempts BETWEEN 0 AND 5),
    ADD CONSTRAINT session_normal_mfa_attempts_zero
        CHECK (restricted OR mfa_failed_attempts = 0);
