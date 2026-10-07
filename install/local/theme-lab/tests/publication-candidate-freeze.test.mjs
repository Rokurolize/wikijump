import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {frozenCandidateSetSha256, validatePublicationCandidateSet} from '../src/publication-candidate-freeze.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-lab-publication-freeze-'));
  const root = path.join(workspace, 'install/local/theme-lab');
  fs.mkdirSync(root, {recursive: true});
  const write = (relative, value) => {
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, bytes);
    return {path: relative, sha256: sha(bytes), bytes: bytes.length};
  };
  const css = write('ports/testtheme/candidate.css', 'body { color: black; }');
  const source = write('ports/testtheme/candidate.wikidot.source.txt', 'Theme source');
  const attachment = write('ports/testtheme/page-assets/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const dependencyAuthority = write('publication/evidence/audits/dependency-authority.json', {
    dependencies: [{slug: 'component:license-box-backend', source_sha256: 'a'.repeat(64)}],
  });
  const nodes = [
    {id: 'component:license-box-backend', site: 'scp-jp', action: 'reuse-existing', publication_source: null, source_sha256: 'a'.repeat(64), candidate_css_sha256: null, upstream: null, current_jp_source: null, status: 'current-counterpart'},
    {id: 'theme:testtheme', site: 'scp-jp', action: 'create', publication_source: '../ports/testtheme/candidate.wikidot.source.txt', source_sha256: source.sha256, candidate_css_sha256: css.sha256, upstream: null, current_jp_source: null, status: 'candidate-ready'},
  ];
  nodes[1].dependency_review = {source_css_includes: [{locator: 'component:license-box-backend', publication_node: {action: 'reuse-existing', status: 'current-counterpart', source_sha256: 'a'.repeat(64)}}]};
  const edges = [{from: 'component:license-box-backend', to: 'theme:testtheme', relation: 'runtime-include', source_sha256: 'a'.repeat(64)}];
  const inventory = {theme_nodes: 1, shared_nodes: 1, total_nodes: 2, edges: 1, attachments: 1};
  const authority = {artifacts: [{id: 'dependency-authority', path: dependencyAuthority.path, sha256: dependencyAuthority.sha256}]};
  const identity = {inventory, nodes, edges, attachments: [{node: 'theme:testtheme', filename: 'logo.png', path: attachment.path, sha256: attachment.sha256, bytes: attachment.bytes}], targeted_scenarios: [], authority};
  const candidateSetSha = frozenCandidateSetSha256(identity);
  const readiness = write('publication/evidence/audits/candidate-freeze-readiness.json', {freeze_record: {state: 'frozen-before-final-acceptance', candidate_set_sha256: candidateSetSha}});
  const frozen = {
    schema: 'theme_lab_frozen_candidate_set_identity.v1', generated_at: 'test', ...identity,
    state: 'frozen-before-final-acceptance', candidate_set_sha256: candidateSetSha,
    readiness_audit: 'evidence/audits/candidate-freeze-readiness.json', readiness_audit_sha256: readiness.sha256,
    identity_contract: 'sha256(JSON.stringify({inventory,nodes,edges,attachments,targeted_scenarios,authority}))',
  };
  write('publication/frozen-candidate-set.json', frozen);
  const graphNodes = structuredClone(nodes);
  graphNodes[1].attachments = [{filename: 'logo.png', source: '../ports/testtheme/page-assets/logo.png', sha256: attachment.sha256, bytes: attachment.bytes,
    publication_action: 'upload-as-page-attachment', status: 'required-before-publication'}];
  write('publication/dependency-graph.json', {nodes: graphNodes, edges, targeted_scenarios: [], candidate_freeze: {state: frozen.state, candidate_set_sha256: candidateSetSha}});
  return {root, workspace, candidateSetSha};
}

test('stable candidate-set identity excludes one-way evidence metadata', () => {
  const base = {inventory: {}, nodes: [], edges: [], attachments: [], targeted_scenarios: [], authority: {}};
  const identity = frozenCandidateSetSha256(base);
  assert.equal(frozenCandidateSetSha256({...base, readiness_audit_sha256: 'b'.repeat(64), targeted_evidence_bindings: [{sha256: 'c'.repeat(64)}]}), identity);
});

test('final acceptance requires the contract, graph, source, attachment and dependency authority to match the freeze', () => {
  const mock = fixture();
  try {
    assert.deepEqual(validatePublicationCandidateSet(mock.root, {expectedCandidateSetSha256: mock.candidateSetSha, contract: {candidate_set_sha256: mock.candidateSetSha}}), []);
    assert.ok(validatePublicationCandidateSet(mock.root, {contract: {candidate_set_sha256: '0'.repeat(64)}}).some(failure => failure.includes('candidate_set_sha256 is missing or stale')));

    const graphPath = path.join(mock.root, 'publication/dependency-graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    graph.edges[0].source_sha256 = 'b'.repeat(64);
    fs.writeFileSync(graphPath, JSON.stringify(graph));
    assert.ok(validatePublicationCandidateSet(mock.root).some(failure => failure.includes('actionable dependencies differ')));
  } finally {
    fs.rmSync(mock.workspace, {recursive: true, force: true});
  }
});

test('final acceptance rejects changed publication bytes and attachments', () => {
  const mock = fixture();
  try {
    fs.appendFileSync(path.join(mock.root, 'ports/testtheme/candidate.css'), ' /* drift */');
    fs.appendFileSync(path.join(mock.root, 'ports/testtheme/page-assets/logo.png'), Buffer.from([0]));
    const failures = validatePublicationCandidateSet(mock.root);
    assert.ok(failures.some(failure => failure.includes('candidate CSS SHA differs')));
    assert.ok(failures.some(failure => failure.includes('attachment identity differs')));
  } finally {
    fs.rmSync(mock.workspace, {recursive: true, force: true});
  }
});

test('final acceptance rejects stale nested publication references in the dependency graph', () => {
  const mock = fixture();
  try {
    const graphPath = path.join(mock.root, 'publication/dependency-graph.json');
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf8'));
    graph.nodes[1].dependency_review.source_css_includes[0].publication_node.source_sha256 = 'b'.repeat(64);
    fs.writeFileSync(graphPath, JSON.stringify(graph));
    assert.ok(validatePublicationCandidateSet(mock.root).some(failure => failure.includes('nested publication reference differs')));
  } finally {
    fs.rmSync(mock.workspace, {recursive: true, force: true});
  }
});
