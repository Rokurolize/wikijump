CREATE INDEX forum_thread_site_created_feed_idx
    ON forum_thread (site_id, created_at DESC, forum_thread_id DESC)
    WHERE deleted_at IS NULL;

CREATE INDEX forum_post_site_created_feed_idx
    ON forum_post (site_id, created_at DESC, forum_post_id DESC)
    WHERE deleted_at IS NULL;
