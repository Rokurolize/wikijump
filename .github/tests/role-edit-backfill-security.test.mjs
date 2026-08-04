import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const historicalMigration = new URL(
  "../../deepwell/migrations/20260629042000_role_edit_seeded_role_backfill.sql",
  import.meta.url,
);
const correctionMigration = new URL(
  "../../deepwell/migrations/20260804033500_role_edit_seeded_role_reconciliation.sql",
  import.meta.url,
);

test("historical role edit backfill remains immutable", async () => {
  const sql = await fs.readFile(historicalMigration, "utf8");
  assert.match(sql, /role_permission\.action = 'assign'/);
});

test("role edit reconciliation removes only the broad backfill shape", async () => {
  const sql = await fs.readFile(correctionMigration, "utf8");
  assert.match(sql, /DELETE FROM role_permission/);
  assert.match(sql, /role\.name NOT IN \('root', 'admin'\)/);
  assert.match(sql, /role_permission\.action = 'assign'/);
  assert.match(sql, /role_permission\.action = 'edit'/);
});
