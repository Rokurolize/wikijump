ALTER TABLE site
    ADD COLUMN access_policy TEXT NOT NULL DEFAULT 'open'
        CHECK (access_policy IN ('open', 'closed', 'private'));
