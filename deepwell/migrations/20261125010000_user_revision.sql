ALTER TABLE "user"
    ADD COLUMN revision BIGINT NOT NULL DEFAULT 0
        CHECK (revision >= 0);
