-- A UNIQUE(site_id, slug, deleted_at) constraint does not protect live pages
-- because PostgreSQL treats NULL values as distinct. Reconcile any existing
-- live duplicates before adding the invariant that page creation expects.
--
-- Prefer the row carrying the furthest revision history. If duplicate imports
-- are otherwise equivalent, prefer the most recently updated row and then the
-- lower page ID for deterministic reconciliation.
WITH ranked_live_pages AS (
    SELECT
        page.page_id,
        ROW_NUMBER() OVER (
            PARTITION BY page.site_id, page.slug
            ORDER BY
                COALESCE(latest_revision.revision_number, -1) DESC,
                COALESCE(page.updated_at, page.created_at) DESC,
                page.page_id ASC
        ) AS ordinal
    FROM page
    LEFT JOIN page_revision AS latest_revision
        ON latest_revision.revision_id = page.latest_revision_id
    WHERE page.deleted_at IS NULL
)
UPDATE page
SET deleted_at = NOW() + (ranked_live_pages.ordinal * INTERVAL '1 microsecond')
FROM ranked_live_pages
WHERE page.page_id = ranked_live_pages.page_id
  AND ranked_live_pages.ordinal > 1;

CREATE UNIQUE INDEX page_current_site_slug_unique
    ON page (site_id, slug)
    WHERE deleted_at IS NULL;
