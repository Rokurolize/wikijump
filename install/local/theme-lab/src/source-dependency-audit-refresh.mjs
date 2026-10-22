import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {isDeepStrictEqual} from 'node:util';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {resolveExistingContainedFile} from './package-path.mjs';

// Recomputes the candidate source and candidate.css hashes of every theme in a
// source-dependency audit from current repository bytes. A theme whose hashes
// changed is accepted only when its dependency surface (include directives and
// @import rules in the source, @import rules in the CSS) is byte-identical to
// the audit-era bytes. Those audit-era bytes must hash to the audit's recorded
// values. The dependency rows are not recomputed here. The surface comparison
// is the evidence that they did not change.

export class SourceDependencyAuditError extends Error {}

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

export function dependencySurface(sourceText, cssText) {
  return {
    includes: [...sourceText.matchAll(/\[\[include\b[\s\S]*?\]\]/gu)].map(match => match[0]),
    source_imports: [...sourceText.matchAll(/@import[^;]*/gu)].map(match => match[0]),
    css_imports: [...cssText.matchAll(/@import[^;]*/gu)].map(match => match[0]),
  };
}

// Reads a theme's publication source and its sibling candidate.css from the
// checkout, using the same containment rules as the freeze generator.
export function currentThemeBytes(root, graph, theme) {
  const node = (graph.nodes ?? []).find(candidate => candidate.id === theme);
  if (!node?.publication_source) throw new SourceDependencyAuditError(`${theme} has no publication source in the dependency graph`);
  const publication = path.join(root, 'publication');
  const sourcePath = resolveExistingContainedFile(root, node.publication_source, `${theme} publication source`, publication);
  const cssPath = path.join(path.dirname(sourcePath), 'candidate.css');
  const sourceBytes = fs.readFileSync(sourcePath);
  const cssBytes = fs.existsSync(cssPath)
    ? fs.readFileSync(resolveExistingContainedFile(root, path.relative(root, cssPath).split(path.sep).join('/'), `${theme} candidate CSS`))
    : null;
  return {
    sourceBytes,
    cssBytes,
    source: sha256(sourceBytes),
    css: cssBytes ? cssSha(cssBytes, theme) : null,
  };
}

function cssSha(bytes, theme) {
  if (!Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)) throw new SourceDependencyAuditError(`${theme} candidate CSS is not valid UTF-8`);
  const {rawSha} = candidateIdentity(bytes, '');
  return rawSha;
}

// audit: parsed source-dependency audit. graph: parsed publication dependency
// graph. priorBytes(sha256) returns the audit-era bytes for a recorded hash,
// or throws when they are unavailable. predecessorSha256 is the whole-file hash
// of the input audit, recorded in the successor. The input objects are not
// modified.
export function refreshSourceDependencyAudit({audit, graph, root, refreshedAt, priorBytes, predecessorSha256}) {
  if (!DATE.test(refreshedAt ?? '') || Number.isNaN(Date.parse(refreshedAt))) throw new SourceDependencyAuditError(`refreshed_at must be YYYY-MM-DD: ${refreshedAt}`);
  if (audit?.schema !== 'theme_lab_source_dependency_freeze_audit.v1') throw new SourceDependencyAuditError('input is not a source-dependency freeze audit');
  const successor = structuredClone(audit);
  const refresh = successor.candidate_identity_refresh;
  if (!refresh || !Array.isArray(refresh.themes)) throw new SourceDependencyAuditError('audit has no candidate_identity_refresh.themes');
  const changes = [];

  for (const row of successor.themes ?? []) {
    const theme = row.theme;
    if (row.unresolved !== 0) throw new SourceDependencyAuditError(`${theme} records ${row.unresolved} unresolved dependencies; a dependency audit is required`);
    const current = currentThemeBytes(root, graph, theme);
    if (current.source === row.candidate_source_sha256 && current.css === (row.candidate_css_sha256 ?? null)) continue;
    if ((row.candidate_css_sha256 ?? null) === null && current.css !== null) {
      throw new SourceDependencyAuditError(`${theme} gained a candidate.css; a dependency audit is required`);
    }
    if (row.candidate_css_sha256 && current.css === null) {
      throw new SourceDependencyAuditError(`${theme} lost its candidate.css; a dependency audit is required`);
    }
    const priorSource = loadPrior(priorBytes, row.candidate_source_sha256, theme, 'candidate source');
    const priorCss = row.candidate_css_sha256 ? loadPrior(priorBytes, row.candidate_css_sha256, theme, 'candidate CSS') : null;
    const before = dependencySurface(priorSource.toString('utf8'), priorCss ? priorCss.toString('utf8') : '');
    const after = dependencySurface(current.sourceBytes.toString('utf8'), current.cssBytes ? current.cssBytes.toString('utf8') : '');
    if (!isDeepStrictEqual(before, after)) {
      throw new SourceDependencyAuditError(`${theme}: include or @import surface changed since the audit; a dependency audit is required`);
    }
    const refreshRow = refresh.themes.find(candidate => candidate.theme === theme);
    if (!refreshRow) throw new SourceDependencyAuditError(`${theme} has no candidate_identity_refresh row to update`);
    const from = {source: row.candidate_source_sha256, css: row.candidate_css_sha256 ?? null};
    row.candidate_source_sha256 = current.source;
    row.candidate_css_sha256 = current.css;
    for (const key of ['source_sha256', 'candidate_source_sha256', 'candidate_css_sha256']) {
      if (Object.hasOwn(refreshRow, key)) refreshRow[key] = key === 'candidate_css_sha256' ? current.css : current.source;
    }
    refresh.refresh_details = [...(refresh.refresh_details ?? []), {
      theme,
      reason: `Candidate hashes refreshed from current repository bytes at ${refreshedAt}; the include and @import surface is byte-identical to the audit-era bytes (source ${from.source}, CSS ${from.css}).`,
    }];
    changes.push({theme, from, to: {source: current.source, css: current.css}});
  }

  // Every row was computed here, so the counts describe the successor.
  const themeRows = successor.themes ?? [];
  refresh.refreshed_at = refreshedAt;
  refresh.source_files_verified = themeRows.length;
  refresh.css_files_verified = themeRows.filter(row => row.candidate_css_sha256).length;
  refresh.dependency_observations_unchanged = true;
  successor.generated_at = refreshedAt;
  successor.predecessor = {sha256: predecessorSha256};
  return {audit: successor, text: serialize(successor), changes};
}

function loadPrior(priorBytes, expected, theme, label) {
  let bytes;
  try {
    bytes = priorBytes(expected);
  } catch (error) {
    throw new SourceDependencyAuditError(`${theme}: audit-era ${label} ${expected} is unavailable: ${error.message}`);
  }
  if (sha256(bytes) !== expected) throw new SourceDependencyAuditError(`${theme}: audit-era ${label} bytes do not hash to ${expected}`);
  return bytes;
}

export {sha256 as sourceAuditSha256, serialize as serializeSourceDependencyAudit};
