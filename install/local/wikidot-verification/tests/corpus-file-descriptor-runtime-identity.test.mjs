import assert from "node:assert/strict";
import test from "node:test";

import {
  effectiveRuntimeServicesSha256,
} from "../src/standing-browser-runtime-identity.mjs";
import {
  observeFileDescriptorRuntimeBinding,
} from "../src/corpus-file-descriptor-runtime-identity.mjs";

const hash = (character, length = 64) => character.repeat(length);

function inspect(role, image, containerPort, hostPort) {
  const mount = role === "deepwell"
    ? {Type: "bind", RW: false, Destination: "/etc/deepwell.toml"}
    : {Type: "volume", Name: role === "database" ? "runtime50x-postgres-data" : "runtime50x-files-data", RW: true, Destination: role === "database" ? "/var/lib/postgresql/data" : "/data"};
  return {
    Id: hash(role[0]),
    Image: `sha256:${image}`,
    Name: `/${role}`,
    Path: role,
    Args: [],
    Config: {
      Image: `sha256:${image}`,
      Labels: {
        "com.docker.compose.project": "wikijump-standing",
        "com.rokurolize.wikijump.role": role,
        "com.rokurolize.wikijump.sha": hash("a", 40),
        "com.rokurolize.wikijump.ftml_sha": hash("b", 40),
      },
    },
    State: {Running: true, Health: {Status: "healthy"}},
    HostConfig: {Mounts: [], PortBindings: {}},
    Mounts: [mount],
    NetworkSettings: {
      Ports: {[containerPort]: [{HostIp: "127.0.0.1", HostPort: String(hostPort)}]},
      Networks: {},
    },
  };
}

function fixture() {
  const inspections = [
    inspect("database", hash("c"), "5432/tcp", 15432),
    inspect("deepwell", hash("d"), "2747/tcp", 12747),
    inspect("files", hash("e"), "9000/tcp", 19000),
  ];
  const identity = {
    schema: "wikijump_syntax_differential.wikijump_runtime_identity.v1",
    wikijump_sha: hash("a", 40),
    ftml_sha: hash("b", 40),
    dependency_lock_sha256: hash("f"),
    executable_sha256: hash("d"),
    runtime_config_sha256: effectiveRuntimeServicesSha256(inspections),
  };
  return {identity, inspections};
}

function observeFixture({identity, inspections}) {
  return observeFileDescriptorRuntimeBinding({
    runtimeIdentity: identity,
    databaseContainer: "database",
    deepwellContainer: "deepwell",
    filesContainer: "files",
    apiUrl: "http://127.0.0.1:12747/jsonrpc",
    s3Endpoint: "http://127.0.0.1:19000/",
    inspectContainer: async (selector) => inspections.find(({Name}) => Name === `/${selector}`),
  });
}

test("file descriptor runtime binding rejects service configuration drift", async () => {
  const value = fixture();
  const observed = await observeFixture(value);
  assert.equal(observed.effective_services_config_sha256, value.identity.runtime_config_sha256);

  value.inspections[1].Config.Env = ["DRIFT=1"];
  await assert.rejects(
    observeFixture(value),
    /Runtime service configuration does not match/u,
  );
});
