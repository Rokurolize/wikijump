ALTER TABLE forum_post
    ADD COLUMN guest_name TEXT,
    ADD COLUMN guest_email_md5 TEXT,
    ADD CONSTRAINT forum_post_guest_identity_shape CHECK (
        (guest_name IS NULL AND guest_email_md5 IS NULL)
        OR (
            user_id = -3
            AND guest_name IS NOT NULL
            AND btrim(guest_name) != ''
            AND guest_email_md5 ~ '^[0-9a-f]{32}$'
        )
    );
