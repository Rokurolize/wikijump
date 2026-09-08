ALTER TABLE page_revision
    DROP CONSTRAINT page_revision_changes_check;

ALTER TABLE page_revision
    ADD CONSTRAINT page_revision_changes_check
    CHECK (changes <@ '{
        wikitext,
        title,
        alt_title,
        slug,
        tags,
        parent
    }');
