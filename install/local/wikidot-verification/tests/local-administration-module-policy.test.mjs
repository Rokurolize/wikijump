import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

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
