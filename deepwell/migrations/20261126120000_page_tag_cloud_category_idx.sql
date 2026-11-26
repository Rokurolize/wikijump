CREATE INDEX IF NOT EXISTS page_site_category_live_idx
    ON page (site_id, page_category_id)
    WHERE deleted_at IS NULL;
