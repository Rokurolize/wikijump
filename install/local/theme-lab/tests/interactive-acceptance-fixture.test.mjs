import assert from 'node:assert/strict';
import test from 'node:test';

import {interactiveAcceptanceFixture,ORDINARY_MAIN_FIXTURE_SLUG,HISTORY_FIXTURE_SLUG} from '../src/interactive-acceptance-fixture.mjs';

const migrationFixture = {
  main_slug: 'run-owned:sigma10-main',
  top_slug: 'run-owned:sigma10-nav-top',
  side_slug: 'run-owned:sigma10-nav-side',
};

test('Sigma-10 base credit states use the saved-page migration fixture', () => {
  for (const surface of ['credit.default', 'credit.view', 'credit.otherwise', 'credit.close-back']) {
    assert.equal(interactiveAcceptanceFixture({surface}, migrationFixture), migrationFixture.main_slug, surface);
  }
});

test('migration browser capture keeps shell states and explicit diagnostic variants scoped', () => {
  assert.equal(interactiveAcceptanceFixture({surface: 'page.normal'}, migrationFixture), migrationFixture.main_slug);
  assert.equal(interactiveAcceptanceFixture({surface: 'nav.mobile-top'}, migrationFixture), migrationFixture.main_slug);
  assert.equal(interactiveAcceptanceFixture({surface: 'shell.header'}, migrationFixture), migrationFixture.main_slug);
  assert.equal(
    interactiveAcceptanceFixture({surface: 'credit.variant.no-rate', fixtureSlug: 'run-owned:credit-no-rate-diagnostic'}, migrationFixture),
    'run-owned:credit-no-rate-diagnostic',
  );
  assert.equal(interactiveAcceptanceFixture({surface: 'page.history'}, migrationFixture), HISTORY_FIXTURE_SLUG);
});

test('ordinary acceptance retains its existing fixture routing', () => {
  assert.equal(interactiveAcceptanceFixture({surface: 'credit.default'}), ORDINARY_MAIN_FIXTURE_SLUG);
  assert.equal(
    interactiveAcceptanceFixture({surface: 'credit.variant.heritage', fixtureSlug: 'run-owned:credit-heritage-diagnostic'}),
    'run-owned:credit-heritage-diagnostic',
  );
});

test('effective ordinary History identity names the page actually navigated',()=>{
  assert.equal(interactiveAcceptanceFixture({surface:'page.history'}),HISTORY_FIXTURE_SLUG);
  assert.equal(interactiveAcceptanceFixture({surface:'page.source'}),ORDINARY_MAIN_FIXTURE_SLUG);
});
