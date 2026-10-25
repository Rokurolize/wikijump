import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  resolveFixtureOrigins,
  SHARED_LOGICAL_ORIGIN,
} from "../src/fixture-origin.mjs";

const host = "https://scpaiueouiuiuiui.wikijump.localhost";
const task = `${host}:3396`;

test("default shared flow keeps the fixed :18443 logical and transport origin", () => {
  assert.deepEqual(
    resolveFixtureOrigins({ contractOrigin: SHARED_LOGICAL_ORIGIN }),
    { logicalOrigin: SHARED_LOGICAL_ORIGIN, origin: SHARED_LOGICAL_ORIGIN },
  );
});

test("shared contract still accepts a separate built-transport origin", () => {
  assert.deepEqual(
    resolveFixtureOrigins({
      contractOrigin: SHARED_LOGICAL_ORIGIN,
      transportOrigin: `${host}:3395`,
    }),
    { logicalOrigin: SHARED_LOGICAL_ORIGIN, origin: `${host}:3395` },
  );
});

test("task-port contract is accepted only with the matching transport origin", () => {
  assert.deepEqual(
    resolveFixtureOrigins({ contractOrigin: task, transportOrigin: task }),
    { logicalOrigin: task, origin: task },
  );
});

test("task-port contract without a transport origin keeps failing closed", () => {
  assert.throws(
    () => resolveFixtureOrigins({ contractOrigin: task }),
    /does not match the fixture target/u,
  );
});

test("mismatched task transport origin is rejected", () => {
  assert.throws(
    () =>
      resolveFixtureOrigins({
        contractOrigin: task,
        transportOrigin: `${host}:3397`,
      }),
    /does not match the fixture target/u,
  );
  assert.throws(
    () =>
      resolveFixtureOrigins({
        contractOrigin: task,
        transportOrigin: SHARED_LOGICAL_ORIGIN,
      }),
    /does not match the fixture target/u,
  );
});

test("non-HTTPS, foreign-host, credentialed, pathful, or missing origins are rejected", () => {
  for (const bad of [
    "http://scpaiueouiuiuiui.wikijump.localhost:3396",
    "https://scp-jp.wikidot.com",
    "https://evil@scpaiueouiuiuiui.wikijump.localhost:3396",
    `${task}/path`,
    `${task}?q=1`,
    "not a url",
  ]) {
    assert.throws(
      () => resolveFixtureOrigins({ contractOrigin: bad, transportOrigin: bad }),
      /(?:HTTPS|absolute)/u,
      bad,
    );
    assert.throws(
      () =>
        resolveFixtureOrigins({
          contractOrigin: SHARED_LOGICAL_ORIGIN,
          transportOrigin: bad,
        }),
      /(?:HTTPS|absolute)/u,
      bad,
    );
  }
  for (const missing of [undefined, null, ""])
    assert.throws(
      () => resolveFixtureOrigins({ contractOrigin: missing }),
      /needs target_site\.origin/u,
    );
});

test("capture-interactive resolves origins through the shared helper instead of a hard-coded check", () => {
  const source = fs.readFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../ports/interactive-visual-fixture/capture-interactive.mjs",
    ),
    "utf8",
  );
  assert.match(source, /resolveFixtureOrigins\(/u);
  assert.doesNotMatch(source, /const logicalOrigin=/u);
});
