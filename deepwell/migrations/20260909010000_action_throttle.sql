-- Compatibility mutations need a local abuse boundary without exposing
-- whether a request failed because of policy, actor state, or the throttle
-- itself. Keep the counter partition server-owned and independent of any
-- client-supplied token, page, revision, or route value.
CREATE TABLE action_throttle (
    action_key TEXT NOT NULL CHECK (action_key <> ''),
    site_id BIGINT NOT NULL REFERENCES site(site_id) ON DELETE CASCADE,
    actor_user_id BIGINT NOT NULL REFERENCES known_user(user_id) ON DELETE CASCADE,
    window_started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    attempts BIGINT NOT NULL CHECK (attempts > 0),
    PRIMARY KEY (action_key, site_id, actor_user_id)
);
