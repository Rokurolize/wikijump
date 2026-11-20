CREATE INDEX IF NOT EXISTS page_revision_site_activity_keyset_idx
    ON page_revision (site_id, created_at DESC, revision_id DESC)
    WHERE revision_type NOT IN ('delete', 'undelete');

CREATE INDEX IF NOT EXISTS file_revision_site_activity_keyset_idx
    ON file_revision (site_id, created_at DESC, revision_id DESC);
