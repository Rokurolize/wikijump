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

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

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
    frozenCandidateCommit: null,
    prHead: null,
    allowedStatus: null,
    candidateReviewFreeze: null,
  };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      return value;
    };
    if (arg === '--output' || arg === '--branch' || arg === '--deviation-log' || arg === '--run-id' || arg === '--frozen-candidate-commit' || arg === '--pr-head' || arg === '--allowed-status' || arg === '--candidate-review-freeze') {
      if (seen.has(arg)) throw new Error(`${arg} may be supplied only once`);
      seen.add(arg);
      const value = next();
      if (arg === '--output') args.output = value;
      else if (arg === '--branch') args.branch = value;
      else if (arg === '--deviation-log') args.deviationLog = value;
      else if (arg === '--run-id') args.runId = value;
      else if (arg === '--frozen-candidate-commit') args.frozenCandidateCommit = value;
      else if (arg === '--pr-head') args.prHead = value;
      else if (arg === '--allowed-status') args.allowedStatus = value;
      else args.candidateReviewFreeze = value;
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
  for (const [name, value] of [["--frozen-candidate-commit", args.frozenCandidateCommit], ["--pr-head", args.prHead]]) {
    if (!/^[0-9a-f]{40}$/u.test(value ?? "") || /^(.)\1+$/u.test(value)) throw new Error(`${name} must be a real full Git commit`);
  }
  if (!args.allowedStatus) throw new Error('--allowed-status is required');
  if (!args.candidateReviewFreeze) throw new Error('--candidate-review-freeze is required');
  if (args.validators.length === 0) throw new Error('at least one --validator is required');
  return args;
}

// Derive an effective exit code from a verdict file's own aggregate.
export function verdictExitCode(verdict) {
  if (Object.hasOwn(verdict ?? {}, 'exit_code')) {
    return Number.isInteger(verdict.exit_code) && verdict.exit_code >= 0 ? verdict.exit_code : 2;
  }
  const aggregate = verdict?.aggregate;
  if (aggregate !== null && typeof aggregate === 'object' && !Array.isArray(aggregate)) {
    if (Object.hasOwn(aggregate, 'unclassified') && (!Number.isInteger(aggregate.unclassified) || aggregate.unclassified < 0)) return 2;
    if (Object.hasOwn(aggregate, 'regressions') && !Array.isArray(aggregate.regressions)) return 2;
    if (Object.hasOwn(aggregate, 'fail') && (!Number.isInteger(aggregate.fail) || aggregate.fail < 0)) return 2;
    if (Number.isInteger(aggregate.unclassified) || Array.isArray(aggregate.regressions) || Number.isInteger(aggregate.fail)) {
      if (aggregate.unclassified > 0) return 2;
      return (aggregate.regressions?.length ?? 0) > 0 || aggregate.fail > 0 ? 1 : 0;
    }
  }
  return 2;
}

function inputReference(file) {
  const absolute = path.resolve(file);
  const bytes = fs.readFileSync(absolute);
  return {path: absolute, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}

function readAllowedStatus(file, prHead) {
  const reference = inputReference(file);
  const value = JSON.parse(fs.readFileSync(reference.path, 'utf8'));
  if (value?.schemaVersion !== 1 || value?.state !== 'OPEN' || value?.mergeable !== 'MERGEABLE' || value?.mergeStateStatus !== 'CLEAN' || value?.overall !== 'passing' || value?.subject?.headSha !== prHead) {
    throw new Error('allowed status is missing, stale, or not mergeable for the PR head');
  }
  return {...reference, head_sha: value.subject.headSha, status: value.overall};
}

function readCandidateReviewFreeze(file, frozenCandidateCommit) {
  const reference = inputReference(file);
  const value = JSON.parse(fs.readFileSync(reference.path, 'utf8'));
  const candidate = value?.candidate;
  if (value?.schema !== 'wikijump.standing_candidate_parity_identity.v1' || value?.status !== 'sealed' || typeof candidate?.run_id !== 'string' || candidate.run_id === '' || candidate.wikijump_commit !== frozenCandidateCommit || !/^[0-9a-f]{40}$/u.test(candidate.wikijump_tree ?? '') || /^(.)\1+$/u.test(candidate.wikijump_tree)) {
    throw new Error('candidate review freeze is missing or does not bind the frozen candidate');
  }
  return {...reference, run_id: candidate.run_id, candidate_commit: candidate.wikijump_commit, candidate_tree: candidate.wikijump_tree};
}

function validatorInput(file) {
  const absolute = path.resolve(file);
  const bytes = fs.readFileSync(absolute);
  return {path: absolute, sha256: crypto.createHash('sha256').update(bytes).digest('hex')};
}

export function usage() {
  return 'Usage: merge-readiness-report.mjs --output <report.json> --run-id <id> --frozen-candidate-commit <commit> --pr-head <commit> --allowed-status <status.json> --candidate-review-freeze <identity.json> --validator name=verdict.json [--validator name=verdict.json ...] [--branch name] [--deviation-log <jsonl>]';
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return 0;
  }
  const allowedStatus = readAllowedStatus(args.allowedStatus, args.prHead);
  const candidateReviewFreeze = readCandidateReviewFreeze(args.candidateReviewFreeze, args.frozenCandidateCommit);
  const validators = args.validators.map(({ name, file }) => {
    const verdict = JSON.parse(fs.readFileSync(file, 'utf8'));
    return {name, exitCode: verdictExitCode(verdict), ...validatorInput(file)};
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
    frozenCandidateCommit: args.frozenCandidateCommit,
    prHead: args.prHead,
    allowedStatus,
    candidateReviewFreeze,
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
