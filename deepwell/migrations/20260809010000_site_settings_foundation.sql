ALTER TABLE site
    ADD COLUMN settings_revision BIGINT NOT NULL DEFAULT 0
        CHECK (settings_revision >= 0),
    ADD COLUMN welcome_page TEXT NOT NULL DEFAULT 'system:welcome'
        CHECK (welcome_page != ''),
    ADD COLUMN google_analytics_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN google_analytics_profile TEXT
        CHECK (google_analytics_profile ~ '^UA-[0-9]+-[0-9]+$'),
    ADD COLUMN show_top_toolbar BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN show_bottom_toolbar BOOLEAN NOT NULL DEFAULT false,
    ADD CONSTRAINT site_google_analytics_enabled_profile
        CHECK (NOT google_analytics_enabled OR google_analytics_profile IS NOT NULL);

ALTER TABLE page_category
    ADD COLUMN settings_revision BIGINT NOT NULL DEFAULT 0
        CHECK (settings_revision >= 0),
    ADD COLUMN theme_kind TEXT NOT NULL DEFAULT 'inherit'
        CHECK (theme_kind IN ('inherit', 'built_in', 'external', 'custom')),
    ADD COLUMN theme_builtin_id BIGINT CHECK (theme_builtin_id > 0),
    ADD COLUMN theme_external_url TEXT,
    ADD COLUMN theme_custom_css TEXT CHECK (length(theme_custom_css) <= 65535),
    ADD COLUMN autonumber_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN autonumber_next BIGINT NOT NULL DEFAULT 1
        CHECK (autonumber_next > 0),
    ADD CONSTRAINT page_category_theme_value_shape CHECK (
        (theme_kind = 'inherit' AND theme_builtin_id IS NULL AND theme_external_url IS NULL AND theme_custom_css IS NULL)
        OR (theme_kind = 'built_in' AND theme_builtin_id IS NOT NULL AND theme_external_url IS NULL AND theme_custom_css IS NULL)
        OR (theme_kind = 'external' AND theme_builtin_id IS NULL AND theme_external_url IS NOT NULL AND theme_custom_css IS NULL)
        OR (theme_kind = 'custom' AND theme_builtin_id IS NULL AND theme_external_url IS NULL AND theme_custom_css IS NOT NULL)
    );
