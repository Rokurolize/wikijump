-- Preserve Wikidot's own ListPages page-size value for imported snapshots.
--
-- This value is not reliably derivable from the normalized source returned by
-- ViewSourceModule. Native Wikijump pages continue to derive their size from
-- the latest saved source when no imported value exists.

ALTER TABLE wikidot_page_snapshot
ADD COLUMN IF NOT EXISTS wikidot_size BIGINT CHECK (wikidot_size >= 0);
