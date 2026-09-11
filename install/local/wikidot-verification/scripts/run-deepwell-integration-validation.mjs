#!/usr/bin/env node

import {spawn} from "node:child_process";
import process from "node:process";

const DEFAULT_IMAGES = Object.freeze({
  database: "wikijump-local-development-database",
  cache: "wikijump-local-development-cache",
  files: "wikijump-local-development-files",
});

function fail(message) {
  throw new Error(message);
}

function imageName(role) {
  const override = process.env[`WIKIJUMP_DEEPWELL_TEST_${role.toUpperCase()}_IMAGE`];
  return override?.trim() || DEFAULT_IMAGES[role];
}

function command(commandName, args, {env = process.env, capture = false} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(commandName, args, {
      cwd: process.cwd(),
      env,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    });
    let stdout = "";
    let stderr = "";
    if (capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve({stdout, stderr});
      const detail = signal ? `signal ${signal}` : `status ${code}`;
      reject(new Error(`${commandName} failed with ${detail}${capture && stderr ? `: ${stderr.trim()}` : ""}`));
    });
  });
}

async function requireLocalImage(image, role) {
  try {
    await command("docker", ["image", "inspect", image], {capture: true});
  } catch {
    fail(
      `Deepwell integration validation requires the already-built local ${role} image ${image}; ` +
      "refusing to pull an image during the hermetic final barrier",
    );
  }
}

async function containerPort(container, port) {
  const {stdout} = await command("docker", ["port", container, `${port}/tcp`], {capture: true});
  const line = stdout.trim().split("\n").find(Boolean);
  const match = line?.match(/:(\d+)$/u);
  if (!match) fail(`cannot resolve loopback port ${port} for ${container}`);
  return Number(match[1]);
}

async function waitFor(commandName, args, description, attempts = 60) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await command(commandName, args, {capture: true});
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`${description} did not become ready: ${lastError?.message ?? "unknown error"}`);
}

async function removeContainer(container) {
  await command("docker", ["rm", "-f", "-v", container], {capture: true}).catch(() => undefined);
}

function testEnvironment({databasePort, cachePort, filesPort}) {
  return {
    ...process.env,
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
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS?.trim() || "1",
    WIKIJUMP_DEEPWELL_TEST_ENVIRONMENT: "task-owned",
  };
}

async function run() {
  const images = Object.fromEntries(Object.keys(DEFAULT_IMAGES).map((role) => [role, imageName(role)]));
  await Promise.all(Object.entries(images).map(([role, image]) => requireLocalImage(image, role)));

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
  };
  const onSignal = (signal) => {
    cleanup().finally(() => process.kill(process.pid, signal));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  try {
    await command("docker", [
      "run", "-d", "--name", containers.database,
      "-e", "POSTGRES_DB=wikijump",
      "-e", "POSTGRES_USER=wikijump",
      "-e", "POSTGRES_PASSWORD=wikijump",
      "-e", "POSTGRES_HOST_AUTH_METHOD=md5",
      "-e", "POSTGRES_INITDB_ARGS=--locale en_US.UTF-8",
      "-p", "127.0.0.1::5432",
      images.database,
    ], {capture: true});
    await command("docker", [
      "run", "-d", "--name", containers.cache,
      "-p", "127.0.0.1::6379",
      images.cache,
    ], {capture: true});
    await command("docker", [
      "run", "-d", "--name", containers.files,
      "-e", "MINIO_ROOT_USER=minio",
      "-e", "MINIO_ROOT_PASSWORD=defaultpassword",
      "-e", "MINIO_REGION_NAME=local",
      "-e", "INITIAL_BUCKETS=deepwell-files deepwell-text-blocks",
      "-e", "DATA_DIR=/data",
      "-p", "127.0.0.1::9000",
      images.files,
    ], {capture: true});

    await Promise.all([
      waitFor("docker", ["exec", containers.database, "pg_isready", "-U", "wikijump", "-d", "wikijump"], "task-owned PostgreSQL"),
      waitFor("docker", ["exec", containers.cache, "valkey-cli", "ping"], "task-owned Valkey"),
    ]);
    const [databasePort, cachePort, filesPort] = await Promise.all([
      containerPort(containers.database, 5432),
      containerPort(containers.cache, 6379),
      containerPort(containers.files, 9000),
    ]);
    const env = testEnvironment({databasePort, cachePort, filesPort});
    await waitFor(
      process.execPath,
      ["-e", `fetch(${JSON.stringify(env.S3_CUSTOM_ENDPOINT + "/minio/health/live")}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))`],
      "task-owned MinIO",
    );

    await command("sqlx", ["migrate", "run", "--source", "deepwell/migrations"], {env});
    await command("cargo", ["build", "--manifest-path", "deepwell/Cargo.toml", "--bin", "deepwell"], {env});
    await command("target/debug/deepwell", [
      "--disable-log",
      "--localizations", "locales",
      "--seed", "deepwell/seeder",
      "install/local/deepwell/config.toml",
    ], {env: {...env, DEEPWELL_RUNTIME_ACTION: "seeder"}});
    await command("cargo", [
      "test", "--manifest-path", "deepwell/Cargo.toml", "--", "--test-threads", "1",
    ], {env});
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    await cleanup();
  }
}

run().catch((error) => {
  console.error(error?.stack ?? error?.message ?? String(error));
  process.exitCode = 1;
});
