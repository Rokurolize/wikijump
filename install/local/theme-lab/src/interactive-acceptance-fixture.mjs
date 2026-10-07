export const ORDINARY_MAIN_FIXTURE_SLUG = 'run-owned:theme-lab-visual-acceptance-imported-20260924';
export const HISTORY_FIXTURE_SLUG = 'run-owned:theme-lab-visual-history-20260924';

const MIGRATION_MAIN_CREDIT_SURFACES = new Set([
  'credit.default',
  'credit.view',
  'credit.otherwise',
  'credit.close-back',
]);

export function interactiveAcceptanceFixture(spec, migrationFixture = null) {
  if (spec.fixtureSlug) return spec.fixtureSlug;
  if (spec.surface === 'page.history') return HISTORY_FIXTURE_SLUG;
  if (!migrationFixture) return ORDINARY_MAIN_FIXTURE_SLUG;

  const usesMigrationMain = spec.surface === 'page.normal' ||
    spec.surface.startsWith('nav.') ||
    spec.surface.startsWith('shell.') ||
    MIGRATION_MAIN_CREDIT_SURFACES.has(spec.surface);

  return usesMigrationMain ? migrationFixture.main_slug : ORDINARY_MAIN_FIXTURE_SLUG;
}
