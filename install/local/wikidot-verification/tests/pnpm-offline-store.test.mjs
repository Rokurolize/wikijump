import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensurePnpmDependencies,
  extractMissingOfflineTarball,
  resolvePersistentPnpmStoreDir,
} from "../src/pnpm-offline-store.mjs";

test("persistent pnpm store resolves outside /tmp by default and honors overrides", () => {
  assert.equal(
    resolvePersistentPnpmStoreDir({}, "/home/tester"),
    "/home/tester/.local/state/wikijump/pnpm-store",
  );
  assert.equal(
    resolvePersistentPnpmStoreDir({ XDG_STATE_HOME: "/var/lib/state" }, "/home/tester"),
    "/var/lib/state/wikijump/pnpm-store",
  );
  assert.equal(
    resolvePersistentPnpmStoreDir({ WIKIJUMP_PNPM_STORE_DIR: "/opt/pnpm-store" }, "/home/tester"),
    "/opt/pnpm-store",
  );
  assert.throws(
    () => resolvePersistentPnpmStoreDir({ WIKIJUMP_PNPM_STORE_DIR: "/tmp/wj-pnpm-store" }, "/home/tester"),
    /outside \/tmp/u,
  );
});

test("extractMissingOfflineTarball parses both pnpm v11 and ERR_PNPM_NO_OFFLINE_TARBALL outputs", () => {
  assert.deepEqual(extractMissingOfflineTarball("Done in 1.2s"), {
    matched: false,
    url: null,
    tarball: null,
  });

  const v11 = extractMissingOfflineTarball(
    "[ERROR] A package is missing from the store but cannot download it in offline mode. The missing package may be downloaded from https://npm.flatt.tech/pnpm/-/pnpm-11.10.0.tgz.\nFor help, run: pnpm help install\n",
  );
  assert.deepEqual(v11, {
    matched: true,
    url: "https://npm.flatt.tech/pnpm/-/pnpm-11.10.0.tgz",
    tarball: "pnpm-11.10.0.tgz",
  });

  const code = extractMissingOfflineTarball(
    "ERR_PNPM_NO_OFFLINE_TARBALL  Could not find pg-8.22.0.tgz in offline store",
  );
  assert.deepEqual(code, {
    matched: true,
    url: null,
    tarball: "pg-8.22.0.tgz",
  });
});

test("ensurePnpmDependencies heals once on missing offline tarball and retries offline once", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pnpm-offline-store-test-"));
  try {
    const pkgDir = path.join(tmp, "pkg");
    const storeDir = path.join(tmp, "store");
    fs.mkdirSync(pkgDir, { recursive: true });

    const calls = [];
    const logs = [];
    const run = (command, args, options) => {
      calls.push({ command, args, env: options.env, cwd: options.cwd });
      if (calls.length === 1) {
        return {
          status: 1,
          stdout: "",
          stderr: "ERR_PNPM_NO_OFFLINE_TARBALL https://registry.npmjs.org/pg/-/pg-8.22.0.tgz\n",
        };
      }
      if (calls.length === 2) {
        return { status: 0, stdout: "", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = ensurePnpmDependencies({
      dir: pkgDir,
      storeDir,
      env: { PATH: process.env.PATH, PNPM_CONFIG_OFFLINE: "true" },
      run,
      log: (msg) => logs.push(msg),
    });

    assert.equal(result.status, "healed");
    assert.equal(result.healed, true);
    assert.equal(result.missingTarball, "https://registry.npmjs.org/pg/-/pg-8.22.0.tgz");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0].args, ["install", "--frozen-lockfile", "--offline", "--store-dir", storeDir]);
    assert.equal(calls[0].env.PNPM_CONFIG_OFFLINE, "true");
    assert.deepEqual(calls[1].args, ["fetch", "--frozen-lockfile", "--ignore-scripts", "--store-dir", storeDir]);
    assert.equal("PNPM_CONFIG_OFFLINE" in calls[1].env, false);
    assert.deepEqual(calls[2].args, ["install", "--frozen-lockfile", "--offline", "--store-dir", storeDir]);
    assert.equal(calls[2].env.PNPM_CONFIG_OFFLINE, "true");
    assert.match(logs.join("\n"), /pg-8\.22\.0\.tgz/u);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("ensurePnpmDependencies does not retry non-tarball errors or fetch inside a network guard", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pnpm-offline-store-guard-"));
  try {
    const pkgDir = path.join(tmp, "pkg");
    const storeDir = path.join(tmp, "store");
    fs.mkdirSync(pkgDir, { recursive: true });

    let calls = 0;
    assert.throws(
      () =>
        ensurePnpmDependencies({
          dir: pkgDir,
          storeDir,
          env: {},
          run: () => {
            calls += 1;
            return { status: 1, stdout: "", stderr: "ERR_PNPM_OUTDATED_LOCKFILE\n" };
          },
          log: () => {},
        }),
      /ERR_PNPM_OUTDATED_LOCKFILE/u,
    );
    assert.equal(calls, 1);

    let guardedCalls = 0;
    assert.throws(
      () =>
        ensurePnpmDependencies({
          dir: pkgDir,
          storeDir,
          env: { WIKIJUMP_TEST_NETWORK_GUARD_ACTIVE: "1" },
          run: () => {
            guardedCalls += 1;
            return { status: 1, stdout: "", stderr: "ERR_PNPM_NO_OFFLINE_TARBALL pg-8.22.0.tgz\n" };
          },
          log: () => {},
        }),
      /inside an offline test guard/u,
    );
    assert.equal(guardedCalls, 1);

    let retryFailCalls = 0;
    assert.throws(
      () =>
        ensurePnpmDependencies({
          dir: pkgDir,
          storeDir,
          env: {},
          run: () => {
            retryFailCalls += 1;
            if (retryFailCalls === 2) return { status: 0, stdout: "", stderr: "" };
            return { status: 1, stdout: "", stderr: "ERR_PNPM_NO_OFFLINE_TARBALL pg-8.22.0.tgz\n" };
          },
          log: () => {},
        }),
      /retry failed/u,
    );
    assert.equal(retryFailCalls, 3);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
