CREATE INDEX IF NOT EXISTS file_revision_site_id_page_id_idx
    ON file_revision (site_id, page_id);
