const MIGRATION_MAIN_CREDIT_SURFACES = new Set([
  'credit.default',
  'credit.view',
  'credit.otherwise',
  'credit.close-back',
]);

export function interactiveAcceptanceFixture(spec, migrationFixture = null) {
  if (spec.fixtureSlug) return spec.fixtureSlug;
  if (!migrationFixture) return null;

  const usesMigrationMain = spec.surface === 'page.normal' ||
    spec.surface.startsWith('nav.') ||
    spec.surface.startsWith('shell.') ||
    MIGRATION_MAIN_CREDIT_SURFACES.has(spec.surface);

  return usesMigrationMain ? migrationFixture.main_slug : null;
}
