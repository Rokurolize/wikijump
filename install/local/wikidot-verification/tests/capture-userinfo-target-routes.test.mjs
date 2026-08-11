import assert from "node:assert/strict";
import test from "node:test";

import {decodeHtml} from "../scripts/capture-userinfo-target-routes.mjs";

test("UserInfo evidence decodes HTML entities exactly once", () => {
  assert.equal(decodeHtml("&lt;profile&gt;"), "<profile>");
  assert.equal(decodeHtml("&amp;lt;profile&amp;gt;"), "&lt;profile&gt;");
});
