import fs from "node:fs/promises";

import {
  aggregateSandboxOracleVerdict,
  compareSandboxOracleFixture,
  validateSandboxOracleRegistry,
} from "../src/sandbox-oracle.mjs";

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") {
      result.help = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`unexpected argument: ${argument}`);
    }
    const key = argument.slice(2).replaceAll("-", "_");
    if (key === "help") {
      result.help = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${argument} requires a value`);
    }
    result[key] = value;
    index += 1;
  }
  if (result.help) return result;
  for (const key of ["registry", "local", "output"]) {
    if (!result[key]) throw new Error(`--${key.replaceAll("_", "-")} is required`);
  }
  return result;
}

function usage() {
  return [
    "Usage: node scripts/compare-sandbox-oracle.mjs",
    "  --registry PATH --local PATH [--frozen PATH] [--contracts PATH] [--capture-receipt PATH]",
    "  --run-id ID --output PATH",
  ].join("\n");
}

async function readJson(filePath, name) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${name} ${filePath}: ${error.message}`);
  }
}

function captureMap(value, name) {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value?.captures)
      ? value.captures
      : Array.isArray(value?.fixtures)
        ? value.fixtures
        : Object.entries(value ?? {}).map(([fixture_id, capture]) => ({
            fixture_id,
            capture,
          }));
  const result = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.fixture_id !== "string" ||
      (!row.capture && !row.observation)
    ) {
      throw new Error(`${name} rows must contain fixture_id and capture`);
    }
    if (result.has(row.fixture_id)) {
      throw new Error(`${name} contains duplicate fixture_id ${row.fixture_id}`);
    }
    result.set(row.fixture_id, row.capture ?? row.observation);
  }
  return result;
}

function contractMap(value) {
  if (!value) return new Map();
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(value.contracts)
      ? value.contracts
      : Object.entries(value).map(([fixture_id, contract]) => ({
          fixture_id,
          contract,
        }));
  return new Map(
    rows.map((row) => [row.fixture_id, row.contract ?? row]),
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const registry = validateSandboxOracleRegistry(
    await readJson(args.registry, "registry"),
  );
  const local = captureMap(await readJson(args.local, "local captures"), "local captures");
  const frozen = args.frozen
    ? captureMap(await readJson(args.frozen, "frozen captures"), "frozen captures")
    : new Map();
  const contracts = contractMap(
    args.contracts ? await readJson(args.contracts, "contracts") : null,
  );
  const captureReceipt = args.capture_receipt
    ? await readJson(args.capture_receipt, "capture receipt")
    : null;
  const blockedHostsByFixture =
    captureReceipt?.request_gate?.blocked_hosts_by_fixture ?? {};
  const results = registry.fixtures.map((fixture) =>
    compareSandboxOracleFixture({
      fixture,
      local: local.get(fixture.fixture_id),
      frozen: frozen.get(fixture.fixture_id),
      contract: contracts.get(fixture.fixture_id) ?? null,
      blockedHosts: Object.hasOwn(blockedHostsByFixture, fixture.fixture_id)
        ? blockedHostsByFixture[fixture.fixture_id]
        : null,
    }),
  );
  const { verdict, exitCode } = aggregateSandboxOracleVerdict({
    runId: args.run_id ?? "sandbox-oracle-local",
    registry,
    results,
  });
  await fs.writeFile(args.output, `${JSON.stringify(verdict, null, 2)}\n`, "utf8");
  return exitCode;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error.message);
  console.error(usage());
  process.exitCode = 2;
}
