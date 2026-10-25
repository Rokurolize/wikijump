import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("attachment provisioning prefers the explicit upload button over the legacy Restore match", () => {
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../ports/interactive-visual-fixture/provision-file.mjs",
    ),
    "utf8",
  );
  // The legacy `.file-panel .buttons input[type=button]` selector also matches
  // the Restore button, which precedes #show-upload-button in the DOM.
  assert.match(source, /page\.locator\('#show-upload-button'\)/u);
  assert.match(source, /await showUpload\.count\(\)\?showUpload:/u);
});
