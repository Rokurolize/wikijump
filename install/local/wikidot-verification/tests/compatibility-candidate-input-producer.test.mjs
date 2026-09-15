import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, Q778_WIKIDOT_AUTHOR, S758_AUTONUMBER_CANDIDATE_PRECONDITION, b689BasaltUserFixtures, b689Scp8980CandidateFixtures, b689Scp8980UserFixtures, bindS758AutonumberFixture, compatibilityMarkerFixtures, parseCompatibilityCandidateInputArgs, validateS758AutonumberCandidateCategory } from "../src/compatibility-candidate-input-producer.mjs";

test("compatibility candidate input producer requires distinct identity-bound paths", () => {
  assert.equal(COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, "wikijump.compatibility_candidate_input_receipt.v1");
  const parsed = parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json", "--private-runtime", "runtime.json", "--template-private-dir", "template", "--output-private-dir", "output", "--receipt", "receipt.json", "--b690-attachments-dir", "attachments"]);
  assert.match(parsed["candidate-identity"], /candidate\.json$/u);
  assert.notEqual(parsed["template-private-dir"], parsed["output-private-dir"]);
  assert.throws(() => parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json"]), /Usage/u);
});

test("S758 producer binds a fresh disabled allocator and rejects reused state", () => {
  assert.deepEqual(S758_AUTONUMBER_CANDIDATE_PRECONDITION, {
    schema: "wikijump.open43.s758_autonumber_candidate_precondition.v1",
    site_slug: "scpaiueouiuiuiui",
    category_role: "transition_category",
    enabled: false,
    next: 1,
    cleanup_owner: "disposable_candidate_stack",
  });
  const category = { category_id: 73, slug: "corpus", autonumber_enabled: false, autonumber_next: 1, settings_revision: 0 };
  assert.deepEqual(validateS758AutonumberCandidateCategory(category), category);
  const input = { fixture: { transition_category: { category_id: 73, slug: "corpus", page_id: 71, page_slug: "corpus:scp-9506-draft" } } };
  assert.equal(bindS758AutonumberFixture(input, category), true);
  assert.deepEqual(input.fixture.autonumber_category, { ...input.fixture.transition_category, autonumber_enabled: false, autonumber_next: 1, settings_revision: 0 });
  assert.throws(() => validateS758AutonumberCandidateCategory({ ...category, autonumber_next: 2 }), /fresh disabled precondition/u);
  assert.throws(() => bindS758AutonumberFixture({ fixture: { transition_category: {} } }, { ...category, autonumber_enabled: true }), /fresh disabled precondition/u);
});

test("candidate input cleanup preserves the RSMQ job namespace", () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/compatibility-candidate-input-producer.mjs"), "utf8");
  assert.doesNotMatch(source, /FLUSHALL/u);
  assert.match(source, /string\.sub\(key,1,5\) ~= 'rsmq:'/u);
});

test("compatibility candidate input producer binds the exact five FTML marker fixtures", () => {
  const fixtures = compatibilityMarkerFixtures({
    schema: "wikijump.ftml_marker_contract_fixtures.v1",
    site_slug: "scp-wiki",
    layout: "wikidot",
    fixtures: ["heading", "separator", "div", "span", "alignment"].map((name) => ({
      fixture_id: `marker-${name}`,
      slug: `marker-canary-${name}`,
      title: `Marker ${name}`,
      wikitext: `MARKER_${name.toUpperCase()}\n`,
    })),
  });
  assert.equal(fixtures.length, 5);
  assert.deepEqual(fixtures.map(({ slug }) => slug), [
    "marker-canary-heading",
    "marker-canary-separator",
    "marker-canary-div",
    "marker-canary-span",
    "marker-canary-alignment",
  ]);
  assert.throws(() => compatibilityMarkerFixtures({ schema: "wikijump.ftml_marker_contract_fixtures.v1", site_slug: "scp-wiki", layout: "wikidot", fixtures: [] }), /denominator drifted/u);
});

test("compatibility candidate input producer owns the exact B689 SCP-8980 source graph", async () => {
  const fixtures = await b689Scp8980CandidateFixtures();
  assert.equal(fixtures.theme.slug, "theme:basalt");
  assert.deepEqual(fixtures.theme.tags, ["theme"]);
  assert.equal(fixtures.theme.sha256, "a29d8d0f285f4e291975f0139519ddfb472e7d6f458bb1d7c14189c9a2e922c0");
  assert.equal(fixtures.source.slug, "scp-8980");
  assert.equal(fixtures.source.sha256, "11ecede90b114c425afc60f7f146a697bdc4ca4aaa16e23fc213d947feb86710");
  assert.equal(fixtures.source.tags.length, 24);
  assert.deepEqual(fixtures.fragments.map(({ slug }) => slug), ["fragment:scp-8980-1", "fragment:scp-8980-2"]);
  assert.deepEqual(fixtures.fragments.map(({ rating }) => rating), [1559, 1559]);
  assert.deepEqual(fixtures.fragments.map(({ tags }) => tags), [["fragment"], ["fragment"]]);
  assert.match(fixtures.source.wikitext, /ListPages parent="\." category="fragment"/u);
  assert.ok(fixtures.fragments.every(({ wikitext }) => wikitext.includes("[[include :scp-wiki:theme:basalt")));
});

test("compatibility candidate input producer owns the retained B689 Basalt users", async () => {
  assert.deepEqual(await b689BasaltUserFixtures(), [
    {
      user_id: 3_781_861,
      name: "EstrellaYoshte",
      slug: "estrellayoshte",
      captured_at: "2026-08-11T23:48:23.973Z",
    },
    {
      user_id: 6_254_643,
      name: "Liryn",
      slug: "liryn",
      captured_at: "2026-08-11T23:48:23.973Z",
    },
    {
      user_id: 6_536_693,
      name: "Placeholder McD",
      slug: "placeholder-mcd",
      captured_at: "2026-08-11T23:48:23.973Z",
    },
  ]);
});

test("compatibility candidate input producer owns the retained B689 SCP-8980 author", async () => {
  assert.deepEqual(await b689Scp8980UserFixtures(), [
    {
      user_id: 2_199_269,
      name: "Yossipossi",
      slug: "yossipossi",
      captured_at: "2026-07-15T06:18:01.000Z",
    },
  ]);
});

test("compatibility candidate input producer binds the retained Wikidot favicon route fixture", () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/compatibility-candidate-input-producer.mjs"), "utf8");
  assert.match(source, /favicon_source='https:\/\/scp-wiki\.wdfiles\.com\/local--files\/site\/favicon\.gif'/u);
  assert.match(source, /update site set from_wikidot=true,favicon_source=.*where site_id=\$\{standardSiteId\}/u);
  assert.match(source, /update page set from_wikidot=true where page_id=\$\{b610Page\.page_id\}/u);
  assert.match(source, /update page set from_wikidot=true where page_id=\$\{prior\.page_id\}/u);
});

test("compatibility candidate input producer verifies retained media evidence before publication", () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/compatibility-candidate-input-producer.mjs"), "utf8");
  assert.match(source, /const evidenceBytes = await fs\.readFile\(evidence\.path\)/u);
  assert.match(source, /sha256\(evidenceBytes\) !== evidence\.sha256/u);
  assert.match(source, /cases: mediaCases/u);
});

test("compatibility candidate input producer seeds the SearchAll saved-page fixture", () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/compatibility-candidate-input-producer.mjs"), "utf8");
  assert.match(source, /slug: "search:all"[\s\S]*?wikitext: "\[\[module SearchAll\]\]"/u);
  assert.match(source, /page\(Q807_SEARCH_ALL_SOURCE\.slug, Q807_SEARCH_ALL_SOURCE\.title, Q807_SEARCH_ALL_SOURCE\.wikitext, \{ imported: true \}\)/u);
  assert.doesNotMatch(source, /page\(Q807_SEARCH_ALL_SOURCE\.slug, Q807_SEARCH_ALL_SOURCE\.title, Q807_SEARCH_ALL_SOURCE\.wikitext, \{ siteId: standardSiteId/u);
});

test("compatibility candidate input producer owns a dedicated Wikidot Q778 author identity", () => {
  assert.deepEqual(Q778_WIKIDOT_AUTHOR, {
    user_id: 20_000_013,
    name: "Q778 Wikidot Author",
    slug: "q778-wikidot-author",
  });
});
