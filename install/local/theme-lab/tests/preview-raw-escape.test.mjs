import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

function buildPreview(source) {
  const run = spawnSync('python3', ['-c', `import runpy,json,sys
b=runpy.run_path('install/local/theme-lab/ports/scripts/build-preview-source.py')['build']
p,_,omitted=b(sys.stdin.read(),'')
print(json.dumps({"preview":p,"omitted":omitted}))`], {encoding: 'utf8', input: source, cwd: new URL('../../../..', import.meta.url)});
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('an include-like sample inside a Wikidot @@ raw span is displayed literally, not treated as a directive', () => {
  const sample = '[[size 160%]]**{{@@[[include @@[[span style="opacity: 70%;"]]@@:scp-jp:@@[[/span]]@@theme:basalt]]@@}}**[[/size]]';
  const {preview, omitted} = buildPreview(`+ Article\n${sample}\n`);
  assert.ok(preview.includes(sample), 'sample preserved byte for byte');
  assert.deepEqual(omitted, []);
});

test('a real unresolved include directive outside raw spans is still omitted and reported', () => {
  const {preview, omitted} = buildPreview('+ Article\n[[include :scp-jp:component:missing-thing]]\n');
  assert.doesNotMatch(preview, /component:missing-thing/u);
  assert.ok(omitted.some(item => item.includes('missing-thing')));
});
