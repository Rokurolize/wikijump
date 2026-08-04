import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const readJson = (relativePath) => JSON.parse(fs.readFileSync(relativePath, "utf8"));

test("legacy frontend manifests stay on the Svelte 4 component API", () => {
  for (const relativePath of ["web/package.json", "web/resources/package.json"]) {
    const manifest = readJson(relativePath);
    assert.match(
      manifest.dependencies?.svelte ?? "",
      /^\^4\./u,
      `${relativePath} must select Svelte 4 for new Component/$set/$destroy/$on usage`,
    );
  }
});
