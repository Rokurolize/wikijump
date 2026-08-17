ALTER TABLE "user"
    ADD COLUMN forum_signature TEXT
        CHECK (forum_signature IS NULL OR char_length(forum_signature) <= 400),
    ADD CONSTRAINT user_forum_signature_line_limit
        CHECK (
            forum_signature IS NULL
            OR char_length(forum_signature) - char_length(replace(forum_signature, E'\n', '')) <= 3
        );
