ALTER TABLE text_block
    ADD COLUMN wikidot_sha1 BYTEA
    CHECK (
        wikidot_sha1 IS NULL
        OR (block_type = 'html' AND octet_length(wikidot_sha1) = 20)
    );

-- Production startup backfills legacy rows from their exact S3 bytes and
-- validates the constraint before workers accept requests. New HTML rows must
-- not silently omit their identity.
ALTER TABLE text_block
    ADD CONSTRAINT text_block_html_wikidot_sha1_present
    CHECK (block_type <> 'html' OR wikidot_sha1 IS NOT NULL)
    NOT VALID;

CREATE INDEX text_block_html_wikidot_sha1_idx
    ON text_block (wikidot_sha1)
    WHERE block_type = 'html' AND wikidot_sha1 IS NOT NULL;
