ALTER TABLE blob_pending
    ADD COLUMN site_id BIGINT,
    ADD COLUMN page_id BIGINT,
    ADD CONSTRAINT blob_pending_page_scope_shape CHECK (
        (site_id IS NULL AND page_id IS NULL)
        OR (site_id IS NOT NULL AND page_id IS NOT NULL)
    );
