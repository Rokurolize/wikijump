import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFixtureTombstoneManifest,
  buildSeedIndex,
  classifyMirrorFileRow,
} from "../src/mirror-fixture-file-audit.mjs";

const SEEDER = {
  "scp-wiki": {
    "scp-002": [
      {name: "800px-SCP002-new.jpg", path: "scp-002--800px-SCP002-new.jpg"},
      {name: "SCP.txt", path: "scp-main.ftml", overwrite: "scp-002.ftml"},
    ],
  },
};

function row(overrides = {}) {
  return {
    site_id: 6000006,
    site_slug: "scp-wiki",
    page_id: 3000000021,
    page_slug: "scp-002",
    page_from_wikidot: true,
    file_id: 22,
    name: "SCP.txt",
    file_from_wikidot: false,
    file_deleted_at: "",
    user_id: -2,
    comments: "",
    size: 5871,
    last_revision_id: 27,
    ...overrides,
  };
}

test("seed index keys site, page, and name without collisions", () => {
  const index = buildSeedIndex(SEEDER);
  assert.equal(index.size, 2);
  assert.equal(index.get("scp-wiki\u0000scp-002\u0000SCP.txt")?.path, "scp-main.ftml");
  assert.equal(index.get("scp-wiki\u0000scp-002\u0000other.txt"), undefined);
  // A space-joined key would collide "a b"/"c" with "a"/"b c".
  assert.equal(index.get("scp-wiki\u0000scp-002 SCP\u0000txt"), undefined);
});

test("classifies the SCP.txt fixture shape as a repair candidate", () => {
  const classification = classifyMirrorFileRow(row(), buildSeedIndex(SEEDER));
  assert.equal(classification.verdict, "FIXTURE");
  assert.equal(classification.seed_path, "scp-main.ftml");
});

test("keeps genuine mirror-import inventory out of repair", () => {
  const classification = classifyMirrorFileRow(
    row({
      file_id: 50000,
      name: "real-attachment.png",
      user_id: -1,
      comments: "local scp-wiki mirror attachment import from scp-wiki-translation corpus",
    }),
    buildSeedIndex(SEEDER),
  );
  assert.equal(classification.verdict, "MIRROR_IMPORT");
});

test("routes unknown local rows to human review, never repair", () => {
  const classification = classifyMirrorFileRow(
    row({file_id: 60000, name: "mystery.bin", user_id: 42, comments: "uploaded"}),
    buildSeedIndex(SEEDER),
  );
  assert.equal(classification.verdict, "UNCLASSIFIED_LOCAL");
});

test("passes through out-of-scope, tombstoned, and imported rows", () => {
  const seed = buildSeedIndex(SEEDER);
  assert.equal(
    classifyMirrorFileRow(row({page_from_wikidot: false}), seed).verdict,
    "OUT_OF_SCOPE",
  );
  assert.equal(
    classifyMirrorFileRow(row({file_deleted_at: "2026-01-01T00:00:00+00:00"}), seed).verdict,
    "ALREADY_TOMBSTONED",
  );
  assert.equal(
    classifyMirrorFileRow(row({file_from_wikidot: true}), seed).verdict,
    "IMPORTED",
  );
});

test("manifest contains only fixture rows with delete parameters", () => {
  const seed = buildSeedIndex(SEEDER);
  const classified = [
    {row: row(), classification: classifyMirrorFileRow(row(), seed)},
    {
      row: row({file_id: 50000, name: "real-attachment.png"}),
      classification: classifyMirrorFileRow(
        row({file_id: 50000, name: "real-attachment.png"}),
        seed,
      ),
    },
  ];
  const manifest = buildFixtureTombstoneManifest(classified);
  assert.equal(manifest.dry_run, true);
  assert.equal(manifest.entry_count, 1);
  assert.equal(manifest.entries.length, 1);
  assert.equal(manifest.entries[0].file_id, 22);
  assert.equal(manifest.entries[0].last_revision_id, 27);
  assert.equal(manifest.entries[0].seed_path, "scp-main.ftml");
  assert.match(manifest.repair_path, /ordinary file_delete/);
  assert.match(manifest.repair_path, /NOT import_wikidot_file_delete/);
});
