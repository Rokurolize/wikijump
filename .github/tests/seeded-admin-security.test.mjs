import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("the seeded administrator has no repository-known password and empty passwords are rejected", async () => {
  const usersPath = path.join(repositoryRoot, "deepwell/seeder/users.json");
  const authEndpointPath = path.join(repositoryRoot, "deepwell/src/endpoints/auth.rs");
  const usersSource = await readFile(usersPath, "utf8");
  const users = JSON.parse(usersSource);
  const administrator = users.find((user) => user.id === -1);

  assert.ok(administrator, "the administrator seed entry must remain explicit");
  assert.equal(administrator.password, null);
  assert.doesNotMatch(usersSource, /wikijumpadmin1/);

  const authEndpoint = await readFile(authEndpointPath, "utf8");
  assert.match(authEndpoint, /if authenticate\.password\.is_empty\(\)/);
  assert.match(authEndpoint, /ErrorType::EmptyPassword/);
});
