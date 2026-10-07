import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

import {playwrightBrowserVersions} from '../src/playwright-browser-versions.mjs';

test('browser freshness versions come from the installed Playwright registry without launching a browser',()=>{
  const here=path.dirname(fileURLToPath(import.meta.url));
  const versions=playwrightBrowserVersions(path.resolve(here,'../../../../framerail'));
  assert.match(versions.chromium,/^\d+(?:\.\d+)+$/u);
  assert.match(versions.firefox,/^\d+(?:\.\d+)+$/u);
  assert.match(versions.webkit,/^\d+(?:\.\d+)+$/u);
});
