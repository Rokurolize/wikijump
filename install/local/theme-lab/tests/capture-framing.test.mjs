import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const source = fs.readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../ports/interactive-visual-fixture/capture-interactive.mjs",
  ),
  "utf8",
);
const specLine = (surface, state) => {
  const needle = `surface:'${surface}',state:'${state}'`;
  const line = source.split("\n").find((row) => row.includes(needle));
  assert.ok(line, `${surface}.${state} spec`);
  return line;
};

test("credit default states scroll the real credit control into frame before capture", () => {
  assert.match(specLine("credit.default", "normal"), /revealCreditControl\(p\)/u);
  const variants = source.split("\n").find((row) => row.includes("state:'default',fixtureSlug:variant.slug"));
  assert.ok(variants);
  assert.match(variants, /revealCreditControl\(p\)/u);
  const helper = source.slice(source.indexOf("async function revealCreditControl"), source.indexOf("async function revealBelowFixedMobileNavigation"));
  assert.match(helper, /\.creditButton a:visible/u);
  assert.match(helper, /scrollIntoViewIfNeeded/u);
  assert.match(helper, /revealBelowFixedMobileNavigation/u);
});

test("the new credit helper is part of the action contract only for the states that use it", () => {
  // Unconditional keys would re-hash every other state's action contract.
  assert.match(source, /if\(actionSource\.includes\('revealCreditControl'\)\)contract\.revealCreditControl=revealCreditControl\.toString\(\)/u);
  assert.match(source, /revealBelowFixedMobileNavigation:actionSource\.includes\('revealBelowFixedMobileNavigation'\)\|\|actionSource\.includes\('revealCreditControl'\)/u);
  assert.doesNotMatch(source, /\n  revealCreditControl:/u);
});

test("expanded collapsible and footer-license states park the pointer after scrolling so the hamburger hover flyout is not left open", () => {
  for (const [surface, state] of [["content.collapsible", "expanded"], ["shell.footer-license", "scrolled-bottom"]]) {
    const line = specLine(surface, state);
    assert.match(line, /await movePointerToSafeArea\(p\);await settleFiniteVisualTransitions\(p\)\}\},$/u, `${surface}.${state}`);
  }
});

test("search state keeps recording the hidden-input observation and binds the frozen source authority when present", () => {
  const search = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/search-control-action.mjs"), "utf8");
  assert.match(search, /mode: 'source-hidden-submit'/u);
  assert.match(search, /source_authority: sourceAuthority/u);
  assert.match(source, /evidence\/search-controls-20261001\/\$\{theme\}\.json/u);
});
