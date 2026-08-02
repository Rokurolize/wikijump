import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import {fileURLToPath} from "node:url";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const START_SCRIPT = path.resolve(PACKAGE_ROOT, "..", "deepwell", "deepwell-start");

test("deepwell cargo-watch selects the compact, debugging, and release profiles", () => {
  const syntax = spawnSync("/bin/sh", ["-n", START_SCRIPT], {encoding: "utf8"});
  assert.equal(syntax.status, 0, syntax.stderr);

  const source = readFileSync(START_SCRIPT, "utf8");
  assert.match(source, /debugging\)\n\s+RUN_COMMAND="run --locked --profile debugging -- \/etc\/deepwell\.toml"/u);
  assert.match(source, /release\)\n\s+RUN_COMMAND="run --locked --release -- \/etc\/deepwell\.toml"/u);
  assert.match(source, /\*\)\n\s+echo "Unsupported DEEPWELL_BUILD_PROFILE/u);
  assert.match(source, /-w \/src\/\.cargo\/config\.toml/u);
  assert.match(source, /^ {8}-x "\$RUN_COMMAND"$/mu);
});

test("wws cargo-watch selects the compact, debugging, and release profiles", () => {
  const wwsStart = path.resolve(PACKAGE_ROOT, "..", "wws", "wws-start");
  const syntax = spawnSync("/bin/sh", ["-n", wwsStart], {encoding: "utf8"});
  assert.equal(syntax.status, 0, syntax.stderr);

  const source = readFileSync(wwsStart, "utf8");
  assert.match(source, /debugging\)\n\s+RUN_COMMAND="run --locked --profile debugging -- --disable-deepwell-check"/u);
  assert.match(source, /release\)\n\s+RUN_COMMAND="run --locked --release -- --disable-deepwell-check"/u);
  assert.match(source, /\*\)\n\s+echo "Unsupported WWS_BUILD_PROFILE/u);
  assert.match(source, /-w \/src\/\.cargo\/config\.toml/u);
});
