#!/usr/bin/env node
// Writes the candidate-freeze readiness audit for a regenerated candidate set.
// The record binds freeze_record.candidate_set_sha256 to the identity computed
// from current repository bytes. Its counts and checks come from the freeze
// generator and the source-dependency audit. The final-acceptance statuses are
// pending unless an explicit --final-acceptance file says otherwise. No old
// verdict is copied forward.
//
// The record is refused when the candidate inputs have findings or validator
// failures that are not evidence gaps. An evidence gap is a missing or stale
// targeted receipt or visual review, which the record lists as pending.
//
// Pass the written file to build-candidate-freeze.mjs with --readiness-audit.
// The file is written only to --output-dir.

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {buildCandidateFreeze, CandidateFreezeError} from './build-candidate-freeze.mjs';

export const THEME_LAB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA = 'theme_lab_candidate_freeze_readiness_audit.v1';
const EVIDENCE_FINDINGS = new Set(['readiness-binding-stale', 'targeted-evidence-missing', 'targeted-evidence-stale']);
const EVIDENCE_FAILURE = /targeted|visual review|receipt|screenshot|readiness audit|readiness/iu;
const STATUSES = new Set(['pending', 'pass', 'fail']);
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/u;
const FINAL_KEYS = ['sigma9', 'sigma10', 'visual_review'];
const SCOPE = 'Freeze readiness only; Sigma-9, Sigma-10, and final theme visual acceptance are not part of this record.';

export class ReadinessAuditError extends CandidateFreezeError {}

function finalAcceptanceFrom(value) {
  const acceptance = {sigma9: 'pending', sigma10: 'pending', visual_review: 'pending'};
  if (value === null) return acceptance;
  for (const key of Object.keys(value)) {
    if (!FINAL_KEYS.includes(key)) throw new ReadinessAuditError(`final-acceptance has an unknown key: ${key}`);
    if (!STATUSES.has(value[key])) throw new ReadinessAuditError(`final-acceptance ${key} must be pending, pass, or fail`);
    acceptance[key] = value[key];
  }
  return acceptance;
}

// Pure generation. Returns the readiness record, its text, and the freeze
// result it was derived from. Throws when a candidate input has an identity
// finding, so that no record can bind a set that is not internally consistent.
export function buildReadinessAudit({root = THEME_LAB, generatedAt, sourceDependencyAudit = null, finalAcceptance = null} = {}) {
  if (!DATE.test(generatedAt ?? '') || Number.isNaN(Date.parse(generatedAt))) {
    throw new ReadinessAuditError(`generated-at must be an ISO-8601 UTC timestamp: ${generatedAt}`);
  }
  const acceptance = finalAcceptanceFrom(finalAcceptance);
  const relative = `evidence/audits/theme-lab-candidate-freeze-readiness-${generatedAt.slice(0, 10)}.json`;
  // The identity does not depend on the readiness file, so a placeholder is
  // used for the first pass. The second pass validates the real record.
  const first = buildCandidateFreeze({root, generatedAt, sourceDependencyAudit, readinessAudit: relative,
    readinessDocument: {bytes: Buffer.alloc(0), value: {}}});
  const candidateSetSha = first.candidateSetSha256;
  const sourceAudit = JSON.parse(fs.readFileSync(path.join(root, first.frozen.authority.artifacts.find(artifact => artifact.id === 'source-dependency-audit').path), 'utf8'));

  const record = {
    schema: SCHEMA,
    generated_at: generatedAt,
    decision: null,
    scope: SCOPE,
    counts: {
      theme_nodes: first.frozen.inventory.theme_nodes,
      shared_component_fragment_nodes: first.frozen.inventory.shared_nodes,
      total_nodes: first.frozen.inventory.total_nodes,
      explicit_publication_edges: first.frozen.inventory.edges,
      unique_attachment_entries: first.frozen.inventory.attachments,
      publication_sources_verified: first.frozen.nodes.filter(node => node.publication_source).length,
      theme_candidate_css_verified: first.frozen.nodes.filter(node => node.candidate_css_sha256).length,
      dependency_observations: sourceAudit.summary?.observed_include_rows ?? null,
      unique_included_pages: sourceAudit.summary?.unique_include_pages ?? null,
    },
    checks: {},
    source_artifacts: first.frozen.nodes.filter(node => node.publication_source).map(node => ({
      node: node.id,
      action: node.action,
      path: node.publication_source,
      source_sha256: node.source_sha256,
      candidate_css_sha256: node.candidate_css_sha256,
    })),
    attachments: first.frozen.attachments,
    authority_artifacts: first.frozen.authority.artifacts,
    freeze_record: {state: first.frozen.state, candidate_set_sha256: candidateSetSha, final_acceptance: acceptance},
    errors: [],
  };

  // Second pass: the record is validated in memory before it is written.
  const text = `${JSON.stringify(record, null, 2)}\n`;
  const second = buildCandidateFreeze({root, generatedAt, sourceDependencyAudit, readinessAudit: relative,
    readinessDocument: {bytes: Buffer.from(text), value: JSON.parse(text)}});
  if (second.candidateSetSha256 !== candidateSetSha) throw new ReadinessAuditError('candidate-set identity changed between passes');

  const identityFindings = second.findings.filter(item => !EVIDENCE_FINDINGS.has(item.code));
  if (identityFindings.length) {
    throw new ReadinessAuditError(`candidate inputs have ${identityFindings.length} identity findings; resolve them before writing readiness: ${identityFindings.map(item => `${item.code} ${item.subject}`).join('; ')}`);
  }
  const unexpectedFailures = second.validation.filter(failure => !EVIDENCE_FAILURE.test(failure));
  if (unexpectedFailures.length) {
    throw new ReadinessAuditError(`validatePublicationCandidateSet reports ${unexpectedFailures.length} non-evidence failures: ${unexpectedFailures.join('; ')}`);
  }
  const pendingEvidence = [
    ...second.findings.filter(item => EVIDENCE_FINDINGS.has(item.code)).map(item => `${item.code} ${item.subject}`),
    ...second.validation.map(failure => `validator ${failure}`),
  ];
  record.checks = {
    inventory: 'pass',
    source_css_identities: {status: 'pass', source_pages_verified: record.counts.theme_nodes, css_files_verified: record.counts.theme_candidate_css_verified},
    attachments: {status: 'pass', count: record.counts.unique_attachment_entries},
    authority: {status: 'pass', artifacts: record.authority_artifacts.map(artifact => artifact.id)},
    identity_findings: 0,
    pending_evidence: pendingEvidence,
  };
  record.decision = pendingEvidence.length ? 'identity-bound-evidence-pending' : 'ready-for-final-acceptance';
  const finalText = `${JSON.stringify(record, null, 2)}\n`;
  return {record, text: finalText, relative, candidateSetSha256: candidateSetSha, pendingEvidence};
}

function parseArguments(argv) {
  const options = {root: THEME_LAB, generatedAt: null, outputDir: null, sourceDependencyAudit: null, finalAcceptance: null};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new ReadinessAuditError(`${argument} requires a value`);
      index += 1;
      return next;
    };
    if (argument === '--root') options.root = path.resolve(value());
    else if (argument === '--generated-at') options.generatedAt = value();
    else if (argument === '--output-dir') options.outputDir = path.resolve(value());
    else if (argument === '--source-dependency-audit') options.sourceDependencyAudit = value();
    else if (argument === '--final-acceptance') options.finalAcceptance = path.resolve(value());
    else throw new ReadinessAuditError(`unknown argument: ${argument}`);
  }
  if (!options.generatedAt || !options.outputDir) {
    throw new ReadinessAuditError('usage: build-readiness-audit.mjs --generated-at ISO-8601-UTC --output-dir DIR [--source-dependency-audit ROOT_RELATIVE] [--final-acceptance FILE] [--root DIR]');
  }
  return options;
}

export function main(argv = process.argv.slice(2), {log = console.log, error = console.error} = {}) {
  let options;
  let result;
  try {
    options = parseArguments(argv);
    const finalAcceptance = options.finalAcceptance ? JSON.parse(fs.readFileSync(options.finalAcceptance, 'utf8')) : null;
    result = buildReadinessAudit({root: options.root, generatedAt: options.generatedAt,
      sourceDependencyAudit: options.sourceDependencyAudit, finalAcceptance});
  } catch (failure) {
    error(`readiness audit refused: ${failure.message}`);
    return 2;
  }
  fs.mkdirSync(options.outputDir, {recursive: true});
  const output = path.join(options.outputDir, path.basename(result.relative));
  fs.writeFileSync(output, result.text);
  log(`wrote ${output}`);
  log(`candidate_set_sha256 ${result.candidateSetSha256}`);
  log(`decision ${result.record.decision}; pending evidence: ${result.pendingEvidence.length}`);
  log(`next: copy to publication/${result.relative} and pass --readiness-audit ${result.relative} to build-candidate-freeze.mjs`);
  return 0;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = main();
}
