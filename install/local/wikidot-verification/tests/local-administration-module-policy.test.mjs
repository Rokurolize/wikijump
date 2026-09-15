import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8"),
  );
}

test("site utility module consumer has no remote mutation transport", () => {
  const source = fs.readFileSync(
    path.join(
      repositoryRoot,
      "deepwell/src/services/render/site_utility_modules.rs",
    ),
    "utf8",
  );
  for (const module of ["Clone", "PetitionAdmin", "SiteGrid"]) {
    assert.match(source, new RegExp(`\\b${module}\\b`));
  }
  assert.doesNotMatch(source, /reqwest|hyper::|ureq|ajax-module-connector|wikidot\.com/i);
});

test("retained #1038 PetitionAdmin evidence stays read-only and actor-bound", () => {
  const evidence = readJson(
    "install/local/wikidot-verification/artifacts/open43-readonly-live-20260810.json",
  );
  const rule = evidence.general_rules.find(
    ({ evidence_id }) => evidence_id === "E_OPEN43_AUTH_ADMIN_BOUNDARY_20260810",
  );
  assert.ok(rule, "retained #1038 actor-boundary evidence is required");
  assert.equal(evidence.mutated, false);
  assert.deepEqual(
    rule.case_ids.filter((caseId) => caseId.includes("petitionadmin")),
    [
      "a1038-petitionadmin-actor-a",
      "a1038-petitionadmin-actor-b",
      "a1038-petitionadmin-actor-c",
    ],
  );
  assert.equal(rule.positive_controls, 3);
  assert.equal(rule.negative_controls, 6);
  assert.match(rule.observation, /administrator.*PetitionAdmin/u);
  assert.match(rule.observation, /permission error/u);
});
