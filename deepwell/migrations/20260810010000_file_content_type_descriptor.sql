ALTER TABLE file_revision
    ADD COLUMN content_type_label TEXT,
    ADD COLUMN content_type_description TEXT,
    ADD CONSTRAINT file_revision_content_type_descriptor_shape CHECK (
        (content_type_label IS NULL AND content_type_description IS NULL)
        OR (
            content_type_label IS NOT NULL
            AND content_type_description IS NOT NULL
            AND length(content_type_label) > 0
            AND length(content_type_description) > 0
            AND strpos(content_type_label, E'\n') = 0
            AND strpos(content_type_label, E'\r') = 0
            AND strpos(content_type_description, E'\n') = 0
            AND strpos(content_type_description, E'\r') = 0
        )
    );

ALTER TABLE blob_pending
    ADD COLUMN content_type_label TEXT,
    ADD COLUMN content_type_description TEXT,
    ADD CONSTRAINT blob_pending_content_type_descriptor_shape CHECK (
        (content_type_label IS NULL AND content_type_description IS NULL)
        OR (
            content_type_label IS NOT NULL
            AND content_type_description IS NOT NULL
            AND length(content_type_label) > 0
            AND length(content_type_description) > 0
            AND strpos(content_type_label, E'\n') = 0
            AND strpos(content_type_label, E'\r') = 0
            AND strpos(content_type_description, E'\n') = 0
            AND strpos(content_type_description, E'\r') = 0
        )
    );
