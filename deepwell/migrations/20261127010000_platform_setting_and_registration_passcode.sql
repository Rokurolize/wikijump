CREATE TABLE platform_setting (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by BIGINT REFERENCES "user"(user_id)
);

CREATE TABLE registration_passcode (
    passcode_id BIGSERIAL PRIMARY KEY,
    passcode_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    issuer_user_id BIGINT NOT NULL REFERENCES "user"(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    max_uses INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
    use_count INTEGER NOT NULL DEFAULT 0 CHECK (use_count >= 0),
    revoked_at TIMESTAMPTZ,
    revoked_by BIGINT REFERENCES "user"(user_id)
);

CREATE INDEX registration_passcode_active_idx
    ON registration_passcode (expires_at)
    WHERE revoked_at IS NULL;
