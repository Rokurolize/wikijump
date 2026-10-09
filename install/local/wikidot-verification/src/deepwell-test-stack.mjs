import path from "node:path";
import {fileURLToPath} from "node:url";
import {waitForPublishedPostgres} from "./postgres-published-readiness.mjs";
import {runAuditCommand} from "./audit-command.mjs";

const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));

const DEFAULT_IMAGES = Object.freeze({
  database: "wikijump-local-development-database",
  cache: "wikijump-local-development-cache",
  files: "wikijump-local-development-files",
});

function fail(message) {
  throw new Error(message);
}

export function testThreads() {
  const raw = process.env.WIKIJUMP_DEEPWELL_TEST_THREADS?.trim() || "1";
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 16) {
    fail("WIKIJUMP_DEEPWELL_TEST_THREADS must be an integer from 1 through 16");
  }
  return String(value);
}

export function nextestPartition() {
  const value = process.env.WIKIJUMP_DEEPWELL_NEXTEST_PARTITION?.trim();
  if (!value) return null;
  if (!/^(?:hash|count|slice):[1-9][0-9]*\/[1-9][0-9]*$/u.test(value)) {
    fail("WIKIJUMP_DEEPWELL_NEXTEST_PARTITION must look like hash:1/4, count:2/4, or slice:3/4");
  }
  return value;
}

function imageName(role, environment) {
  const override = environment[`WIKIJUMP_DEEPWELL_TEST_${role.toUpperCase()}_IMAGE`];
  return override?.trim() || DEFAULT_IMAGES[role];
}

async function requireLocalImage(execute, image, role) {
  try {
    await execute("docker", ["image", "inspect", image], {capture: true});
  } catch {
    fail(
      `Deepwell integration validation requires the already-built local ${role} image ${image}; ` +
      "refusing to pull an image during the hermetic final barrier",
    );
  }
}

async function containerPort(execute, container, port) {
  const {stdout} = await execute("docker", ["port", container, `${port}/tcp`], {capture: true});
  const line = stdout.trim().split("\n").find(Boolean);
  const match = line?.match(/:(\d+)$/u);
  if (!match) fail(`cannot resolve loopback port ${port} for ${container}`);
  return Number(match[1]);
}

async function waitFor(execute, commandName, args, description, signal, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await execute(commandName, args, {capture: true});
      return;
    } catch (error) {
      signal?.throwIfAborted();
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${description} did not become ready: ${lastError?.message ?? "unknown error"}`);
}

async function removeContainer(container) {
  await runAuditCommand("docker", ["rm", "-f", "-v", container], {capture: true}).catch(() => undefined);
}

function testEnvironment({databasePort, cachePort, filesPort}, baseEnvironment) {
  return {
    ...baseEnvironment,
    DATABASE_URL: `postgres://wikijump:wikijump@127.0.0.1:${databasePort}/wikijump`,
    REDIS_URL: `redis://127.0.0.1:${cachePort}`,
    DEEPWELL_RPC_TOKEN: "0".repeat(64),
    S3_FILES_BUCKET: "deepwell-files",
    S3_TEXT_BLOCKS_BUCKET: "deepwell-text-blocks",
    S3_REGION_NAME: "local",
    S3_PATH_STYLE: "true",
    S3_CUSTOM_ENDPOINT: `http://127.0.0.1:${filesPort}`,
    S3_ACCESS_KEY_ID: "minio",
    S3_SECRET_ACCESS_KEY: "defaultpassword",
    RUST_MIN_STACK: "8388608",
    CARGO_BUILD_JOBS: baseEnvironment.CARGO_BUILD_JOBS?.trim() || "1",
    WIKIJUMP_DEEPWELL_TEST_ENVIRONMENT: "task-owned",
  };
}


export async function withTaskOwnedDeepwellStack(callback, {signal, environment = process.env} = {}) {
  const execute = (name, args, options = {}) => runAuditCommand(name, args, {
    cwd: repositoryRoot, env: environment, signal, ...options,
  });
  const images = Object.fromEntries(Object.keys(DEFAULT_IMAGES).map((role) => [role, imageName(role, environment)]));
  const cargo = environment.WIKIJUMP_OFFLINE_CARGO?.trim() || "cargo";
  await Promise.all(Object.entries(images).map(([role, image]) => requireLocalImage(execute, image, role)));

  const suffix = `${process.pid}-${Date.now()}`;
  const containers = {
    database: `wikijump-deepwell-test-db-${suffix}`,
    cache: `wikijump-deepwell-test-cache-${suffix}`,
    files: `wikijump-deepwell-test-files-${suffix}`,
  };
  let cleanupStarted = false;
  const cleanup = async () => {
    if (cleanupStarted) return;
    cleanupStarted = true;
    await Promise.all(Object.values(containers).map(removeContainer));
    const remaining = await runAuditCommand("docker", ["ps", "-a", "--format", "{{.Names}}"], {capture: true});
    const names = new Set(remaining.stdout.trim().split("\n"));
    if (Object.values(containers).some((name) => names.has(name))) {
      fail("task-owned Deepwell test containers remain after cleanup");
    }
  };
  try {
    await execute("docker", [
      "run", "-d", "--name", containers.database,
      "-e", "POSTGRES_DB=wikijump",
      "-e", "POSTGRES_USER=wikijump",
      "-e", "POSTGRES_PASSWORD=wikijump",
      "-e", "POSTGRES_HOST_AUTH_METHOD=md5",
      "-e", "POSTGRES_INITDB_ARGS=--locale en_US.UTF-8",
      "-p", "127.0.0.1::5432",
      images.database,
    ], {capture: true});
    await execute("docker", [
      "run", "-d", "--name", containers.cache,
      "-p", "127.0.0.1::6379",
      images.cache,
    ], {capture: true});
    await execute("docker", [
      "run", "-d", "--name", containers.files,
      // This fixture is deleted after the run. A private tmpfs avoids MinIO's
      // host-disk free-space floor on workstations with large build caches.
      "--tmpfs", "/data:rw,size=2g",
      "-e", "MINIO_ROOT_USER=minio",
      "-e", "MINIO_ROOT_PASSWORD=defaultpassword",
      "-e", "MINIO_REGION_NAME=local",
      "-e", "INITIAL_BUCKETS=deepwell-files deepwell-text-blocks",
      "-e", "DATA_DIR=/data",
      "-p", "127.0.0.1::9000",
      images.files,
    ], {capture: true});

    await Promise.all([
      waitFor(execute, "docker", ["exec", containers.database, "pg_isready", "-U", "wikijump", "-d", "wikijump"], "task-owned PostgreSQL", signal),
      waitFor(execute, "docker", ["exec", containers.cache, "valkey-cli", "ping"], "task-owned Valkey", signal),
    ]);
    const [databasePort, cachePort, filesPort] = await Promise.all([
      containerPort(execute, containers.database, 5432),
      containerPort(execute, containers.cache, 6379),
      containerPort(execute, containers.files, 9000),
    ]);
    const env = testEnvironment({databasePort, cachePort, filesPort}, environment);
    await Promise.all([
      waitForPublishedPostgres({port: databasePort}),
      waitFor(
        execute, process.execPath,
        ["-e", `fetch(${JSON.stringify(env.S3_CUSTOM_ENDPOINT + "/minio/health/live")}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`],
        "task-owned MinIO",
        signal,
      ),
    ]);

    await execute("sqlx", ["migrate", "run", "--source", "deepwell/migrations"], {env});
    await execute(cargo, [
      "build", "--offline", "--locked",
      "--manifest-path", "deepwell/Cargo.toml", "--bin", "deepwell",
    ], {env});
    const metadata = await execute(cargo, [
      "metadata", "--offline", "--locked", "--no-deps", "--format-version", "1",
      "--manifest-path", "deepwell/Cargo.toml",
    ], {env, capture: true});
    const seedBinary = path.join(JSON.parse(metadata.stdout).target_directory, "debug", "deepwell");
    await execute(seedBinary, [
      "--disable-log",
      "--localizations", "locales",
      "--seed", "deepwell/seeder",
      "install/local/deepwell/config.toml",
    ], {env: {...env, DEEPWELL_RUNTIME_ACTION: "seeder"}});
    return await callback({env, cargo, execute, containers});
  } finally {
    await cleanup();
  }
}
