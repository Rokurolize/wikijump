import assert from "node:assert/strict";
import test from "node:test";

import { COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, Q778_WIKIDOT_AUTHOR, b689Scp8980CandidateFixtures, compatibilityMarkerFixtures, parseCompatibilityCandidateInputArgs } from "../src/compatibility-candidate-input-producer.mjs";

test("compatibility candidate input producer requires distinct identity-bound paths", () => {
  assert.equal(COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, "wikijump.compatibility_candidate_input_receipt.v1");
  const parsed = parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json", "--private-runtime", "runtime.json", "--template-private-dir", "template", "--output-private-dir", "output", "--receipt", "receipt.json"]);
  assert.match(parsed["candidate-identity"], /candidate\.json$/u);
  assert.notEqual(parsed["template-private-dir"], parsed["output-private-dir"]);
  assert.throws(() => parseCompatibilityCandidateInputArgs(["--candidate-identity", "candidate.json"]), /Usage/u);
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
  assert.equal(fixtures.source.slug, "scp-8980");
  assert.equal(fixtures.source.sha256, "11ecede90b114c425afc60f7f146a697bdc4ca4aaa16e23fc213d947feb86710");
  assert.deepEqual(fixtures.fragments.map(({ slug }) => slug), ["fragment:scp-8980-1", "fragment:scp-8980-2"]);
  assert.match(fixtures.source.wikitext, /ListPages parent="\." category="fragment"/u);
  assert.ok(fixtures.fragments.every(({ wikitext }) => wikitext.includes("[[include :scp-wiki:theme:basalt")));
});

test("compatibility candidate input producer owns a dedicated Wikidot Q778 author identity", () => {
  assert.deepEqual(Q778_WIKIDOT_AUTHOR, {
    user_id: 20_000_013,
    name: "Q778 Wikidot Author",
    slug: "q778-wikidot-author",
  });
});
