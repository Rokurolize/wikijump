-- A UNIQUE (slug, deleted_at) constraint does not protect live sites because
-- PostgreSQL treats NULL values as distinct. Reconcile any existing live
-- duplicates before adding the invariant that creation and rename expect.
--
-- The earliest live holder (lowest site ID) keeps the slug; later duplicates
-- are displaced to "<slug>-<site_id>". Repeat until no live duplicates
-- remain: a displaced slug can itself collide with a pre-existing slug of
-- that exact suffixed form, and such a row is displaced again in turn.
DO $$
DECLARE
    displaced_count BIGINT;
    total_displaced BIGINT := 0;
BEGIN
    LOOP
        WITH ranked_live_sites AS (
            SELECT
                site.site_id,
                site.slug,
                ROW_NUMBER() OVER (
                    PARTITION BY site.slug
                    ORDER BY site.site_id ASC
                ) AS ordinal
            FROM site
            WHERE site.deleted_at IS NULL
        )
        UPDATE site
        SET slug = ranked_live_sites.slug || '-' || ranked_live_sites.site_id
        FROM ranked_live_sites
        WHERE site.site_id = ranked_live_sites.site_id
          AND ranked_live_sites.ordinal > 1;

        GET DIAGNOSTICS displaced_count = ROW_COUNT;
        total_displaced := total_displaced + displaced_count;
        EXIT WHEN displaced_count = 0;
    END LOOP;

    IF total_displaced > 0 THEN
        RAISE NOTICE 'site_slug_active_unique: displaced % duplicate live site slug(s)', total_displaced;
    END IF;
END $$;

CREATE UNIQUE INDEX site_slug_active_unique_idx
    ON site (slug)
    WHERE deleted_at IS NULL;
