import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('display previews strip attributed CSS modules and keep valid rating block delimiters',()=>{
 const run=spawnSync('python3',['-c',`import runpy,json
b=runpy.run_path('install/local/theme-lab/ports/scripts/build-preview-source.py')['build']
p,_,_=b('[[module CSS show="true"]]body{color:red}[[/module]]\\n+ Article\\n','')
print(json.dumps(p))`],{encoding:'utf8',cwd:new URL('../../../..',import.meta.url)});
 assert.equal(run.status,0,run.stderr);
 const preview=JSON.parse(run.stdout);
 assert.doesNotMatch(preview,/module\s+CSS|body\{color:red/iu);
 assert.doesNotMatch(preview,/\[\[div[^\n]*\[\[div/u);
 assert.match(preview,/class="page-rate-widget-box"/u);
 assert.match(preview,/class="rate-points"/u);
 assert.doesNotMatch(preview,/module\s+Rate/iu);
 assert.match(preview,/Article/u);
});
