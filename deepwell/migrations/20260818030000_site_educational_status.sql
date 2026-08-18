ALTER TABLE site
    ADD COLUMN master_admin_user_id BIGINT REFERENCES known_user(user_id),
    ADD COLUMN educational BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN educational_organization TEXT,
    ADD COLUMN educational_purpose TEXT,
    ADD CONSTRAINT site_educational_application_shape CHECK (
        (
            NOT educational
            AND educational_organization IS NULL
            AND educational_purpose IS NULL
        )
        OR (
            educational
            AND educational_organization IS NOT NULL
            AND btrim(educational_organization) != ''
            AND educational_purpose IS NOT NULL
            AND btrim(educational_purpose) != ''
        )
    );
