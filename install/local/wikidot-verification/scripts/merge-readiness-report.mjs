#!/usr/bin/env node
// Merge-readiness report (agent-runnable): combine validator verdict files
// and the branch deviation log into a single merge-ready verdict.
//
// Usage:
//   merge-readiness-report.mjs --output <report.json> [--branch <name>] \
//     [--deviation-log <deviations.jsonl>] \
//     [--validator <name>=<verdict.json> ...] [--run-id <id>]
//
// A validator verdict file counts as passing when it either records
// exit_code 0 or (for V3) zero regressions / (for V1-V2) meets its own gate.
// Exit codes: 0 merge-ready, 1 blockers present, 2 structural failure.

import fs from 'node:fs';

import {runCliIfMain} from '../src/cli-entry.mjs';
import {sealJsonNoReplace} from '../src/standing-browser-parity-util.mjs';

import { buildMergeReadiness, parseDeviationLog } from '../src/deviation-log.mjs';

export function parseArgs(argv) {
  const args = {
    output: null,
    branch: null,
    deviationLog: null,
    validators: [],
    runId: null,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--output' || arg === '--branch' || arg === '--deviation-log' || arg === '--run-id') {
      if (seen.has(arg)) throw new Error(`${arg} may be supplied only once`);
      seen.add(arg);
      const value = next();
      if (arg === '--output') args.output = value;
      else if (arg === '--branch') args.branch = value;
      else if (arg === '--deviation-log') args.deviationLog = value;
      else args.runId = value;
    }
    else if (arg === '--validator') {
      const value = next();
      const separator = value.indexOf('=');
      const name = separator > 0 ? value.slice(0, separator) : '';
      const file = separator > 0 ? value.slice(separator + 1) : '';
      if (!name || !file || args.validators.some((validator) => validator.name === name)) {
        throw new Error('--validator must use one unique non-empty name=FILE value');
      }
      args.validators.push({ name, file });
    } else if (arg === '--help' || arg === '-h') return {help: true};
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.output) throw new Error('--output is required');
  if (!args.runId) throw new Error('--run-id is required');
  if (args.validators.length === 0) throw new Error('at least one --validator is required');
  return args;
}

// Derive an effective exit code from a verdict file's own aggregate.
export function verdictExitCode(verdict) {
  if (typeof verdict.exit_code === 'number') return verdict.exit_code;
  const aggregate = verdict.aggregate ?? {};
  if (typeof aggregate.unclassified === 'number' && aggregate.unclassified > 0) return 2;
  if (Array.isArray(aggregate.regressions)) return aggregate.regressions.length > 0 ? 1 : 0;
  if (typeof aggregate.fail === 'number') return aggregate.fail > 0 ? 1 : 0;
  return 0;
}

export function usage() {
  return 'Usage: merge-readiness-report.mjs --output <report.json> --run-id <id> --validator name=verdict.json [--validator name=verdict.json ...] [--branch name] [--deviation-log <jsonl>]';
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const validators = args.validators.map(({ name, file }) => {
    const verdict = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { name, exitCode: verdictExitCode(verdict) };
  });
  const parsed = args.deviationLog
    ? parseDeviationLog(fs.readFileSync(args.deviationLog, 'utf8'))
    : { entries: [], errors: [] };
  const report = buildMergeReadiness({
    runId: args.runId,
    branch: args.branch,
    validators,
    deviations: parsed.entries,
    logErrors: parsed.errors,
  });
  await sealJsonNoReplace(args.output, report);
  console.log(JSON.stringify(report, null, 2));
  return report.merge_ready ? 0 : 1;
}

await runCliIfMain(import.meta.url, main, {
  onError: (error) => {
    console.error(error);
    return 2;
  },
});
