import assert from 'node:assert/strict';
import test from 'node:test';
import {composeThemeCss} from '../src/candidate-css-composition.mjs';

test('authority overrides append by default', () => {
  assert.equal(composeThemeCss('source{}', 'override{}'), 'source{}\n\noverride{}');
});

test('appending a separate authority sheet preserves an EOF-terminated source import', () => {
  for (const source of ['@import url("theme.css")\n', "@import 'theme.css'"]) {
    assert.equal(composeThemeCss(source, 'override{}'), source.trimEnd() + ';' + source.slice(source.trimEnd().length) + '\n\noverride{}');
  }
  assert.equal(composeThemeCss('@import url(theme.css);', 'override{}'), '@import url(theme.css);\n\noverride{}');
  assert.equal(composeThemeCss('@import url(theme.css)', ''), '@import url(theme.css)');
});

test('configured override placement precedes a Wikidot code example while preserving its source bytes', () => {
  const source = 'theme{}\n@@\n:root{}\n@@';
  assert.equal(composeThemeCss(source, 'override{}', 'before-wikidot-code-fence'), 'theme{}\n\noverride{}\n\n@@\n:root{}\n@@');
});

test('configured override placement fails closed when the source fence is absent', () => {
  assert.throws(() => composeThemeCss('theme{}', 'override{}', 'before-wikidot-code-fence'), /boundary is missing/u);
});
