import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  framerailEnvLabel,
  parseFramerailEnvOption,
} from "../src/framerail-env-option.mjs";
import { FILES_PANE } from "../src/files-pane-selectors.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const project = "wikijump-theme-lab-basalt-current-20261022";

test("framerail env override is opt-in, task-owned only, and limited to known environments", () => {
  assert.equal(parseFramerailEnvOption({ backendProject: project }), null);
  assert.equal(framerailEnvLabel(null), "image-default");
  for (const value of ["local", "dev", "prod"]) {
    assert.equal(parseFramerailEnvOption({ framerailEnv: value, backendProject: project }), value);
    assert.equal(framerailEnvLabel(value), value);
  }
  assert.throws(() => parseFramerailEnvOption({ framerailEnv: "prod" }), /task-owned/u);
  for (const bad of ["production", "", "LOCAL", "staging"])
    assert.throws(() => parseFramerailEnvOption({ framerailEnv: bad, backendProject: project }), /local, dev, or prod/u, bad);
});

test("ensure-built-framerail applies and labels the override and treats a different env as different provenance", () => {
  const source = fs.readFileSync(
    path.join(here, "../ports/interactive-visual-fixture/ensure-built-framerail.mjs"),
    "utf8",
  );
  assert.match(source, /parseFramerailEnvOption\(/u);
  assert.match(source, /FRAMERAIL_ENV=\$\{framerailEnv\}/u);
  assert.match(source, /theme-lab\.framerail-env=\$\{envLabel\}/u);
  assert.match(source, /currentEnvLabel===envLabel/u);
});

test("Files pane capture waits for the Wikidot PageFilesModule table and never the native or empty pane", () => {
  assert.equal(FILES_PANE.table, "#action-area table.page-files");
  assert.equal(FILES_PANE.row, "#action-area table.page-files tr[id^='file-row-']");
  const capture = fs.readFileSync(
    path.join(here, "../ports/interactive-visual-fixture/capture-interactive.mjs"),
    "utf8",
  );
  for (const state of ["list", "horizontal-actions"]) {
    const line = capture.split("\n").find((row) => row.includes(`surface:'page.files',state:'${state}'`));
    assert.ok(line, state);
    assert.match(line, /waitFor\(\)/u);
    assert.match(line, /FILES_PANE\.table/u);
    assert.match(line, /FILES_PANE\.row\)\.filter\(\{hasText:'theme-lab-visual-fixture_/u);
    assert.doesNotMatch(line, /\.file-row|'\.file-list'/u);
  }
  const gate = fs.readFileSync(path.join(here, "../src/visual-gate.mjs"), "utf8");
  assert.match(gate, /page\.files\.list'\)return \['table\.page-files'\]/u);
});
