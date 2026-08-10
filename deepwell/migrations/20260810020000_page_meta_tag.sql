CREATE UNIQUE INDEX page_site_id_page_id_unique
    ON page (site_id, page_id);

CREATE TABLE page_meta_tag (
    page_meta_tag_id BIGSERIAL PRIMARY KEY,
    site_id BIGINT NOT NULL REFERENCES site(site_id) ON DELETE CASCADE,
    page_id BIGINT,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    all_pages BOOLEAN NOT NULL,

    CHECK ((all_pages AND page_id IS NULL) OR (NOT all_pages AND page_id IS NOT NULL)),
    CHECK (length(name) BETWEEN 1 AND 255),
    CHECK (length(content) BETWEEN 1 AND 4096),
    FOREIGN KEY (site_id, page_id) REFERENCES page(site_id, page_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX page_meta_tag_site_name_unique
    ON page_meta_tag (site_id, name)
    WHERE all_pages;

CREATE UNIQUE INDEX page_meta_tag_page_name_unique
    ON page_meta_tag (site_id, page_id, name)
    WHERE NOT all_pages;
