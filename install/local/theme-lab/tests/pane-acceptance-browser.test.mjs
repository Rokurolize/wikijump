import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {loadChromium} from '../src/browser-lab.mjs';
import {runKnownSurfaceContract} from '../src/theme-surface-contract.mjs';

test('surface acceptance opens History and Files independently and closes each pane',async()=>{
 const server=http.createServer((request,response)=>response.end(`<!doctype html><html><body>
 <button id="history-button">History</button><button id="files-button">Files</button><div id="action-area"></div>
 <script>
 const area=document.getElementById('action-area');window.opened=[];
 function show(kind,html){window.opened.push(kind);area.innerHTML='<button class="action-area-close">Close</button>'+html;area.querySelector('button').onclick=()=>area.innerHTML=''}
 document.getElementById('history-button').onclick=()=>show('history','<table class="page-history"><tr id="revision-row-27"><td>Revision 27</td></tr></table>');
 document.getElementById('files-button').onclick=()=>show('files','<div class="file-list"><span class="file-name">attachment.png</span></div>');
 </script></body></html>`));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await loadChromium().launch({headless:true});
 try {
  const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await runKnownSurfaceContract(page,{css:'.page-history,.file-list{color:black}',styleId:'pane-check',contractValue:'auto'});
  assert.equal(result.issues.filter(row=>row.severity==='error').length,0);
  assert.deepEqual(await page.evaluate(()=>window.opened),['history','history','history','history','files','files','files','files']);
  assert.equal(await page.locator('#action-area').textContent(),'');
  assert.ok(result.captures.every(capture=>Object.values(capture.rows).every(row=>row.present)));
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
});
