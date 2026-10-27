-- Issue #2089: page meta tags are multi-valued. A scope may hold several
-- rows with the same name and different content (for example repeated
-- og:locale:alternate values in a page head); only an exact
-- (name, content) pair is unique within a scope. Replace the per-name
-- unique indexes from 20260810020000_page_meta_tag.sql with per-pair ones.
DROP INDEX IF EXISTS page_meta_tag_site_name_unique;
DROP INDEX IF EXISTS page_meta_tag_page_name_unique;

CREATE UNIQUE INDEX page_meta_tag_site_pair_unique
    ON page_meta_tag (site_id, name, content)
    WHERE all_pages;

CREATE UNIQUE INDEX page_meta_tag_page_pair_unique
    ON page_meta_tag (site_id, page_id, name, content)
    WHERE NOT all_pages;
