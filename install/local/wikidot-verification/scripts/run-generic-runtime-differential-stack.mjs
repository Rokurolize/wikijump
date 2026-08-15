#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";

import {runCliIfMain} from "../src/cli-entry.mjs";
import {publishBytesNoReplace} from "../src/atomic-no-replace.mjs";
import {sha256Hex, stableStringify} from "../src/canonical-json.mjs";
import {sha256} from "../src/syntax-differential.mjs";

const OWNER = "generic-runtime-differential";
const CANDIDATE_SCHEMA = "roku.candidate_build_manifest.v1";
const GIT = "/usr/bin/git";
const DOCKER = "/usr/bin/docker";
const NODE = process.execPath;
const SHA1_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const GIT_ENV = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin",
});

function dockerEnv(config) {
  return {
    DOCKER_CONFIG: config,
    DOCKER_HOST: "unix:///var/run/docker.sock",
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
  };
}

function valueAfter(argv, index, option) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const args = {
    repository: null,
    candidateManifest: null,
    binary: null,
    cases: null,
    captures: [],
    externalReferences: [],
    stateFixtures: [],
    output: null,
    runId: null,
    site: "sandbox-for-codex",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--repository") args.repository = path.resolve(valueAfter(argv, index++, option));
    else if (option === "--candidate-manifest") {
      args.candidateManifest = path.resolve(valueAfter(argv, index++, option));
    } else if (option === "--binary") {
      const binary = valueAfter(argv, index++, option);
      if (!path.isAbsolute(binary)) throw new Error("--binary must be an absolute path");
      args.binary = binary;
    } else if (option === "--cases") args.cases = path.resolve(valueAfter(argv, index++, option));
    else if (option === "--captures") args.captures.push(path.resolve(valueAfter(argv, index++, option)));
    else if (option === "--state-fixture") {
      args.stateFixtures.push(path.resolve(valueAfter(argv, index++, option)));
    } else if (option === "--external-reference") {
      args.externalReferences.push(path.resolve(valueAfter(argv, index++, option)));
    } else if (option === "--output") args.output = path.resolve(valueAfter(argv, index++, option));
    else if (option === "--run-id") args.runId = valueAfter(argv, index++, option);
    else if (option === "--site") args.site = valueAfter(argv, index++, option);
    else throw new Error(`unknown option: ${option}`);
  }
  for (const [field, option] of [
    ["repository", "repository"],
    ["candidateManifest", "candidate-manifest"],
    ["cases", "cases"],
    ["output", "output"],
  ]) {
    if (!args[field]) throw new Error(`--${option} is required`);
  }
  if (args.captures.length === 0) throw new Error("--captures is required");
  if (args.site !== "sandbox-for-codex") throw new Error("--site must be sandbox-for-codex");
  if (!args.runId) throw new Error("--run-id is required");
  if (!/^candidate-run-[0-9a-f]{12}$/u.test(args.runId)) throw new Error("--run-id must be a candidate run ID");
  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

export function resourceSnapshot(project, env, inspect = spawnSync) {
  const resources = [
    ["containers", ["ps", "--all"]],
    ["volumes", ["volume", "ls"]],
    ["networks", ["network", "ls"]],
    ["images", ["image", "ls"]],
  ];
  try {
    return Object.fromEntries(resources.map(([name, command]) => {
      const result = inspect(DOCKER, [...command, "--quiet", "--filter", `label=com.rokurolize.wikijump.run_id=${project}`], {
        encoding: "utf8",
        env,
        stdio: "pipe",
      });
      if (result.error || result.status !== 0 || result.signal !== null) throw result.error ?? new Error(`${name} inspection failed`);
      return [name, (result.stdout ?? "").trim() ? result.stdout.trim().split(/\s+/u) : []];
    }));
  } catch {
    return null;
  }
}

export function resourcesAbsent(project, env, inspect = spawnSync) {
  const snapshot = resourceSnapshot(project, env, inspect);
  return snapshot !== null && Object.values(snapshot).every((items) => items.length === 0);
}

export function requireOutputAbsent(target, name) {
  try {
    fs.lstatSync(target);
    throw new Error(`${name} already exists: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function exactFtmlSha(cargoLock) {
  const matches = cargoLock
    .split(/^\[\[package\]\]\s*$/mu)
    .slice(1)
    .filter((entry) => /^name = "ftml"$/mu.test(entry))
    .map((entry) => /^source = "git\+https:\/\/github\.com\/Rokurolize\/ftml[^"#]*#([0-9a-f]{40})"$/mu.exec(entry)?.[1])
    .filter(Boolean);
  if (matches.length !== 1) {
    throw new Error(`Cargo.lock must contain exactly one pinned Rokurolize/ftml package, found ${matches.length}`);
  }
  return matches[0];
}

function requireCandidate(condition, message) {
  if (!condition) throw new Error(`candidate manifest ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export async function bindCandidate({repository, candidateManifest, binary}) {
  let manifest;
  let candidateManifestBytes;
  try {
    candidateManifestBytes = await fsp.readFile(candidateManifest);
    manifest = JSON.parse(candidateManifestBytes.toString("utf8"));
  } catch (error) {
    throw new Error(`candidate manifest is unreadable: ${error.message}`);
  }
  const source = manifest?.source;
  const build = manifest?.build;
  const inputs = manifest?.artifact_key?.inputs;
  requireCandidate(manifest?.schema === CANDIDATE_SCHEMA, "has an unsupported schema");
  requireCandidate(source?.repository === "Rokurolize/wikijump", "has a different repository");
  requireCandidate(SHA1_RE.test(source?.wikijump_sha), "has no valid Wikijump commit");
  requireCandidate(source?.wikijump_source_id === "clean", "does not bind a clean Wikijump source");
  requireCandidate(SHA1_RE.test(source?.ftml_sha), "has no valid FTML commit");
  requireCandidate(source?.ftml_source_id === "clean", "does not bind a clean FTML source");
  requireCandidate(build?.profile === "dev", "is not a dev profile build");
  requireCandidate(build?.package === "deepwell", "does not bind the deepwell package");
  requireCandidate(build?.artifact === "bin:deepwell", "does not bind the Deepwell binary");
  requireCandidate(typeof build?.target === "string" && build.target.length > 0, "has no build target");
  requireCandidate(build?.default_features === true, "does not use default features");
  requireCandidate(Array.isArray(build?.features) && build.features.length === 0, "has unexpected features");
  requireCandidate(SHA256_RE.test(build?.cargo_lock_sha256), "has no valid Cargo.lock hash");
  requireCandidate(SHA256_RE.test(build?.binary_sha256), "has no valid binary hash");
  requireCandidate(
    typeof build?.binary_path_at_build === "string" && path.isAbsolute(build.binary_path_at_build),
    "has no absolute binary path",
  );
  requireCandidate(
    path.basename(path.dirname(build.binary_path_at_build)) === "debug",
    "does not bind a debug binary",
  );
  requireCandidate(inputs?.schema === "roku-candidate-artifact-v3", "has an unsupported artifact key schema");
  requireCandidate(
    manifest?.artifact_key?.key === `candidate-v3-${sha256Hex(stableStringify(inputs))}`,
    "artifact key digest does not match",
  );
  for (const name of ["rustc_identity", "cargo_identity", "linker_identity"]) {
    requireCandidate(typeof inputs[name] === "string" && inputs[name].trim() !== "", `has no ${name}`);
  }
  requireCandidate(isRecord(inputs.build_environment), "has an invalid build environment");
  requireCandidate(
    Object.entries(inputs.build_environment).every(([key, value]) =>
      typeof key === "string" && (value === null || typeof value === "string")
    ),
    "has an invalid build environment",
  );
  requireCandidate(isRecord(inputs.recipe_digests), "has invalid recipe digests");
  requireCandidate(
    Object.entries(inputs.recipe_digests).every(([key, value]) =>
      typeof key === "string" && typeof value === "string"
    ),
    "has invalid recipe digests",
  );
  for (const name of ["rustflags", "cargo_encoded_rustflags"]) {
    requireCandidate(
      inputs[name] === null || typeof inputs[name] === "string",
      `has invalid ${name}`,
    );
  }
  for (const [actual, expected, name] of [
    [inputs?.sources?.repo?.sha, source.wikijump_sha, "Wikijump commit"],
    [inputs?.sources?.repo?.source_id, source.wikijump_source_id, "Wikijump source"],
    [inputs?.sources?.ftml?.sha, source.ftml_sha, "FTML commit"],
    [inputs?.sources?.ftml?.source_id, source.ftml_source_id, "FTML source"],
    [inputs?.profile, build.profile, "profile"],
    [inputs?.package, build.package, "package"],
    [inputs?.artifact, build.artifact, "artifact"],
    [inputs?.target, build.target, "target"],
    [inputs?.default_features, build.default_features, "default features"],
    [inputs?.recipe_digests?.["cargo-lock"], build.cargo_lock_sha256, "Cargo.lock hash"],
  ]) {
    requireCandidate(actual === expected, `has inconsistent ${name}`);
  }
  requireCandidate(
    Array.isArray(inputs?.features) && JSON.stringify(inputs.features) === JSON.stringify(build.features),
    "has inconsistent features",
  );

  if (run(GIT, ["status", "--porcelain"], {cwd: repository, env: GIT_ENV}) !== "") {
    throw new Error("candidate repository must be clean");
  }
  const head = run(GIT, ["rev-parse", "--verify", "HEAD"], {cwd: repository, env: GIT_ENV});
  const wikijumpTree = run(GIT, ["rev-parse", "--verify", "HEAD^{tree}"], {cwd: repository, env: GIT_ENV});
  requireCandidate(head === source.wikijump_sha, "does not match the repository commit");
  requireCandidate(SHA1_RE.test(wikijumpTree), "repository has no valid source tree");

  const cargoLockPath = path.join(repository, "deepwell/Cargo.lock");
  const cargoLock = await fsp.readFile(cargoLockPath);
  requireCandidate(sha256(cargoLock) === build.cargo_lock_sha256, "does not match Cargo.lock");
  const ftmlSha = exactFtmlSha(cargoLock.toString("utf8"));
  requireCandidate(ftmlSha === source.ftml_sha, "does not match the Cargo.lock FTML pin");
  const cargoToml = await fsp.readFile(path.join(repository, "deepwell/Cargo.toml"), "utf8");
  const cargoTomlFtmlSha = /^ftml\s*=\s*\{[^\n]*\brev\s*=\s*"([0-9a-f]{40})"[^\n]*\}$/mu.exec(cargoToml)?.[1];
  requireCandidate(cargoTomlFtmlSha === source.ftml_sha, "does not match the Cargo.toml FTML pin");

  const selectedBinary = binary ?? build.binary_path_at_build;
  requireCandidate(path.isAbsolute(selectedBinary), "binary path is not absolute");
  const binaryStat = await fsp.stat(selectedBinary);
  requireCandidate(binaryStat.isFile(), "binary path is not a file");
  requireCandidate((binaryStat.mode & 0o111) !== 0, "binary is not executable");
  requireCandidate(
    sha256(await fsp.readFile(selectedBinary)) === build.binary_sha256,
    "binary hash does not match",
  );
  return {manifest, binary: selectedBinary, candidateReceipt: {path: candidateManifest, sha256: sha256Hex(candidateManifestBytes)}};
}

async function freePorts(count) {
  const servers = [];
  try {
    for (let index = 0; index < count; index += 1) {
      const server = net.createServer();
      servers.push(server);
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
    }
    return servers.map((server) => server.address().port);
  } finally {
    await Promise.all(servers.filter((server) => server.listening).map((server) =>
      new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    ));
  }
}

function standingImageId(service, env) {
  return run(DOCKER, [
    "inspect",
    `wikijump-standing-${service}-1`,
    "--format",
    "{{.Image}}",
  ], {env});
}

function readAdministrator(repository) {
  const users = JSON.parse(
    fs.readFileSync(path.join(repository, "deepwell/seeder/users.json"), "utf8"),
  );
  const administrator = users.find((user) => user?.slug === "administrator");
  if (!administrator?.email || !administrator?.password) {
    throw new Error("seeded administrator credentials are unavailable");
  }
  return {email: administrator.email, password: administrator.password};
}

export function composeDocument({
  project,
  labels,
  images,
  binary,
  config,
  migrations,
  locales,
  seeder,
  rpcPort,
  textBlockPort,
  credentials,
}) {
  const labelLines = Object.entries(labels)
    .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const volumeLabels = Object.entries(labels)
    .map(([key, value]) => `      ${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const databaseUrl = new URL("postgres://database/wikijump");
  databaseUrl.username = "wikijump";
  databaseUrl.password = credentials.databasePassword;
  return `name: ${project}
services:
  database:
    image: ${images.database}
    pull_policy: never
    environment:
      POSTGRES_DB: wikijump
      POSTGRES_USER: wikijump
      POSTGRES_PASSWORD: ${JSON.stringify(credentials.databasePassword)}
      POSTGRES_HOST_AUTH_METHOD: md5
    volumes:
      - database:/var/lib/postgresql/data
    labels:
${labelLines}
    healthcheck:
      test: ["CMD", "wikijump-health-check"]
      interval: 5s
      timeout: 3s
      retries: 24
  cache:
    image: ${images.cache}
    pull_policy: never
    volumes:
      - cache:/data
    labels:
${labelLines}
    healthcheck:
      test: ["CMD", "valkey-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 24
  files:
    image: ${images.files}
    pull_policy: never
    environment:
      MINIO_ROOT_USER: ${JSON.stringify(credentials.filesAccessKey)}
      MINIO_ROOT_PASSWORD: ${JSON.stringify(credentials.filesSecretKey)}
      MINIO_REGION_NAME: local
      INITIAL_BUCKETS: deepwell-files deepwell-text-blocks
      DATA_DIR: /data
    tmpfs:
      - /data:size=256m,mode=0700
    ports:
      - "127.0.0.1:${textBlockPort}:9000"
    labels:
${labelLines}
    healthcheck:
      test: ["CMD", "/healthcheck.sh"]
      interval: 5s
      timeout: 3s
      retries: 24
  deepwell:
    image: ${images.deepwell}
    pull_policy: never
    command: ["/bin/sh", "-ec", "until /usr/local/cargo/bin/sqlx migrate run --source /opt/runtime/migrations; do sleep 1; done; exec /opt/runtime/deepwell /opt/runtime/config.toml"]
    environment:
      DATABASE_URL: ${JSON.stringify(databaseUrl.href)}
      REDIS_URL: redis://cache
      S3_FILES_BUCKET: deepwell-files
      S3_TEXT_BLOCKS_BUCKET: deepwell-text-blocks
      S3_REGION_NAME: local
      S3_PATH_STYLE: "true"
      S3_CUSTOM_ENDPOINT: http://files:9000
      S3_ACCESS_KEY_ID: ${JSON.stringify(credentials.filesAccessKey)}
      S3_SECRET_ACCESS_KEY: ${JSON.stringify(credentials.filesSecretKey)}
    ports:
      - "127.0.0.1:${rpcPort}:2747"
    volumes:
      - type: bind
        source: ${JSON.stringify(binary)}
        target: /opt/runtime/deepwell
        read_only: true
      - type: bind
        source: ${JSON.stringify(config)}
        target: /opt/runtime/config.toml
        read_only: true
      - type: bind
        source: ${JSON.stringify(migrations)}
        target: /opt/runtime/migrations
        read_only: true
      - type: bind
        source: ${JSON.stringify(locales)}
        target: /opt/locales
        read_only: true
      - type: bind
        source: ${JSON.stringify(seeder)}
        target: /src/deepwell/seeder
        read_only: true
    labels:
${labelLines}
    healthcheck:
      test: ["CMD", "wikijump-health-check"]
      interval: 5s
      timeout: 3s
      retries: 60
    depends_on:
      database:
        condition: service_healthy
      cache:
        condition: service_healthy
      files:
        condition: service_healthy
volumes:
  database:
    name: ${project}-database
    labels:
${volumeLabels}
  cache:
    name: ${project}-cache
    labels:
${volumeLabels}
networks:
  default:
    name: ${project}-network
    labels:
${volumeLabels}
`;
}

export function composeIdentityDocument(options) {
  return composeDocument({
    ...options,
    credentials: {
      databasePassword: "<runtime-database-password>",
      filesAccessKey: "<runtime-files-access-key>",
      filesSecretKey: "<runtime-files-secret-key>",
    },
  });
}

export function runtimeIdentity(manifest, compose, config) {
  const wikijumpSha = manifest.source?.wikijump_sha;
  const ftmlSha = manifest.source?.ftml_sha;
  const lockHash = manifest.build?.cargo_lock_sha256;
  const executableHash = manifest.build?.binary_sha256;
  for (const [name, value, length] of [
    ["Wikijump SHA", wikijumpSha, 40],
    ["FTML SHA", ftmlSha, 40],
    ["Cargo.lock hash", lockHash, 64],
    ["executable hash", executableHash, 64],
  ]) {
    if (typeof value !== "string" || !new RegExp(`^[0-9a-f]{${length}}$`, "u").test(value)) {
      throw new Error(`candidate manifest has no valid ${name}`);
    }
  }
  return {
    schema: "wikijump_syntax_differential.wikijump_runtime_identity.v1",
    wikijump_sha: wikijumpSha,
    ftml_sha: ftmlSha,
    dependency_lock_sha256: lockHash,
    executable_sha256: executableHash,
    runtime_config_sha256: sha256(`${compose}\0${config}`),
  };
}

export async function main(argv) {
  const args = parseArgs(argv);
  requireOutputAbsent(args.output, "output");
  const cleanupReceiptPath = `${args.output}.cleanup.json`;
  const stackLogPath = `${args.output}.stack.log`;
  requireOutputAbsent(cleanupReceiptPath, "cleanup receipt");
  requireOutputAbsent(stackLogPath, "stack log");
  const runId = args.runId;
  let boundCandidate;
  try {
    boundCandidate = await bindCandidate(args);
  } catch (error) {
    const failure = {schema: "wikijump_syntax_differential.runtime_stack_cleanup.v1", run_id: runId, project: runId, status: "fail", reason: error?.message ?? String(error), compose_started: false, compose_down_exit_code: null, compose_down_signal: null, run_root_removed: true, public_absence_verified: false, resources_released: true, vacant: true, browser_closed: true};
    await publishBytesNoReplace(cleanupReceiptPath, `${JSON.stringify(failure)}\n`);
    throw error;
  }
  const {manifest, binary, candidateReceipt} = boundCandidate;
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString();
  const project = runId;
  let runRoot = null;
  let composePath = null;
  let configPath = null;
  let identityPath = null;
  let localDockerEnv = null;
  let composeStarted = false;
  try {
    runRoot = await fsp.mkdtemp(path.join(os.tmpdir(), `${runId}-`));
    composePath = path.join(runRoot, "compose.yaml");
    configPath = path.join(runRoot, "config.toml");
    identityPath = path.join(runRoot, "runtime-identity.json");
    const dockerConfigPath = path.join(runRoot, "docker-config");
    for (const [target, name] of [[composePath, "compose output"], [configPath, "runtime config output"], [identityPath, "runtime identity output"]]) requireOutputAbsent(target, name);
    await fsp.mkdir(dockerConfigPath, {mode: 0o700});
    localDockerEnv = dockerEnv(dockerConfigPath);
    const [rpcPort, textBlockPort] = await freePorts(2);
    const labels = {
      "com.rokurolize.wikijump.owner": OWNER,
      "com.rokurolize.wikijump.expiry": expiresAt,
      "com.rokurolize.wikijump.run_id": runId,
      "com.rokurolize.wikijump.lifecycle": "delete-on-close",
    };
    const credentials = {
      databasePassword: crypto.randomBytes(32).toString("hex"),
      filesAccessKey: `runtime${crypto.randomBytes(12).toString("hex")}`,
      filesSecretKey: crypto.randomBytes(32).toString("hex"),
    };
    const localConfig = await fsp.readFile(
      path.join(args.repository, "install/local/deepwell/config.toml"),
      "utf8",
    );
    const config = localConfig.replace('pid-file = "/run/deepwell.pid"', 'pid-file = ""');
    await fsp.writeFile(configPath, config, {mode: 0o600});
    const composeOptions = {
      project,
      labels,
      images: {
        database: standingImageId("database", localDockerEnv),
        cache: standingImageId("cache", localDockerEnv),
        files: standingImageId("files", localDockerEnv),
        deepwell: standingImageId("deepwell", localDockerEnv),
      },
      binary,
      config: configPath,
      migrations: path.join(args.repository, "deepwell/migrations"),
      locales: path.join(args.repository, "locales"),
      seeder: path.join(args.repository, "deepwell/seeder"),
      rpcPort,
      textBlockPort,
    };
    const compose = composeDocument({...composeOptions, credentials});
    await fsp.writeFile(composePath, compose, {mode: 0o600});
    const identity = runtimeIdentity(manifest, composeIdentityDocument(composeOptions), config);
    await fsp.writeFile(identityPath, `${JSON.stringify(identity, null, 2)}\n`, {mode: 0o600});
    composeStarted = true;
    run(DOCKER, [
      "compose", "-p", project, "-f", composePath,
      "up", "--detach", "--wait", "--wait-timeout", "600", "deepwell",
    ], {env: localDockerEnv});
    run(DOCKER, [
      "compose", "-p", project, "-f", composePath,
      "exec", "--no-TTY", "files", "sh", "-ec",
      'mc alias -q set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null; mc anonymous set download local/deepwell-text-blocks >/dev/null',
    ], {env: localDockerEnv});
    const ratingUpdate = run(DOCKER, [
      "compose", "-p", project, "-f", composePath,
      "exec", "--no-TTY", "--user", "wikijump",
      "database", "psql",
      "--dbname", "wikijump",
      "--set", "ON_ERROR_STOP=1",
      "--command",
      "UPDATE page_category SET rating_type = 'plus' WHERE site_id = (SELECT site_id FROM site WHERE slug = 'sandbox-for-codex') AND slug = '_default';",
    ], {env: localDockerEnv});
    if (!ratingUpdate.endsWith("UPDATE 1")) {
      throw new Error("sandbox oracle rating state did not update exactly one category");
    }
    const userInsert = run(DOCKER, [
      "compose", "-p", project, "-f", composePath,
      "exec", "--no-TTY", "--user", "wikijump",
      "database", "psql",
      "--dbname", "wikijump",
      "--set", "ON_ERROR_STOP=1",
      "--command",
      "INSERT INTO known_user (user_id) VALUES (2506), (9318), (111115), (122357), (5910559); INSERT INTO wikidot_user (user_id, created_at, fetched_at, is_deleted, name, slug, karma, is_pro) VALUES (2506, NOW() - INTERVAL '1 second', NOW(), FALSE, 'Alice', 'alice', 0, FALSE), (9318, NOW() - INTERVAL '1 second', NOW(), FALSE, 'Bob', 'bob', 0, FALSE), (111115, NOW() - INTERVAL '1 second', NOW(), FALSE, 'Missing', 'missing', 0, FALSE), (122357, NOW() - INTERVAL '1 second', NOW(), FALSE, 'system', 'system', 0, FALSE), (5910559, NOW() - INTERVAL '1 second', NOW(), FALSE, 'Account Name', 'account-name', 0, FALSE);",
    ], {env: localDockerEnv});
    if (!userInsert.endsWith("INSERT 0 5")) {
      throw new Error("sandbox oracle user state did not insert exactly five users");
    }
    const administrator = readAdministrator(args.repository);
    const runnerArgs = [
      path.join(path.dirname(new URL(import.meta.url).pathname), "run-generic-runtime-differential.mjs"),
      "--cases", args.cases,
      ...args.captures.flatMap((file) => ["--captures", file]),
      ...args.externalReferences.flatMap((file) => ["--external-reference", file]),
      ...args.stateFixtures.flatMap((file) => ["--state-fixture", file]),
      "--runtime-identity", identityPath,
      "--rpc-url", `http://127.0.0.1:${rpcPort}/jsonrpc`,
      "--text-block-url", `http://127.0.0.1:${textBlockPort}/deepwell-text-blocks/`,
      "--site", args.site,
      "--output", args.output,
    ];
    const result = spawnSync(NODE, runnerArgs, {
      cwd: args.repository,
      encoding: "utf8",
      env: {
        LANG: "C",
        LC_ALL: "C",
        PATH: "/usr/bin:/bin",
        WIKIDOT_VERIFY_ADMIN_EMAIL: administrator.email,
        WIKIDOT_VERIFY_ADMIN_PASS: administrator.password,
        WIKIDOT_VERIFY_DISPOSABLE_RUN_ID: runId,
      },
    });
    if (!fs.existsSync(args.output)) {
      throw new Error(`runtime differential produced no report: ${result.stderr || result.stdout}`);
    }
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    return result.status ?? 2;
  } finally {
    let stackLogError = null;
    if (composeStarted) {
      const logs = spawnSync(
        DOCKER,
        ["compose", "-p", project, "-f", composePath, "logs", "--no-color"],
        {encoding: "utf8", env: localDockerEnv},
      );
      try {
        await fsp.writeFile(stackLogPath, `${logs.stdout ?? ""}\n${logs.stderr ?? ""}`, {flag: "wx", mode: 0o600});
      } catch (error) {
        stackLogError = error;
      }
    }
    let down = null;
    if (composePath !== null && fs.existsSync(composePath)) {
      down = spawnSync(DOCKER, [
        "compose", "-p", project, "-f", composePath,
        "down", "--volumes", "--remove-orphans",
      ], {encoding: "utf8", env: localDockerEnv});
    }
    const downSucceeded = !composeStarted || (down?.status === 0 && down?.signal === null);
    const resourcesReleased = !composeStarted || resourcesAbsent(project, localDockerEnv);
    const preserveRunRoot = composeStarted && (!downSucceeded || !resourcesReleased || stackLogError !== null);
    let runRootRemovalError = null;
    if (runRoot !== null && !preserveRunRoot) {
      try {
        await fsp.rm(runRoot, {recursive: true, force: true});
      } catch (error) {
        runRootRemovalError = error;
      }
    }
    const cleanup = {
      schema: "wikijump_syntax_differential.runtime_stack_cleanup.v1",
      run_id: runId,
      project,
      run_root: runRoot,
      status: (!composeStarted || (downSucceeded && resourcesReleased && stackLogError === null)) && !preserveRunRoot && runRootRemovalError === null ? "pass" : "fail",
      run_root_removal_error: runRootRemovalError?.message ?? null,
      compose_started: composeStarted,
      compose_down_exit_code: down?.status ?? null,
      compose_down_signal: down?.signal ?? null,
      run_root_removed: runRoot === null || !fs.existsSync(runRoot),
      public_absence_verified: false,
      resources_released: resourcesReleased,
      vacant: false,
      browser_closed: true,
      candidate_receipt: candidateReceipt,
      resource_observation: {
        after: composeStarted ? resourceSnapshot(project, localDockerEnv) : {containers: [], volumes: [], networks: [], images: []},
      },
    };
    cleanup.public_absence_verified = cleanup.status === "pass";
    cleanup.vacant = cleanup.status === "pass" && cleanup.run_root_removed;
    await publishBytesNoReplace(cleanupReceiptPath, `${JSON.stringify(cleanup, null, 2)}\n`);
    if (stackLogError !== null) throw new Error(`runtime differential stack log publication failed: ${stackLogError.message}`);
    if (cleanup.status !== "pass") throw new Error(`runtime differential stack cleanup failed; see ${cleanupReceiptPath}`);
  }
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error.stack ?? error);
    return 2;
  },
});
