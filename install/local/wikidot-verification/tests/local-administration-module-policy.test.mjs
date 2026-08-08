import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

function files(root) {
  const output = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...files(file));
    else if (entry.name.endsWith(".rs")) output.push(file);
  }
  return output;
}

test("cross-site administration modules ship no remote mutation URL", () => {
  const relevant = files("deepwell/src").filter((file) =>
    /clone|site_grid|runtime_module|module/i.test(file),
  );
  const source = relevant.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const module of ["Clone", "PetitionAdmin", "SiteGrid"]) {
    if (!source.includes(module)) continue;
    assert.doesNotMatch(
      source,
      new RegExp(`${module}[\\s\\S]{0,1600}https?://(?:www\\.)?wikidot\\.com`, "i"),
    );
  }
});
