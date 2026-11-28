DROP INDEX IF EXISTS user_email_active_unique_idx;

DO $$
DECLARE
    displaced_count BIGINT;
    total_displaced BIGINT := 0;
BEGIN
    LOOP
        WITH ranked_live_users AS (
            SELECT
                "user".user_id,
                ROW_NUMBER() OVER (
                    PARTITION BY lower(normalize("user".email, nfkc))
                    ORDER BY "user".user_id ASC
                ) AS ordinal
            FROM "user"
            WHERE "user".user_type = 'regular'
              AND "user".deleted_at IS NULL
              AND "user".email <> ''
        )
        UPDATE "user"
        SET email = 'duplicate-' || ranked_live_users.user_id || '@invalid',
            email_verified_at = NULL
        FROM ranked_live_users
        WHERE "user".user_id = ranked_live_users.user_id
          AND ranked_live_users.ordinal > 1;

        GET DIAGNOSTICS displaced_count = ROW_COUNT;
        total_displaced := total_displaced + displaced_count;
        EXIT WHEN displaced_count = 0;
    END LOOP;

    IF total_displaced > 0 THEN
        RAISE NOTICE 'user_email_nfkc_active_unique: displaced % duplicate live user email claim(s)', total_displaced;
    END IF;
END $$;

CREATE UNIQUE INDEX user_email_active_unique_idx
    ON "user" (lower(normalize(email, nfkc)))
    WHERE user_type = 'regular'
      AND deleted_at IS NULL
      AND email <> '';
