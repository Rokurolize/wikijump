import {describe, test} from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {main, refreshFromFiles} from '../scripts/refresh-source-dependency-audit.mjs';
import {currentThemeBytes, dependencySurface, refreshSourceDependencyAudit, SourceDependencyAuditError} from '../src/source-dependency-audit-refresh.mjs';

const themeLab = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(themeLab, '../../..');
const AUDIT = 'publication/evidence/audits/theme-lab-source-dependency-freeze-audit-20261006.json';
const audit = JSON.parse(fs.readFileSync(path.join(themeLab, AUDIT), 'utf8'));
const graph = JSON.parse(fs.readFileSync(path.join(themeLab, 'publication/dependency-graph.json'), 'utf8'));
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const basaltNow = currentThemeBytes(themeLab, graph, 'theme:basalt');
const DATE = '2026-10-23';

function withBasalt(mutate) {
  const copy = structuredClone(audit);
  mutate(copy.themes.find(row => row.theme === 'theme:basalt'));
  return copy;
}

// Audit-era bytes that differ from the current bytes only outside the dependency
// surface: a trailing CSS comment is not an include or @import.
function nonSurfacePrior() {
  const source = Buffer.from(`${basaltNow.sourceBytes.toString('utf8')}\n/* audit-era note */\n`);
  const css = Buffer.from(`${basaltNow.cssBytes.toString('utf8')}\n/* audit-era note */\n`);
  return {source, css};
}

function priorMap(entries) {
  const map = new Map(entries.map(bytes => [sha(bytes), bytes]));
  return sha256 => {
    if (!map.has(sha256)) throw new Error('not in test store');
    return map.get(sha256);
  };
}

// Audit-era bytes for every theme whose bytes moved past an audit, recovered
// from git history: for each stale row, the newest blob in the file's history
// whose SHA-256 equals the recorded hash (the same recorded-history mechanism
// the basalt block at the bottom uses for commit 8f0573bdd3). Cached per audit.
const eraPriorMaps = new WeakMap();
function auditEraPriorMap(auditObject) {
  if (eraPriorMaps.has(auditObject)) return eraPriorMaps.get(auditObject);
  const findBlob = (repoRelative, expected, isCss) => {
    const commits = spawnSync('git', ['-C', repo, 'log', '--all', '--format=%H', '--', repoRelative], {encoding: 'utf8'}).stdout.trim().split('\n').filter(Boolean).slice(0, 300);
    for (const commit of commits) {
      const blob = spawnSync('git', ['-C', repo, 'show', `${commit}:${repoRelative}`], {maxBuffer: 64 * 1024 * 1024}).stdout;
      if (!blob?.length) continue;
      if ((isCss ? sha(blob.toString('utf8')) : sha(blob)) === expected) return blob;
    }
    throw new Error(`audit-era bytes ${expected} not found in git history of ${repoRelative}`);
  };
  const entries = [];
  for (const row of auditObject.themes) {
    const current = currentThemeBytes(themeLab, graph, row.theme);
    if (current.source === row.candidate_source_sha256 && current.css === (row.candidate_css_sha256 ?? null)) continue;
    const node = graph.nodes.find(candidate => candidate.id === row.theme);
    const sourceRelative = path.relative(repo, path.resolve(themeLab, 'publication', node.publication_source)).split(path.sep).join('/');
    entries.push(findBlob(sourceRelative, row.candidate_source_sha256, false));
    if (row.candidate_css_sha256) entries.push(findBlob(path.posix.join(path.posix.dirname(sourceRelative), 'candidate.css'), row.candidate_css_sha256, true));
  }
  const map = priorMap(entries);
  eraPriorMaps.set(auditObject, map);
  return map;
}

// Era priors for the shared 2026-10-06 audit plus any synthetic entries a test
// adds for basalt; the synthetic hashes are distinct, so both maps coexist.
function mergedPriorMap(extraEntries) {
  const era = auditEraPriorMap(audit);
  const extra = priorMap(extraEntries);
  return sha256 => {
    try {
      return extra(sha256);
    } catch {
      return era(sha256);
    }
  };
}

describe('dependency surface', () => {
  test('captures include directives and @import rules from both source and CSS', () => {
    const surface = dependencySurface('a [[include :scp-jp:component:x]] b @import url(y);\n', '@import url(z);');
    assert.deepEqual(surface, {
      includes: ['[[include :scp-jp:component:x]]'],
      source_imports: ['@import url(y)'],
      css_imports: ['@import url(z)'],
    });
  });

  test('an unterminated trailing @import does not absorb following content', () => {
    const before = '[[module CSS]]\n@import url("https://example.com/theme.css");\n@import url("https://example.com/local--code/theme:x/1")\n[[/module]]\n[[include :scp-jp:component:interwiki-style\n| theme=https://example.com/theme:x/1\n]]\n';
    const after = before + '[[module CSS]]\n/* appended adaptation module */\n.credit-back a { white-space: nowrap; }\n[[/module]]\n';
    assert.deepEqual(dependencySurface(after, ''), dependencySurface(before, ''));
  });

  test('an unterminated trailing [[include does not absorb following content', () => {
    const before = '[[include :scp-jp:theme:bedrock]]\n@import url("https://example.com/theme.css");\n[[include :scp-jp:component:interwiki-style\n| theme=https://example.com/theme:x/1\n';
    const after = before + '\n[[module CSS]]\n/* appended adaptation module */\n#action-area { background: none; }\n[[/module]]\n';
    assert.deepEqual(dependencySurface(after, ''), dependencySurface(before, ''));
    assert.deepEqual(dependencySurface(before, '').includes.at(-1),
      '[[include :scp-jp:component:interwiki-style\n| theme=https://example.com/theme:x/1');
  });

  test('still detects a changed unterminated trailing [[include target', () => {
    const before = '[[include :scp-jp:component:interwiki-style\n| theme=https://example.com/theme:x/1\n';
    const after = '[[include :scp-jp:component:interwiki-style\n| theme=https://example.com/theme:y/1\n[[module CSS]]\n[[/module]]\n';
    assert.notDeepEqual(dependencySurface(after, ''), dependencySurface(before, ''));
  });

  test('still detects a changed trailing @import target', () => {
    const before = '@import url("https://example.com/theme:x/1")\n';
    const after = '@import url("https://example.com/theme:y/1")\n';
    assert.notDeepEqual(dependencySurface(after, ''), dependencySurface(before, ''));
  });

  test('ignores ordinary CSS and text', () => {
    assert.deepEqual(dependencySurface('plain text', 'a { color: red; }'), {includes: [], source_imports: [], css_imports: []});
  });
});

describe('source-dependency audit refresh', () => {
  test('recomputes changed candidate hashes when the dependency surface is unchanged', () => {
    const prior = nonSurfacePrior();
    const mutated = withBasalt(row => {
      row.candidate_source_sha256 = sha(prior.source);
      row.candidate_css_sha256 = sha(prior.css);
    });
    const result = refreshSourceDependencyAudit({
      audit: mutated,
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source, prior.css]),
      predecessorSha256: 'f'.repeat(64),
    });
    const basalt = result.audit.themes.find(row => row.theme === 'theme:basalt');
    assert.equal(basalt.candidate_source_sha256, basaltNow.source);
    assert.equal(basalt.candidate_css_sha256, basaltNow.css);
    assert.equal(result.changes.length, themesWithStaleHashes(mutated).length);
    assert.equal(result.audit.generated_at, DATE);
    assert.equal(result.audit.predecessor.sha256, 'f'.repeat(64));
    assert.equal(result.audit.candidate_identity_refresh.refreshed_at, DATE);
    assert.equal(result.audit.candidate_identity_refresh.dependency_observations_unchanged, true);
    assert.equal(result.audit.candidate_identity_refresh.source_files_verified, audit.themes.length);
    assert.equal(result.audit.candidate_identity_refresh.css_files_verified, audit.themes.filter(row => row.candidate_css_sha256).length);
    const refreshRow = result.audit.candidate_identity_refresh.themes.find(row => row.theme === 'theme:basalt');
    assert.equal(refreshRow.candidate_source_sha256, basaltNow.source);
    assert.equal(refreshRow.candidate_css_sha256, basaltNow.css);
    assert.equal(result.text.endsWith('\n'), true);
  });

  test('leaves the dependency rows and observed counts untouched', () => {
    const prior = nonSurfacePrior();
    const mutated = withBasalt(row => {
      row.candidate_source_sha256 = sha(prior.source);
      row.candidate_css_sha256 = sha(prior.css);
    });
    const result = refreshSourceDependencyAudit({
      audit: mutated,
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source, prior.css]),
      predecessorSha256: 'a'.repeat(64),
    });
    assert.deepEqual(result.audit.dependencies, audit.dependencies);
    assert.equal(result.audit.summary.observed_include_rows, audit.summary.observed_include_rows);
    const basalt = result.audit.themes.find(row => row.theme === 'theme:basalt');
    assert.equal(basalt.observed_dependency_count, 0);
    assert.equal(basalt.source_css_dependency_count, 2);
  });

  test('does not modify the input audit', () => {
    const before = JSON.stringify(audit);
    const prior = nonSurfacePrior();
    refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(prior.source);
        row.candidate_css_sha256 = sha(prior.css);
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source, prior.css]),
      predecessorSha256: 'a'.repeat(64),
    });
    assert.equal(JSON.stringify(audit), before);
  });

  test('a theme whose hashes already match current bytes needs no prior bytes', () => {
    const matching = structuredClone(audit);
    for (const row of matching.themes) {
      const current = currentThemeBytes(themeLab, graph, row.theme);
      row.candidate_source_sha256 = current.source;
      row.candidate_css_sha256 = current.css;
    }
    const result = refreshSourceDependencyAudit({
      audit: matching,
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: () => {
        throw new Error('no prior bytes should be requested');
      },
      predecessorSha256: 'b'.repeat(64),
    });
    assert.deepEqual(themesWithStaleHashes(matching), [], 'every other theme already matches current bytes');
    assert.deepEqual(result.changes, []);
  });

  test('refuses when the include or @import surface changed since the audit', () => {
    const prior = nonSurfacePrior();
    const changedPrior = Buffer.from(`${prior.source.toString('utf8')}\n[[include :scp-jp:component:new-dependency]]\n`);
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(changedPrior);
        row.candidate_css_sha256 = sha(prior.css);
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([changedPrior, prior.css]),
      predecessorSha256: 'c'.repeat(64),
    }), /surface changed since the audit; a dependency audit is required/u);
  });

  test('refuses CSS @import changes as well', () => {
    const prior = nonSurfacePrior();
    const changedCss = Buffer.from(`@import url(https://example.invalid/extra.css);\n${prior.css.toString('utf8')}`);
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(prior.source);
        row.candidate_css_sha256 = sha(changedCss);
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source, changedCss]),
      predecessorSha256: 'c'.repeat(64),
    }), /surface changed/u);
  });

  test('refuses when the audit-era bytes are unavailable', () => {
    const prior = nonSurfacePrior();
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(prior.source);
        row.candidate_css_sha256 = sha(prior.css);
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: () => {
        throw new Error('no file');
      },
      predecessorSha256: 'd'.repeat(64),
    }), /audit-era candidate source .* is unavailable/u);
  });

  test('refuses prior bytes that do not hash to the recorded value', () => {
    const prior = nonSurfacePrior();
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(prior.source);
        row.candidate_css_sha256 = sha(prior.css);
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: () => Buffer.from('tampered'),
      predecessorSha256: 'd'.repeat(64),
    }), /do not hash to/u);
  });

  test('refuses a theme with unresolved dependencies', () => {
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.unresolved = 1;
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([]),
      predecessorSha256: 'e'.repeat(64),
    }), /unresolved dependencies/u);
  });

  test('refuses a changed theme with no refresh row to update', () => {
    const prior = nonSurfacePrior();
    const copy = withBasalt(row => {
      row.candidate_source_sha256 = sha(prior.source);
      row.candidate_css_sha256 = sha(prior.css);
    });
    copy.candidate_identity_refresh.themes = copy.candidate_identity_refresh.themes.filter(row => row.theme !== 'theme:basalt');
    assert.throws(() => refreshSourceDependencyAudit({
      audit: copy,
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source, prior.css]),
      predecessorSha256: 'e'.repeat(64),
    }), /no candidate_identity_refresh row/u);
  });

  test('refuses a candidate.css that appears or disappears', () => {
    const prior = nonSurfacePrior();
    assert.throws(() => refreshSourceDependencyAudit({
      audit: withBasalt(row => {
        row.candidate_source_sha256 = sha(prior.source);
        row.candidate_css_sha256 = null;
      }),
      graph,
      root: themeLab,
      refreshedAt: DATE,
      priorBytes: mergedPriorMap([prior.source]),
      predecessorSha256: 'e'.repeat(64),
    }), /gained a candidate.css/u);
  });

  test('refuses an invalid refresh date and a non-audit input', () => {
    assert.throws(() => refreshSourceDependencyAudit({audit, graph, root: themeLab, refreshedAt: '2026-13-40', priorBytes: () => Buffer.alloc(0), predecessorSha256: 'e'.repeat(64)}),
      /refreshed_at must be YYYY-MM-DD/u);
    assert.throws(() => refreshSourceDependencyAudit({audit: {schema: 'other'}, graph, root: themeLab, refreshedAt: DATE, priorBytes: () => Buffer.alloc(0), predecessorSha256: 'e'.repeat(64)}),
      SourceDependencyAuditError);
  });
});

describe('source-dependency audit refresh CLI', () => {
  test('usage and refusals exit with code 2 and write nothing', () => {
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-dependency-refusal-'));
    try {
      const lines = [];
      const capture = {log: line => lines.push(line), error: line => lines.push(line)};
      assert.equal(main([], capture), 2);
      assert.equal(main(['--refreshed-at', DATE], capture), 2);
      assert.equal(main(['--refreshed-at', DATE, '--output-dir', outputDir, '--unknown', 'x'], capture), 2);
      // No prior bytes directory: the basalt hashes differ from the 2026-10-06 audit, so the refresh is refused.
      assert.equal(main(['--refreshed-at', DATE, '--output-dir', outputDir, '--audit', AUDIT], capture), 2);
      assert.match(lines.join('\n'), /--prior-bytes-dir is required/u);
      assert.deepEqual(fs.readdirSync(outputDir), []);
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
    }
  });

  test('a changed theme with a missing prior file is refused, not skipped', () => {
    const priorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-dependency-priors-'));
    try {
      const forged = path.join(priorDir, audit.themes.find(row => row.theme === 'theme:basalt').candidate_source_sha256);
      fs.writeFileSync(forged, 'not the audit-era bytes');
      assert.throws(() => refreshFromFiles({root: themeLab, refreshedAt: DATE, priorBytesDir: priorDir, outputDir: priorDir, audit: AUDIT}),
        /do not hash to|unavailable/u);
    } finally {
      fs.rmSync(priorDir, {recursive: true, force: true});
    }
  });
});

// The 2026-10-06 audit-era bytes of basalt are in commit 8f0573bdd3. With them the
// refresh must reproduce the hashes that the freeze procedure recorded.
const priorCommit = spawnSync('git', ['-C', repo, 'cat-file', '-e', '8f0573bdd3^{commit}']).status === 0;
describe('basalt refresh from the recorded audit-era commit', {skip: priorCommit ? false : 'commit 8f0573bdd3 is not present in this clone'}, () => {
  test('writes the successor with the post-fix basalt hashes and no dependency change', () => {
    const show = file => spawnSync('git', ['-C', repo, 'show', `8f0573bdd3:install/local/theme-lab/ports/basalt/${file}`], {maxBuffer: 64 * 1024 * 1024}).stdout;
    const priorSource = show('candidate.wikidot.source.txt');
    const priorCss = show('candidate.css');
    assert.equal(sha(priorSource), audit.themes.find(row => row.theme === 'theme:basalt').candidate_source_sha256);
    assert.equal(sha(priorCss), audit.themes.find(row => row.theme === 'theme:basalt').candidate_css_sha256);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-dependency-basalt-'));
    const priorDir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-dependency-basalt-priors-'));
    try {
      fs.writeFileSync(path.join(priorDir, sha(priorSource)), priorSource);
      fs.writeFileSync(path.join(priorDir, sha(priorCss)), priorCss);
      // The listed audit (from the frozen candidate set) has its own stale
      // themes on this branch; supply their audit-era bytes the same way.
      const frozen = JSON.parse(fs.readFileSync(path.join(themeLab, 'publication/frozen-candidate-set.json'), 'utf8'));
      const listedAudit = JSON.parse(fs.readFileSync(path.join(themeLab, frozen.authority.artifacts.find(artifact => artifact.id === 'source-dependency-audit').path), 'utf8'));
      const listedPriors = auditEraPriorMap(listedAudit);
      for (const row of listedAudit.themes) {
        const current = currentThemeBytes(themeLab, graph, row.theme);
        if (current.source === row.candidate_source_sha256 && current.css === (row.candidate_css_sha256 ?? null)) continue;
        fs.writeFileSync(path.join(priorDir, row.candidate_source_sha256), listedPriors(row.candidate_source_sha256));
        if (row.candidate_css_sha256) fs.writeFileSync(path.join(priorDir, row.candidate_css_sha256), listedPriors(row.candidate_css_sha256));
      }
      const lines = [];
      assert.equal(main(['--refreshed-at', DATE, '--output-dir', outputDir, '--prior-bytes-dir', priorDir, '--root', themeLab], {log: line => lines.push(line), error: line => lines.push(line)}), 0);
      const written = JSON.parse(fs.readFileSync(path.join(outputDir, `theme-lab-source-dependency-freeze-audit-${DATE}.json`), 'utf8'));
      const basalt = written.themes.find(row => row.theme === 'theme:basalt');
      assert.equal(basalt.candidate_source_sha256, '7167897315929a07f31f9008682a529351686d51ddab7a8569f6e6d06ca021d5');
      assert.equal(basalt.candidate_css_sha256, '059a0e4ff9dc0071e1c13e0bb17578722f46c783ff9227edaa9b0215649afba0');
      assert.deepEqual(written.dependencies, audit.dependencies);
    } finally {
      fs.rmSync(outputDir, {recursive: true, force: true});
      fs.rmSync(priorDir, {recursive: true, force: true});
    }
  });
});

function themesWithStaleHashes(copy) {
  return copy.themes.filter(row => {
    const current = currentThemeBytes(themeLab, graph, row.theme);
    return current.source !== row.candidate_source_sha256 || current.css !== (row.candidate_css_sha256 ?? null);
  });
}
