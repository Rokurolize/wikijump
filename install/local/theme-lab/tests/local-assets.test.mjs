import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {inspectCandidateAssets, materializeCandidateCssAssets} from "../src/local-assets.mjs";

test("candidate CSS inlines only regular local assets and reports missing names", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "theme-lab-assets-"));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  await fs.writeFile(path.join(dir, "paper.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await fs.symlink("paper.png", path.join(dir, "linked.png"));
  const css = '.paper{background:url("./assets/paper.png")} .missing{background:url("./assets/absent.png")} .linked{background:url("./assets/linked.png")}';
  assert.deepEqual(await inspectCandidateAssets(css, dir), {referenced: 3, missing: ["absent.png", "linked.png"]});
  const materialized = await materializeCandidateCssAssets(css, dir);
  assert.match(materialized, /url\("data:image\/png;base64,iVBORw=="\)/u);
  assert.match(materialized, /url\("\.\/assets\/absent\.png"\)/u);
  assert.match(materialized, /url\("\.\/assets\/linked\.png"\)/u);
  await assert.rejects(() => inspectCandidateAssets('.x{background:url("./assets/../secret")}', dir), /invalid candidate asset/u);
});
