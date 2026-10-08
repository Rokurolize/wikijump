import fs from "node:fs/promises";
import path from "node:path";
import {runAuditCommand} from "./audit-command.mjs";
import {withTaskOwnedDeepwellStack} from "./deepwell-test-stack.mjs";

export function summarizeLcov(text) {
  const files = [];
  for (const block of text.split("end_of_record")) {
    const values = new Map(block.trim().split("\n").map((line) => {
      const colon = line.indexOf(":");
      return [line.slice(0, colon), line.slice(colon + 1)];
    }));
    if (!values.has("SF")) continue;
    const metric = (total, hit) => ({total: Number(values.get(total) ?? 0), hit: Number(values.get(hit) ?? 0)});
    files.push({path: values.get("SF"), lines: metric("LF", "LH"), functions: metric("FNF", "FNH"), branches: metric("BRF", "BRH")});
  }
  return files;
}

export function mergeLcovReports(reports) {
  const records = new Map();
  for (const text of reports) {
    for (const block of text.split("end_of_record")) {
      const lines = block.trim().split("\n");
      const source = lines.find((line) => line.startsWith("SF:"))?.slice(3);
      if (!source) continue;
      const record = records.get(source) ?? {metadata: new Map(), lines: new Map(), functions: new Map(), branches: new Map()};
      for (const line of lines) {
        if (line.startsWith("DA:")) {
          const [lineNumber, count, checksum] = line.slice(3).split(",");
          const previous = record.lines.get(lineNumber);
          record.lines.set(lineNumber, {count: Math.max(Number(count), previous?.count ?? 0), checksum: checksum ?? previous?.checksum});
        } else if (line.startsWith("FNDA:")) {
          const [count, ...name] = line.slice(5).split(",");
          const key = name.join(",");
          record.functions.set(key, {...(record.functions.get(key) ?? {}), count: Math.max(Number(count), record.functions.get(key)?.count ?? 0)});
        } else if (line.startsWith("FN:")) {
          const [lineNumber, ...name] = line.slice(3).split(",");
          const key = name.join(",");
          record.functions.set(key, {...(record.functions.get(key) ?? {}), lineNumber, name: key});
        } else if (line.startsWith("BRDA:")) {
          const [lineNumber, blockNumber, branchNumber, count] = line.slice(5).split(",");
          const key = `${lineNumber},${blockNumber},${branchNumber}`;
          const previous = record.branches.get(key);
          const numericCount = count === "-" ? 0 : Number(count);
          record.branches.set(key, {count: Math.max(numericCount, previous?.count ?? 0), unknown: count === "-" && previous?.unknown !== false});
        } else if (line.startsWith("TN:")) {
          const [key, value] = line.split(":");
          if (!record.metadata.has(key)) record.metadata.set(key, value);
        }
      }
      records.set(source, record);
    }
  }
  const output = [];
  for (const [source, record] of [...records].sort(([left], [right]) => left.localeCompare(right))) {
    const functions = [...record.functions.values()].sort((left, right) => left.name.localeCompare(right.name));
    const branches = [...record.branches].sort(([left], [right]) => left.localeCompare(right));
    const lines = [...record.lines].sort(([left], [right]) => Number(left) - Number(right));
    const functionHits = functions.filter((item) => item.count > 0).length;
    const branchHits = branches.filter(([, item]) => item.count > 0).length;
    const lineHits = lines.filter(([, item]) => item.count > 0).length;
    output.push([
      ...[...record.metadata].map(([key, value]) => `${key}:${value}`),
      `SF:${source}`,
      ...functions.filter((item) => item.lineNumber !== undefined).map((item) => `FN:${item.lineNumber},${item.name}`),
      ...functions.map((item) => `FNDA:${item.count ?? 0},${item.name}`),
      `FNF:${functions.length}`, `FNH:${functionHits}`,
      ...branches.map(([key, item]) => `BRDA:${key},${item.count > 0 ? item.count : item.unknown ? "-" : 0}`),
      `BRF:${branches.length}`, `BRH:${branchHits}`,
      ...lines.map(([lineNumber, item]) => `DA:${lineNumber},${item.count}${item.checksum === undefined ? "" : `,${item.checksum}`}`),
      `LF:${lines.length}`, `LH:${lineHits}`, "end_of_record",
    ].join("\n"));
  }
  return `${output.join("\n")}\n`;
}

export async function runNodeCoverage(root, testFiles, output, {packageRoot, signal, excludedTestFiles = [], batchSize = 25} = {}) {
  await fs.mkdir(output, {recursive: true, mode: 0o700});
  if (packageRoot === "framerail") {
    await runAuditCommand("pnpm", ["--dir", "framerail", "exec", "svelte-kit", "sync"], {cwd: root, signal});
  }
  const baselineCommand = [process.execPath, "--test-concurrency=1", "--test", ...testFiles];
  const baseline = await runAuditCommand(baselineCommand[0], baselineCommand.slice(1), {
    cwd: root, signal, processGroup: true, logPath: path.join(output, "baseline.log"),
  });
  const excluded = new Set(excludedTestFiles.filter((file) => testFiles.includes(file)));
  const measuredTestFiles = testFiles.filter((file) => !excluded.has(file));
  const batches = [];
  for (let offset = 0; offset < measuredTestFiles.length; offset += batchSize) batches.push(measuredTestFiles.slice(offset, offset + batchSize));
  const commands = [], reports = [];
  let elapsed_ms = 0;
  for (const [index, batch] of batches.entries()) {
    const lcov = path.join(output, `coverage-${index}.lcov`);
    const command = [process.execPath,
      "--experimental-test-coverage", "--test-concurrency=1",
      "--test-reporter=spec", `--test-reporter-destination=${path.join(output, `tests-${index}.log`)}`,
      "--test-reporter=lcov", `--test-reporter-destination=${lcov}`,
      `--test-coverage-include=${root}/${packageRoot ?? "install/local/wikidot-verification"}/{src,scripts}/**`,
      "--test", ...batch,
    ];
    const result = await runAuditCommand(command[0], command.slice(1), {cwd: root, signal, processGroup: true, allowFailure: true, logPath: path.join(output, `runner-${index}.log`)});
    commands.push({command, ...result});
    elapsed_ms += result.elapsed_ms;
    reports.push(await fs.readFile(lcov, "utf8"));
  }
  const merged = mergeLcovReports(reports);
  const lcov = path.join(output, "coverage.lcov");
  await fs.writeFile(lcov, merged, {mode: 0o600});
  const report = {tool: `node ${process.version}`, metric: "V8", batch_size: batchSize, test_files: testFiles, measured_test_files: measuredTestFiles, excluded_test_files: [...excluded], baseline: {...baseline, command: baselineCommand}, commands, elapsed_ms, code: commands.every((item) => item.code === 0) ? 0 : 1, files: summarizeLcov(merged)};
  await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
  if (report.code !== 0) throw new Error(`instrumented Node tests failed; inspect ${output} before classifying a blind spot`);
  return report;
}

export async function runRustCoverage(root, output, signal) {
  await fs.mkdir(output, {recursive: true, mode: 0o700});
  const overrides = {CARGO_INCREMENTAL: "0", CARGO_TARGET_DIR: path.join(output, "target")};
  const coverageEnv = {...process.env, ...overrides};
  const versions = {};
  for (const [name, command, args] of [["rustc", "rustc", ["--version"]], ["cargo", "cargo", ["--version"]], ["llvm_cov", "cargo", ["llvm-cov", "--version"]], ["sqlx", "sqlx", ["--version"]]]) {
    versions[name] = (await runAuditCommand(command, args, {capture: true, signal})).stdout.trim();
  }
  const measurement = {tool_versions: versions, features: [], commands: [], rust_branch_coverage: "nightly instrumentation required; stable line/function/region results only"};
  const run = async (args, env, manifestPath = "deepwell/Cargo.toml") => {
    const subcommand = ["report", "clean"].includes(args[0]) ? [args[0]] : [];
    const remaining = subcommand.length ? args.slice(1) : args;
    const selectedManifest = ["--manifest-path", manifestPath, "--offline", "--locked"];
    const command = ["cargo", "llvm-cov", ...subcommand, ...selectedManifest, ...remaining];
    const logPath = path.join(output, `command-${measurement.commands.length}.log`);
    try {
      const result = await runAuditCommand(command[0], command.slice(1), {cwd: root, env, signal, logPath});
      measurement.commands.push({command, log_path: logPath, ...result});
      return result;
    } finally {
      await fs.writeFile(path.join(output, "measurement.json"), `${JSON.stringify(measurement, null, 2)}\n`, {mode: 0o600});
    }
  };
  await withTaskOwnedDeepwellStack(async ({env}) => {
    const instrumented = {...env, ...overrides};
    await run(["--lib", "--no-report"], instrumented);
    await run(["report", "--json", "--output-path", path.join(output, "unit.json")], instrumented);
    // Retain unit raw profiles before measuring integration separately. Seeding
    // ran without instrumentation in the normal development target.
    const profileFiles = async () => (await fs.readdir(coverageEnv.CARGO_TARGET_DIR)).filter((file) => file.endsWith(".profraw"));
    const unitProfiles = new Map(await Promise.all((await profileFiles()).map(async (file) => [file, await fs.readFile(path.join(coverageEnv.CARGO_TARGET_DIR, file))])));
    await run(["clean", "--profraw-only"], instrumented);
    // The raw unit profiles were removed above, so the integration run can use
    // cargo-llvm-cov's normal cleanup behavior. Its CLI rejects --no-clean in
    // combination with --no-report.
    await run(["--test", "*", "--no-report", "--", "--test-threads=1"], instrumented);
    await run(["report", "--json", "--output-path", path.join(output, "integration.json")], instrumented);
    for (const [file, bytes] of unitProfiles) await fs.writeFile(path.join(coverageEnv.CARGO_TARGET_DIR, file), bytes);
    await run(["report", "--json", "--output-path", path.join(output, "combined.json")], instrumented);
  }, {signal});
  await run(["--lib", "--json", "--output-path", path.join(output, "derive.json")], coverageEnv, "deepwell/relation-impl-derive/Cargo.toml");
  return measurement;
}
