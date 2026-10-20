/**
 * Avatar drill plan tests.
 *
 * The drill mutates standing and has NOT been run; these tests cover only
 * the offline plan builder and the CLI surface. No network, database, or
 * cache contact happens here.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  AVATAR_CACHE_TTL_SECONDS,
  buildAvatarDrillPlan,
  summarizeDrillPlan,
  validateDrillConfig,
} from "../src/avatar-expiry-delete-drill.mjs";
import { parseArgs } from "../scripts/avatar-expiry-delete-drill.mjs";

const BASE_CONFIG = {
  probeUsername: "avatar-drill-probe-1",
  gatewayBase: "https://scp-wiki.wjfiles.localhost",
  deepwellUrl: "http://127.0.0.1:2747/jsonrpc",
  dbContainer: "wikijump-standing-database-1",
  cacheContainer: "wikijump-standing-cache-1",
  operatorIp: "127.0.0.2",
  waitSeconds: 65,
};

function phases(plan) {
  return [...plan.steps, ...plan.cleanup].map((step) => step.phase);
}

test("config validation fails closed on unsafe or missing inputs", () => {
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, probeUsername: "admin" }), /probe username must match/);
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, probeUsername: "avatar-drill-UPPER" }), /probe username must match/);
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, gatewayBase: "gopher://x" }), /http\(s\) URL/);
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, waitSeconds: 60 }), /outlast the avatar TTL/);
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, waitSeconds: 601 }), /outlast the avatar TTL/);
  assert.throws(() => validateDrillConfig({ ...BASE_CONFIG, operatorIp: "" }), /operatorIp must be set/);
  const validated = validateDrillConfig({ ...BASE_CONFIG, waitSeconds: undefined });
  assert.equal(validated.waitSeconds, AVATAR_CACHE_TTL_SECONDS + 5);
});

test("every mutation is flanked by read-only assertions", () => {
  const plan = buildAvatarDrillPlan(BASE_CONFIG);
  const rpcMethods = plan.steps
    .filter((step) => step.request.kind === "rpc")
    .map((step) => step.request.method);
  assert.deepEqual(rpcMethods, ["user_create", "blob_upload", "user_edit", "user_edit"]);
  const assertAfter = (mutateId) => {
    const index = plan.steps.findIndex((step) => step.id === mutateId);
    assert.ok(index >= 0, mutateId);
    assert.equal(plan.steps[index + 1].phase, "assert", `${mutateId} must be followed by assertions`);
  };
  assertAfter("create-probe-user");
  assertAfter("set-avatar");
  assertAfter("remove-avatar");
  const httpPuts = plan.steps.filter((step) => step.request.kind === "http" && step.request.method === "PUT");
  assert.equal(httpPuts.length, 1);
  const waits = plan.steps.filter((step) => step.request.kind === "wait");
  assert.equal(waits.length, 1);
  assert.ok(waits[0].request.seconds > AVATAR_CACHE_TTL_SECONDS);
});

test("the plan proves expiry, deletion, and recaching in order", () => {
  const plan = buildAvatarDrillPlan(BASE_CONFIG);
  const ids = plan.steps.map((step) => step.id);
  const order = [
    "assert-cache-bounded-ttl",
    "wait-out-avatar-ttl",
    "assert-cache-expired",
    "assert-route-recaches",
    "remove-avatar",
    "assert-cache-dropped-on-remove",
    "assert-route-404-after-remove",
  ];
  let cursor = -1;
  for (const id of order) {
    const at = ids.indexOf(id);
    assert.ok(at > cursor, `${id} out of order`);
    cursor = at;
  }
  const ttlStep = plan.steps.find((step) => step.id === "assert-cache-bounded-ttl");
  assert.deepEqual(ttlStep.expect.ttlSeconds, { min: 1, max: AVATAR_CACHE_TTL_SECONDS });
});

test("runtime values travel as bindings and secrets as placeholders", () => {
  const plan = buildAvatarDrillPlan(BASE_CONFIG);
  const create = plan.steps.find((step) => step.id === "create-probe-user");
  assert.deepEqual(create.request.params.password, { $secret: "AVATAR_DRILL_PROBE_PASSWORD" });
  const setAvatar = plan.steps.find((step) => step.id === "set-avatar");
  assert.deepEqual(setAvatar.request.params.user, { $ref: "create-probe-user.user_id" });
  const put = plan.steps.find((step) => step.id === "upload-avatar-bytes");
  assert.deepEqual(put.request.url, { $ref: "presign-avatar-upload.presign_url" });
  const rendered = stableStringifyForSecrets(plan);
  assert.ok(!rendered.includes("AVATAR_DRILL_PROBE_PASSWORD") || rendered.includes("$secret"));
});

test("cleanup always runs and fully removes the probe", () => {
  const plan = buildAvatarDrillPlan(BASE_CONFIG);
  assert.ok(plan.cleanup.length >= 3);
  assert.ok(plan.cleanup.every((step) => step.phase === "cleanup"));
  const methods = plan.cleanup
    .filter((step) => step.request.kind === "rpc")
    .map((step) => step.request.method);
  assert.deepEqual(methods, ["user_edit", "user_delete"]);
  const gone = plan.cleanup.find((step) => step.id === "cleanup-assert-gone");
  assert.deepEqual(gone.request.checks, ["db-row-absent", "route-404", "cache-absent"]);
});

test("dry-run summary names every step without resolving bindings", () => {
  const plan = buildAvatarDrillPlan(BASE_CONFIG);
  const text = summarizeDrillPlan(plan);
  assert.match(text, /NOT RUN — dry run/);
  assert.match(text, new RegExp(plan.probeUsername));
  for (const step of [...plan.steps, ...plan.cleanup]) {
    assert.match(text, new RegExp(step.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.ok(!text.includes("Bearer "));
});

test("CLI parses dry-run and guarded execute invocations", () => {
  const dry = parseArgs(["--dry-run", "--probe-username", "avatar-drill-x", "--deepwell-url", "http://x", "--operator-ip", "127.0.0.2"]);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.execute, false);
  const exec = parseArgs(["--execute", "--confirm", "avatar-drill-x", "--probe-username", "avatar-drill-x", "--deepwell-url", "http://x", "--operator-ip", "127.0.0.2"]);
  assert.equal(exec.execute, true);
  assert.equal(exec.confirm, "avatar-drill-x");
  assert.throws(() => parseArgs(["--bogus"]), /unknown argument/);
});

function stableStringifyForSecrets(value) {
  return JSON.stringify(value);
}
