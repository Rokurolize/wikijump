ALTER TABLE page_vote
    DROP CONSTRAINT page_vote_page_id_user_id_deleted_at_key;

WITH duplicate_current_votes AS (
    SELECT page_vote_id,
           ROW_NUMBER() OVER (
               PARTITION BY page_id, user_id, rating_system
               ORDER BY page_vote_id DESC
           ) AS ordinal
    FROM page_vote
    WHERE deleted_at IS NULL
)
UPDATE page_vote AS vote
SET deleted_at = NOW()
FROM duplicate_current_votes AS duplicate
WHERE vote.page_vote_id = duplicate.page_vote_id
  AND duplicate.ordinal > 1;

CREATE UNIQUE INDEX page_vote_current_unique
    ON page_vote (page_id, user_id, rating_system)
    WHERE deleted_at IS NULL;
