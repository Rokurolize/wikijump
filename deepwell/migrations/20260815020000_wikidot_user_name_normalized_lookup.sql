-- Normalize by trimming ASCII space, tab, or NBSP, lowercasing, then mapping
-- those separators and underscore to '-'. Repeated separators remain repeated.
-- Broader Unicode whitespace and separator behavior remains unevidenced.
-- Keep this expression aligned with WIKIDOT_AUTHOR_NAME_SQL_TEMPLATE.
DROP INDEX IF EXISTS wikidot_page_snapshot_created_by_name_normalized_idx;
CREATE INDEX wikidot_page_snapshot_created_by_name_normalized_idx
    ON wikidot_page_snapshot (
        (replace(translate(lower(btrim(created_by_name, U&'\0009\0020\00A0')), U&'\0009\0020\00A0', '---'), '_', '-')),
        page_id
    )
    WHERE created_by_name IS NOT NULL;

CREATE INDEX wikidot_user_name_normalized_idx
    ON wikidot_user (
        (replace(translate(lower(btrim(name, U&'\0009\0020\00A0')), U&'\0009\0020\00A0', '---'), '_', '-'))
    )
    WHERE is_deleted = FALSE AND name IS NOT NULL;
