-- A UNIQUE(page_id, name, deleted_at) constraint does not protect live files
-- because PostgreSQL treats NULL values as distinct. Reconcile any existing
-- live duplicates before adding the invariant that file creation expects.
--
-- Prefer the most recently updated row and then the lower file ID for
-- deterministic reconciliation.
WITH ranked_live_files AS (
    SELECT
        file.file_id,
        ROW_NUMBER() OVER (
            PARTITION BY file.page_id, file.name
            ORDER BY
                COALESCE(file.updated_at, file.created_at) DESC,
                file.file_id ASC
        ) AS ordinal
    FROM file
    WHERE file.deleted_at IS NULL
)
UPDATE file
SET deleted_at = NOW() + (ranked_live_files.ordinal * INTERVAL '1 microsecond')
FROM ranked_live_files
WHERE file.file_id = ranked_live_files.file_id
  AND ranked_live_files.ordinal > 1;

CREATE UNIQUE INDEX file_active_page_name_unique
    ON file (page_id, name)
    WHERE deleted_at IS NULL;
