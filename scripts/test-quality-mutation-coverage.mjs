import {createHash} from 'node:crypto';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** LLVM segments are ordered positions: [line, column, count, hasCount, ...]. */
export function segmentAt(segments, line, column) {
  if (!Array.isArray(segments) || !Number.isInteger(line) || !Number.isInteger(column)) {
    throw new Error('invalid LLVM segments or mutation coordinates');
  }
  let current;
  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 4 ||
        !Number.isInteger(segment[0]) || !Number.isInteger(segment[1]) ||
        !Number.isInteger(segment[2]) || typeof segment[3] !== 'boolean') {
      throw new Error('invalid LLVM segment');
    }
    if (segment[0] > line || (segment[0] === line && segment[1] > column)) break;
    current = segment;
  }
  return current && current[3] && !current[5]
    ? {count: current[2], start_line: current[0], start_column: current[1]} : null;
}

export function mapSurvivorsToCoverage(reconciled, llvm, sourceSuffix) {
  if (!Array.isArray(reconciled?.unresolved_survivors)) {
    throw new Error('reconciliation report lacks a survivor inventory');
  }
  if (typeof sourceSuffix !== 'string' || !sourceSuffix || sourceSuffix.startsWith('/')) {
    throw new Error('source suffix must be repository-relative');
  }
  const matches = (llvm?.data ?? []).flatMap((entry) => entry.files ?? [])
    .filter((file) => file.filename?.replaceAll('\\', '/').endsWith(`/${sourceSuffix}`));
  if (matches.length !== 1) throw new Error(`expected one instrumented source ${sourceSuffix}, found ${matches.length}`);
  const target = matches[0];
  if (!Array.isArray(target.segments) || !target.summary?.lines) {
    throw new Error('source lacks line/segment evidence');
  }
  const counts = {zero_count: 0, positive_count: 0, no_countable_segment: 0};
  const seen = new Set();
  const sites = reconciled.unresolved_survivors.map((mutation) => {
    if (seen.has(mutation)) throw new Error(`duplicate survivor identity: ${mutation}`);
    seen.add(mutation);
    const match = mutation.match(/(?:^|\/)scanner\.rs:(\d+):(\d+):/u);
    if (!match) throw new Error(`cannot parse scanner mutation locus: ${mutation}`);
    const line = Number(match[1]);
    const column = Number(match[2]);
    const segment = segmentAt(target.segments, line, column);
    const status = !segment ? 'no_countable_segment' : segment.count === 0 ? 'zero_count' : 'positive_count';
    counts[status] += 1;
    return {mutation, line, column, status,
      execution_count: segment?.count ?? null,
      active_segment: segment ? [segment.start_line, segment.start_column] : null};
  });
  return {
    schema: 1,
    interpretation: 'Per-mutation-site LLVM unit-suite execution only; no combined coverage or behavioral/equivalence disposition',
    source: sourceSuffix,
    instrumented_filename: target.filename,
    instrumented_file_summary: target.summary,
    survivors: sites.length,
    counts,
    sites,
  };
}

function main(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i]?.startsWith('--') || !args[i+1] || options.has(args[i])) {
      throw new Error(`invalid option ${args[i]}`);
    }
    options.set(args[i], args[i+1]);
  }
  const keys = ['--llvm', '--reconciliation', '--source', '--source-sha256', '--output'];
  if (options.size !== keys.length || keys.some((key) => !options.has(key))) {
    throw new Error(`usage: ${keys.map((key) => `${key} VALUE`).join(' ')}`);
  }
  const source = options.get('--source');
  const sourceSha = hash(readFileSync(resolve(source)));
  if (sourceSha !== options.get('--source-sha256')) throw new Error('source SHA mismatch');
  const llvm = readFileSync(options.get('--llvm'));
  const reconciliation = readFileSync(options.get('--reconciliation'));
  const report = mapSurvivorsToCoverage(JSON.parse(reconciliation), JSON.parse(llvm), source);
  report.provenance = {
    observed_source_sha256: sourceSha,
    llvm_json_sha256: hash(llvm),
    reconciliation_sha256: hash(reconciliation),
    limit: 'The exact source bytes are verified at analysis time, not embedded by LLVM in its coverage JSON. Attribute only to a fresh run on an immutable worktree.',
  };
  const output = resolve(options.get('--output'));
  if (existsSync(output)) throw new Error(`refusing to overwrite report: ${output}`);
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, {flag:'wx'});
  console.log(`Mapped ${report.survivors} survivors: ${JSON.stringify(report.counts)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode=1; }
}
