ALTER TABLE site
    ADD COLUMN membership_by_application BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN membership_by_password BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN membership_password_hash TEXT;
