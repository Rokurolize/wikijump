-- NULL values are distinct in an ordinary unique index. Keep a separate
-- current-row constraint so concurrent membership/application transitions
-- cannot create two active relations for the same actor and site.
CREATE UNIQUE INDEX relation_unique_general_current
    ON relation (relation_type, dest_type, dest_id, from_type, from_id)
    WHERE relation_type <> 'page-attribution'
        AND overwritten_at IS NULL
        AND deleted_at IS NULL;
