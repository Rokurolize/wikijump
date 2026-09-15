-- Persist the page-edit state that Wikidot exposes through ListDrafts.
--
-- A draft is owned by one user and one site. Existing-page drafts retain the
-- page identity; drafts for a not-yet-created page retain only the requested
-- slug. No expiry, rename, publish, or delete propagation is inferred here.
CREATE TABLE page_draft (
    page_draft_id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE,
    site_id BIGINT NOT NULL REFERENCES site(site_id) ON DELETE CASCADE,
    page_id BIGINT,
    user_id BIGINT NOT NULL REFERENCES known_user(user_id) ON DELETE CASCADE,
    slug TEXT NOT NULL CHECK (length(slug) > 0),
    title TEXT NOT NULL,
    wikitext TEXT NOT NULL,

    FOREIGN KEY (site_id, page_id) REFERENCES page(site_id, page_id)
        ON DELETE NO ACTION
);

CREATE UNIQUE INDEX page_draft_site_user_slug_unique
    ON page_draft (site_id, user_id, slug);

CREATE UNIQUE INDEX page_draft_site_user_page_unique
    ON page_draft (site_id, user_id, page_id)
    WHERE page_id IS NOT NULL;
