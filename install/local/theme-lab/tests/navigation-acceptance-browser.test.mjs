import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {loadChromium} from '../src/browser-lab.mjs';
import {runKnownSurfaceContract} from '../src/theme-surface-contract.mjs';

test('navigation acceptance inspects later menus and detects off-left escape without scroll overflow',async()=>{
  const server=http.createServer((request,response)=>response.end(`<!doctype html><html><head><style>
    body{margin:0} .mobile-top-bar>ul{display:flex;margin:0;padding:0;list-style:none}
    .mobile-top-bar>ul>li{position:relative;width:100px}
    .mobile-top-bar>ul>li>ul{position:absolute;left:0;top:20px;width:120px;padding:0;margin:0;display:none}
    </style></head><body><div id="top-bar"><div class="mobile-top-bar"><ul>
    ${[1,2,3].map(i=>`<li>Menu ${i}<ul><li><a href="#">Link ${i}</a></li></ul></li>`).join('')}
    </ul></div></div></body></html>`));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await loadChromium().launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    for(const left of [-300,300]) {
      const css=`.mobile-top-bar>ul>li:nth-child(2)>ul{left:${left}px}`;
      const result=await runKnownSurfaceContract(page,{css,styleId:'navigation-bound-canary',contractValue:'auto'});
      const failures=result.issues.filter(issue=>issue.kind==='surface_navigation_viewport_escape');
      assert.ok(failures.length>0);
      assert.ok(failures.some(issue=>left<0?issue.bounds.off_left_px>0:issue.bounds.off_right_px>0));
      if(left<0) {
        const themed=result.captures.find(row=>row.mode==='theme'&&row.surface==='nav.mobile-top');
        assert.equal(themed.document_width,themed.viewport_width);
        assert.ok(themed.navigation_bounds.length>3);
      }
    }
  } finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
});
