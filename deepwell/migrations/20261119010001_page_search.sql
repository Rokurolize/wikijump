-- "Current page text" is the latest revision's wikitext source, plus the
-- latest revision title and page slug. A trigger maintains the vector when
-- the current revision or deletion state changes; queries also filter deleted pages.

ALTER TABLE page ADD COLUMN search_vector TSVECTOR;

CREATE OR REPLACE FUNCTION page_search_vector_refresh() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.deleted_at IS NOT NULL OR NEW.latest_revision_id IS NULL THEN
        NEW.search_vector := NULL;
    ELSE
        SELECT setweight(to_tsvector('english'::regconfig, coalesce(pr.title, '')), 'A') ||
               setweight(to_tsvector('english'::regconfig, coalesce(NEW.slug, '')), 'A') ||
               setweight(to_tsvector('english'::regconfig, coalesce(t.contents, '')), 'B')
          INTO NEW.search_vector
          FROM page_revision pr
          LEFT JOIN text t ON t.hash = pr.wikitext_hash
         WHERE pr.revision_id = NEW.latest_revision_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER page_search_vector_refresh
    BEFORE INSERT OR UPDATE OF latest_revision_id, deleted_at ON page
    FOR EACH ROW EXECUTE FUNCTION page_search_vector_refresh();

UPDATE page p
   SET search_vector =
       setweight(to_tsvector('english'::regconfig, coalesce(pr.title, '')), 'A') ||
       setweight(to_tsvector('english'::regconfig, coalesce(p.slug, '')), 'A') ||
       setweight(to_tsvector('english'::regconfig, coalesce(t.contents, '')), 'B')
  FROM page_revision pr
  LEFT JOIN text t ON t.hash = pr.wikitext_hash
 WHERE pr.revision_id = p.latest_revision_id
   AND p.deleted_at IS NULL;

CREATE INDEX page_search_vector_gin ON page USING GIN (search_vector);
