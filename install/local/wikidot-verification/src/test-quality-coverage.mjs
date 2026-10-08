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

export async function runNodeCoverage(root, testFiles, output, {packageRoot, signal} = {}) {
  await fs.mkdir(output, {recursive: true, mode: 0o700});
  if (packageRoot === "framerail") {
    await runAuditCommand("pnpm", ["--dir", "framerail", "exec", "svelte-kit", "sync"], {cwd: root, signal});
  }
  const baselineCommand = [process.execPath, "--test-concurrency=1", "--test", ...testFiles];
  const baseline = await runAuditCommand(baselineCommand[0], baselineCommand.slice(1), {
    cwd: root, signal, processGroup: true, logPath: path.join(output, "baseline.log"),
  });
  const lcov = path.join(output, "coverage.lcov");
  const command = [process.execPath,
    "--experimental-test-coverage", "--test-concurrency=1",
    "--test-reporter=spec", `--test-reporter-destination=${path.join(output, "tests.log")}`,
    "--test-reporter=lcov", `--test-reporter-destination=${lcov}`,
    `--test-coverage-include=${root}/${packageRoot ?? "install/local/wikidot-verification"}/{src,scripts}/**`,
    "--test", ...testFiles,
  ];
  const result = await runAuditCommand(command[0], command.slice(1), {cwd: root, signal, processGroup: true, allowFailure: true, logPath: path.join(output, "runner.log")});
  const content = await fs.readFile(lcov, "utf8");
  const report = {tool: `node ${process.version}`, metric: "V8", test_files: testFiles, baseline: {...baseline, command: baselineCommand}, command, ...result, files: summarizeLcov(content)};
  await fs.writeFile(path.join(output, "summary.json"), `${JSON.stringify(report, null, 2)}\n`, {mode: 0o600});
  if (result.code !== 0) throw new Error(`instrumented Node tests failed; inspect ${path.join(output, "tests.log")} before classifying a blind spot`);
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
