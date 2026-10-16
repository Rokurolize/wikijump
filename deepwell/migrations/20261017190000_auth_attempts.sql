CREATE TABLE authentication_attempt (
    bucket_key TEXT PRIMARY KEY CHECK (bucket_key <> ''),
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts BIGINT NOT NULL CHECK (attempts > 0)
);

CREATE INDEX authentication_attempt_window_idx
    ON authentication_attempt (window_started_at);
