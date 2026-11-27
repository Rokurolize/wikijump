-- Reconcile duplicate (file_id, revision_number) rows created by pre-fix
-- concurrent file revision mutations before enforcing uniqueness.
--
-- Note: file_revision rows cannot be soft-deleted or renumbered because they
-- represent served history and revision numbers are user-visible in URLs.
-- Instead, for each (file_id, revision_number) group with multiple rows, keep
-- one canonical row and delete the losing duplicates:
--   1. For interior duplicates, prefer a row whose page_id matches the next
--      revision's page_id.
--   2. Prefer a row whose page_id matches the parent file.page_id so head
--      lookups filtered by (site_id, page_id, file_id) remain consistent.
--   3. Prefer a row whose name matches file.name.
--   4. Prefer a row whose delete status agrees with file.deleted_at IS NOT NULL.
--   5. Deterministic tie-breaker: highest revision_id (matching
--      FileRevisionService::get_latest_for_file).
--
-- Rollback note:
--   - Schema: DROP INDEX IF EXISTS file_revision_file_id_revision_number_unique;
--   - Data: DELETE is destructive for the losing duplicate rows; before running
--     in production/Standing, take a pre-migration backup/snapshot (or export
--     the deleted rows via pg_dump / COPY) so deleted rows can be restored if
--     needed after dropping the unique index.
DO $$
DECLARE
    deleted_count BIGINT;
BEGIN
    WITH ranked_revisions AS (
        SELECT
            fr.revision_id,
            ROW_NUMBER() OVER (
                PARTITION BY fr.file_id, fr.revision_number
                ORDER BY
                    CASE
                        WHEN EXISTS (
                            SELECT 1
                            FROM file_revision next_fr
                            WHERE next_fr.file_id = fr.file_id
                              AND next_fr.revision_number = fr.revision_number + 1
                              AND next_fr.page_id = fr.page_id
                        ) THEN 0
                        ELSE 1
                    END ASC,
                    CASE WHEN fr.page_id = f.page_id THEN 0 ELSE 1 END ASC,
                    CASE WHEN fr.name = f.name THEN 0 ELSE 1 END ASC,
                    CASE
                        WHEN (fr.revision_type = 'delete') = (f.deleted_at IS NOT NULL) THEN 0
                        ELSE 1
                    END ASC,
                    fr.revision_id DESC
            ) AS ordinal
        FROM file_revision fr
        JOIN file f ON f.file_id = fr.file_id
    )
    DELETE FROM file_revision
    USING ranked_revisions
    WHERE file_revision.revision_id = ranked_revisions.revision_id
      AND ranked_revisions.ordinal > 1;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    IF deleted_count > 0 THEN
        RAISE NOTICE 'file_revision_unique: deleted % duplicate file_revision row(s)', deleted_count;
    END IF;
END $$;

CREATE UNIQUE INDEX file_revision_file_id_revision_number_unique
    ON file_revision (file_id, revision_number);
