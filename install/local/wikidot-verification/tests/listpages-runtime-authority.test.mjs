import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import {
  LISTPAGES_RUNTIME_OBSERVATION_SCHEMA,
  assertListPagesCandidateLaunchEnvironment,
  listPagesRuntimeEnvironmentSha256,
  observeListPagesRuntimeAuthority,
} from "../src/listpages-runtime-authority.mjs";
import { sha256 } from "../src/syntax-differential.mjs";

const PID = 1234;
const START_TICKS = "5678";
const REPOSITORY = "/work/wikijump";
const CONFIG_PATH = "/run/listpages.toml";
const MANIFEST_PATH = "/run/candidate-manifest.json";
const FTML_SHA = "3".repeat(40);
const ARTIFACT_KEY = `candidate-v3-${"b".repeat(64)}`;
const CONTAINERS = {
  cache: "a".repeat(64),
  database: "b".repeat(64),
  files: "c".repeat(64),
};
const IMAGES = {
  deepwell: "5".repeat(64),
  database: "7".repeat(64),
  cache: "8".repeat(64),
  files: "9".repeat(64),
};
const HOST_PORTS = { cache: 26379, database: 25432, files: 29000 };
const LOCK = [
  "[[package]]",
  'name = "ftml"',
  'version = "0.1.0"',
  `source = "git+https://github.com/Rokurolize/ftml?rev=${FTML_SHA}#${FTML_SHA}"`,
  "",
].join("\n");
const CONFIG = Buffer.from("runtime configuration\n");
const ENVIRONMENT = Buffer.from([
  `DATABASE_URL=postgresql://wikijump@127.0.0.1:${HOST_PORTS.database}/wikijump`,
  `REDIS_URL=redis://127.0.0.1:${HOST_PORTS.cache}/0`,
  "S3_ACCESS_KEY_ID=access",
  `S3_CUSTOM_ENDPOINT=http://127.0.0.1:${HOST_PORTS.files}`,
  "S3_FILES_BUCKET=files",
  "S3_PATH_STYLE=true",
  "S3_REGION_NAME=local",
  "S3_SECRET_ACCESS_KEY=secret",
  "S3_TEXT_BLOCKS_BUCKET=text",
  "",
].join("\0"));
const COMMAND_LINE = Buffer.from([
  "/target/release/deepwell",
  "--port",
  "12747",
  CONFIG_PATH,
  "",
].join("\0"));

function processStat(startTicks = START_TICKS) {
  const fields = Array.from({ length: 52 }, () => "0");
  fields[0] = String(PID);
  fields[1] = "(deepwell worker)";
  fields[2] = "S";
  fields[21] = startTicks;
  return `${fields.join(" ")}\n`;
}

function artifacts() {
  const manifest = {
    schema: "roku.candidate_build_manifest.v1",
    artifact_key: { key: ARTIFACT_KEY },
    source: {
      wikijump_sha: "1".repeat(40),
      ftml_sha: FTML_SHA,
    },
    build: {
      cargo_lock_sha256: sha256(LOCK),
      binary_sha256: IMAGES.deepwell,
      profile: "release",
    },
    build_attestation: { mode: "wrapped_pre_post" },
  };
  const manifestContents = `${JSON.stringify(manifest)}\n`;
  const identity = {
    wikijump_sha: "1".repeat(40),
    wikijump_tree: "2".repeat(40),
    ftml_sha: FTML_SHA,
    dependency_lock_sha256: sha256(LOCK),
    build_manifest_sha256: sha256(manifestContents),
    build_artifact_key: ARTIFACT_KEY,
    executable_sha256: IMAGES.deepwell,
    runtime_config_sha256: sha256(CONFIG),
    runtime_environment_sha256:
      listPagesRuntimeEnvironmentSha256(ENVIRONMENT),
    profile: "release",
    rpc_url: "http://127.0.0.1:12747/jsonrpc",
    service_image_sha256: IMAGES,
    service_host_port: HOST_PORTS,
  };
  const proof = {
    run_nonce: "d".repeat(64),
    process: {
      pid: PID,
      start_ticks: START_TICKS,
      config_path: CONFIG_PATH,
      build_manifest_path: MANIFEST_PATH,
    },
    service_containers: CONTAINERS,
    service_host_port: HOST_PORTS,
  };
  return { identity, proof, manifestContents };
}

function fakeSystem({ mutation = null } = {}) {
  const { identity, manifestContents } = artifacts();
  const manifestForRead = (() => {
    if (mutation !== "unattested-manifest") return manifestContents;
    const changed = JSON.parse(manifestContents);
    changed.build_attestation.mode = "post_hoc_unattested";
    return `${JSON.stringify(changed)}\n`;
  })();
  return {
    fixtureDigest: async () => "f".repeat(64),
    randomCacheDigest: async () => "a".repeat(64),
    readFile: async (filePath) => {
      if (filePath === `/proc/${PID}/stat`) {
        return processStat(mutation === "pid-reused" ? "9999" : START_TICKS);
      }
      if (filePath === `/proc/${PID}/cmdline`) return COMMAND_LINE;
      if (filePath === `/proc/${PID}/environ`) return ENVIRONMENT;
      if (filePath === CONFIG_PATH) return CONFIG;
      if (filePath === MANIFEST_PATH) return manifestForRead;
      if (filePath === path.join(REPOSITORY, "deepwell", "Cargo.lock")) {
        return LOCK;
      }
      throw new Error(`unexpected read: ${filePath}`);
    },
    readlink: async (filePath) => {
      if (filePath === `/proc/${PID}/exe`) {
        return "/target/release/deepwell (deleted)";
      }
      if (filePath === `/proc/${PID}/cwd`) return REPOSITORY;
      throw new Error(`unexpected readlink: ${filePath}`);
    },
    hashFile: async (filePath) => {
      if (filePath === `/proc/${PID}/exe`) return identity.executable_sha256;
      if (filePath === CONFIG_PATH) return identity.runtime_config_sha256;
      throw new Error(`unexpected hash: ${filePath}`);
    },
    command: async (executable, args) => {
      const tool = path.basename(executable);
      if (tool === "git" && args.includes("status")) {
        return mutation === "dirty-checkout" ? " M deepwell/src/lib.rs" : "";
      }
      if (tool === "git" && args.at(-1) === "HEAD") {
        return identity.wikijump_sha;
      }
      if (tool === "git" && args.at(-1) === "HEAD^{tree}") {
        return identity.wikijump_tree;
      }
      if (tool === "ss") {
        const listenerPid = mutation === "wrong-listener" ? 9999 : PID;
        return `LISTEN 0 128 127.0.0.1:12747 0.0.0.0:* users:(("deepwell",pid=${listenerPid},fd=14))`;
      }
      if (tool === "python3") {
        return JSON.stringify({
          status: "bound",
          verified: true,
          manifest_sha256: sha256(manifestForRead),
        });
      }
      if (tool === "docker") {
        const containerId = args.at(-1);
        const service = Object.entries(CONTAINERS)
          .find(([, id]) => id === containerId)?.[0];
        const image = mutation === `wrong-${service}-image`
          ? "0".repeat(64)
          : identity.service_image_sha256[service];
        return JSON.stringify([{
          Id: containerId,
          Image: `sha256:${image}`,
          State: {
            Running: true,
            StartedAt: "2026-07-30T00:00:00.000Z",
            Health: { Status: "healthy" },
          },
          NetworkSettings: {
            Ports: {
              cache: { key: "6379/tcp" },
              database: { key: "5432/tcp" },
              files: { key: "9000/tcp" },
            }[service] && {
              [{
                cache: "6379/tcp",
                database: "5432/tcp",
                files: "9000/tcp",
              }[service]]: [{
                HostIp: "127.0.0.1",
                HostPort: String(HOST_PORTS[service]),
              }],
            },
          },
        }]);
      }
      throw new Error(`unexpected command: ${executable} ${args.join(" ")}`);
    },
  };
}

test("runtime authority observes the exact process, source, build, listener, and services", async () => {
  const { identity, proof } = artifacts();
  const observation = await observeListPagesRuntimeAuthority({
    identity,
    proof,
    phase: "before",
    system: fakeSystem(),
  });

  assert.equal(observation.schema, LISTPAGES_RUNTIME_OBSERVATION_SCHEMA);
  assert.equal(observation.status, "bound");
  assert.equal(observation.phase, "before");
  assert.match(observation.stable_sha256, /^[0-9a-f]{64}$/u);
  assert.equal(observation.stable.process.pid, PID);
  assert.equal(observation.stable.fixture_state_sha256, "f".repeat(64));
  assert.equal(
    observation.stable.services.database.container_id,
    CONTAINERS.database,
  );
});

test("candidate launch rejects inherited loader, Git, and tool-runtime environment", () => {
  assert.doesNotThrow(() =>
    assertListPagesCandidateLaunchEnvironment({ PATH: "/usr/bin", LANG: "C" })
  );
  for (const key of ["LD_LIBRARY_PATH", "LD_PRELOAD", "GIT_DIR", "NODE_OPTIONS"]) {
    assert.throws(
      () => assertListPagesCandidateLaunchEnvironment({ PATH: "/usr/bin", [key]: "poison" }),
      new RegExp(`candidate launch environment contains forbidden ${key}`),
    );
  }
});

for (const [mutation, message] of [
  ["pid-reused", /PID was reused or restarted/],
  ["wrong-listener", /PID does not exclusively own the RPC listener/],
  ["dirty-checkout", /checkout differs from the authoritative source/],
  [
    "unattested-manifest",
    /build manifest does not bind the authoritative identity/,
  ],
  [
    "wrong-database-image",
    /database container does not bind the authoritative identity/,
  ],
]) {
  test(`runtime authority rejects ${mutation}`, async () => {
    const { identity, proof } = artifacts();
    await assert.rejects(
      observeListPagesRuntimeAuthority({
        identity,
        proof,
        phase: "before",
        system: fakeSystem({ mutation }),
      }),
      message,
    );
  });
}
