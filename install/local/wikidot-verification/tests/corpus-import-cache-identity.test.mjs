import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {batchShellCreatePageValues} from "../scripts/apply-corpus-import-manifest.mjs";
import {buildCorpusImportManifest} from "../src/corpus-import-manifest.mjs";
import {writeSourceBundlePage} from "./support/corpus-import-manifest-fixture.mjs";

test("batch shell values keep duplicate slugs on their source entity hash keys", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "corpus-cache-identity-"));
  const entityIds = [
    "00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002",
  ];
  writeSourceBundlePage(root, "first", {entityId: entityIds[0], source: "first source"});
  writeSourceBundlePage(root, "second", {entityId: entityIds[1], source: "second source"});
  const rows = buildCorpusImportManifest({sourceBundleRoot: root, sourceSite: "scp-wiki", sourceBranch: "en"});
  rows.forEach((row) => { row.fullname = "duplicate"; });
  const seenKeys = [];

  batchShellCreatePageValues({}, rows, {
    categoryIds: new Map([["_default", 701]]),
    sourceTextEntityIds: new Set(entityIds),
    textHash: (_args, _contents, cacheKey) => {
      seenKeys.push(cacheKey);
      return "11".repeat(16);
    },
    shellHash: () => "22".repeat(16),
  });

  assert.deepEqual(seenKeys, entityIds);
});
