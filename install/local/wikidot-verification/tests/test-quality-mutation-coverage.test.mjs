import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

import {segmentAt, mapSurvivorsToCoverage} from '../../../../scripts/test-quality-mutation-coverage.mjs';

const segments = [
  [10, 1, 4, true, true, false],
  [10, 17, 0, true, true, false],
  [11, 1, 4, true, true, false],
  [11, 18, 0, false, false, false],
  [13, 1, 2, true, true, false],
];
const mutation = (line, col) => `src/services/render/list_pages/scanner.rs:${line}:${col}: replace + with - in scanner`;

const llvm = {data:[{files:[
  {filename:'/test/deepwell/src/services/render/list_pages/scanner.rs',
    segments, summary:{lines:{count:5,covered:4}}},
  {filename:'/test/deepwell/tests/list_pages.rs', segments, summary:{lines:{count:50,covered:50}}},
]}]};

test('LLVM coverage chooses the countable segment at the exact mutation column', () => {
  assert.equal(segmentAt(segments, 10, 12)?.count, 4);
  assert.equal(segmentAt(segments, 10, 18)?.count, 0);
  assert.equal(segmentAt(segments, 11, 8)?.count, 4);
  assert.equal(segmentAt(segments, 12, 12), null);
  assert.equal(segmentAt(segments, 13, 3)?.count, 2);
  assert.equal(segmentAt([[20, 1, 2, true, true, true]], 20, 8), null, 'LLVM gap regions cannot be treated as executed code');
});

test('uncovered, covered and noncountable loci remain separate', () => {
  const reconciliation = {unresolved_survivors:[mutation(10,12),mutation(10,18),mutation(12,12)]};
  const result = mapSurvivorsToCoverage(reconciliation, llvm, 'deepwell/src/services/render/list_pages/scanner.rs');
  assert.equal(result.survivors, 3);
  assert.deepEqual(result.counts, {zero_count:1,positive_count:1,no_countable_segment:1});
  assert.match(result.interpretation, /no combined coverage/u);
  assert.equal(result.sites[0].execution_count, 4);
  assert.equal(result.sites[1].execution_count, 0);
  assert.equal(result.sites[2].execution_count, null);
});

test('missing, duplicate and malformed LLVM sources fail closed', () => {
  const base={unresolved_survivors:[mutation(10,12)]};
  const source='deepwell/src/services/render/list_pages/scanner.rs';
  assert.throws(()=>mapSurvivorsToCoverage(base,{data:[{files:[]}]},source),/expected one/u);
  assert.throws(()=>mapSurvivorsToCoverage(base,{data:[{files:[llvm.data[0].files[0],llvm.data[0].files[0]]}]},source),/found 2/u);
  assert.throws(()=>mapSurvivorsToCoverage(base,{data:[{files:[{filename:'/test/'+source,segments:[]}]}]},source),/lacks line\/segment/u);
  assert.throws(()=>segmentAt([[1]],1,1),/invalid LLVM segment/u);
  assert.throws(()=>mapSurvivorsToCoverage({unresolved_survivors:['other mutant']},llvm,source),/cannot parse/u);
  assert.throws(()=>mapSurvivorsToCoverage({unresolved_survivors:[mutation(10,12),mutation(10,12)]},llvm,source),/duplicate survivor/u);
});

test('CLI rejects source digest drift and refuses overwriting reports', (t) => {
  const dir=mkdtempSync(join(tmpdir(),'wj-mutation-coverage-'));
  t.after(()=>rmSync(dir,{force:true,recursive:true}));
  const report=join(dir,'llvm.json'); const reconcile=join(dir,'reconcile.json'); const source=join(dir,'scanner.rs'); const out=join(dir,'output.json');
  writeFileSync(report,JSON.stringify(llvm));
  writeFileSync(reconcile,JSON.stringify({unresolved_survivors:[mutation(10,17)]}));
  writeFileSync(source,'test-fixture');
  const script=resolve(fileURLToPath(new URL('../../../../scripts/test-quality-mutation-coverage.mjs',import.meta.url)));
  const args=[script,'--llvm',report,'--reconciliation',reconcile,'--source',source,'--source-sha256','0'.repeat(64),'--output',out];
  const process1=spawnSync(process.execPath,args,{encoding:'utf8'});
  assert.notEqual(process1.status,0);
  assert.match(process1.stderr,/source SHA mismatch/u);
  assert.equal(readFileSync(source,'utf8'),'test-fixture');
  const correctSha=createHash('sha256').update('test-fixture').digest('hex');
  const successArgs=[script,'--llvm',report,'--reconciliation',reconcile,'--source','scanner.rs','--source-sha256',correctSha,'--output',out];
  const success=spawnSync(process.execPath,successArgs,{cwd:dir,encoding:'utf8'});
  assert.equal(success.status,0,success.stderr);
  assert.equal(JSON.parse(readFileSync(out,'utf8')).counts.zero_count,1);
  const overwrite=spawnSync(process.execPath,successArgs,{cwd:dir,encoding:'utf8'});
  assert.notEqual(overwrite.status,0);
  assert.match(overwrite.stderr,/refusing to overwrite/u);
});
