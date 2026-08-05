import assert from "node:assert/strict";
import test from "node:test";

import {localCanonicalDom, localVisibleText} from "../src/local-output-comparison.mjs";
import {canonicalDom, visibleText} from "../src/syntax-differential.mjs";

const rawEmail = '<span class="wiki-email">moc.elpmaxe|cba#moc.elpmaxe|cba</span>';
const visibleEmail = '<span class="wiki-email" style="visibility: visible;"><a href="mailto:abc@example.com">abc@example.com</a></span>';

test("local email comparison does not turn hidden raw markup into visible parity", () => {
  assert.notEqual(localVisibleText(rawEmail), visibleText(rawEmail));
  assert.notDeepEqual(localCanonicalDom(rawEmail), canonicalDom(rawEmail));
});

test("local email comparison accepts the visible anchor emitted by Wikijump", () => {
  assert.equal(localVisibleText(visibleEmail), visibleText(rawEmail));
  assert.deepEqual(localCanonicalDom(visibleEmail), canonicalDom(rawEmail));
});
