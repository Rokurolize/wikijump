CREATE TABLE membership_email_invitation (
    invitation_id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site(site_id),
    sender_user_id BIGINT NOT NULL REFERENCES known_user(user_id),
    token_digest TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    recipient_name TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    to_contacts BOOLEAN NOT NULL DEFAULT false,
    delivered BOOLEAN NOT NULL DEFAULT false,
    attempts SMALLINT NOT NULL DEFAULT 0,
    accepted BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    accepted_at TIMESTAMP WITH TIME ZONE,

    UNIQUE (site_id, email),
    CHECK (length(token_digest) = 64),
    CHECK (length(email) > 0),
    CHECK (length(recipient_name) > 0),
    CHECK (attempts >= 0)
);

CREATE INDEX membership_email_invitation_site_state_idx
    ON membership_email_invitation(site_id, accepted, invitation_id);
