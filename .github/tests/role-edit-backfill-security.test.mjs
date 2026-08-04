import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const migration = new URL("../../deepwell/migrations/20260629042000_role_edit_seeded_role_backfill.sql", import.meta.url);

test("role edit backfill remains limited to the seeded root and admin roles", async () => {
  const sql = await fs.readFile(migration, "utf8");
  assert.match(sql, /role\.name IN \('root', 'admin'\)/);
  assert.doesNotMatch(sql, /role_permission\.action = 'assign'/);
});
