-- Upstream scpwiki #3123 (26e5c9a8c6) relaxed the wikidot_user name/slug
-- uniqueness in the base migration so a deleted or renamed Wikidot user can
-- collide with a live row; the importer tombstones the older row instead.
-- Existing databases never re-run the base migration, so apply the same
-- change here: drop the inline UNIQUE constraints and add the partial
-- indexes the base migration now creates.
ALTER TABLE wikidot_user DROP CONSTRAINT IF EXISTS wikidot_user_name_key;
ALTER TABLE wikidot_user DROP CONSTRAINT IF EXISTS wikidot_user_slug_key;
CREATE INDEX IF NOT EXISTS wikidot_user_name_idx ON wikidot_user (name) WHERE (is_deleted IS false);
CREATE INDEX IF NOT EXISTS wikidot_user_slug_idx ON wikidot_user (slug) WHERE (is_deleted IS false);
