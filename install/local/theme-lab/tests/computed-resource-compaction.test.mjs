import test from 'node:test';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {compactComputedResources} from '../ports/scripts/capture-audit-records.mjs';
test('computed resource compaction binds exact inline bytes and preserves surrounding geometry/style',()=>{
 const bytes=Buffer.from('controlled image bytes'),hash=crypto.createHash('sha256').update(bytes).digest('hex');
 const value={width:390,backgroundImage:`linear-gradient(red,blue),url("data:image/png;base64,${bytes.toString('base64')}")`,before:{content:'JP header'}};
 const compact=compactComputedResources(value);assert.equal(compact.width,390);assert.deepEqual(compact.before,value.before);assert.equal(compact.backgroundImage,`linear-gradient(red,blue),url("data:image/png;sha256=${hash};bytes=${bytes.length}")`);
});
