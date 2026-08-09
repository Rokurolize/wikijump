import assert from "node:assert/strict";
import test from "node:test";

import { escapeMarkdownTableCell } from "../../scripts/lib/markdown.mjs";

test("markdown table cells escape backslashes before pipes", () => {
  assert.equal(escapeMarkdownTableCell(String.raw`alpha\|beta|gamma`), String.raw`alpha\\\|beta\|gamma`);
});

