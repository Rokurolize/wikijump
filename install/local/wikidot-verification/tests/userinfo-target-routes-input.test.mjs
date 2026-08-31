import assert from "node:assert/strict";
import test from "node:test";

import {validateRouteTarget, validateUserInfoUrl} from "../scripts/capture-userinfo-target-routes.mjs";

test("UserInfo targets cannot escape their single path segment", () => {
  assert.equal(validateRouteTarget("dr-clef"), "dr-clef");
  assert.equal(validateRouteTarget("-1"), "-1");
  for (const value of ["../admin", "foo/bar", "foo?next=/admin", "%2fadmin", ""]) assert.throws(() => validateRouteTarget(value));
});

test("UserInfo redirects remain on the declared origin and route", () => {
  assert.equal(validateUserInfoUrl("https://www.wikidot.com/user:info/dr-clef").pathname, "/user:info/dr-clef");
  for (const value of [
    "https://evil.example/user:info/dr-clef",
    "https://www.wikidot.com/account/messages",
    "https://www.wikidot.com/user:info/dr-clef/extra",
    "https://www.wikidot.com/user:info/../account/messages"
  ]) assert.throws(() => validateUserInfoUrl(value));
});
