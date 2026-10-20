-- Mirror scope and completeness record (issue #2085).
--
-- One row per site mirrored as a compatibility mirror. Records whether the
-- mirror claims a full public corpus or a declared partial set, the source
-- pin it was reconciled against, and the slug sets that let diagnostics
-- distinguish "not imported" from "source page does not exist": declared
-- extras are non-corpus slugs kept deliberately (seed/system pages), and
-- consumed slugs are renamed-away slugs that later passes must never
-- recreate. Refresh tooling reads and writes this row; dynamic query
-- runtimes keep reading page rows unchanged.

CREATE TABLE mirror_scope (
    site_id BIGINT PRIMARY KEY REFERENCES site (site_id) ON DELETE CASCADE,
    scope TEXT NOT NULL
        CHECK (scope IN ('full', 'partial')),
    source_pin TEXT,
    inventoried_source_count BIGINT NOT NULL DEFAULT 0
        CHECK (inventoried_source_count >= 0),
    declared_extras TEXT[] NOT NULL DEFAULT '{}',
    consumed_slugs TEXT[] NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
