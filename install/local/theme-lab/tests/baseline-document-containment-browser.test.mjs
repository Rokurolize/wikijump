import test from 'node:test';
import assert from 'node:assert/strict';
import {loadChromium} from '../src/browser-lab.mjs';
import {measureBaselineDocumentContainment} from '../src/baseline-document-containment.mjs';

test('baseline containment measurement restores the candidate stylesheet',async()=>{
  const browser=await loadChromium().launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:320,height:200}});
    await page.setContent('<style data-theme-lab-acceptance-styles>#wide{width:500px}</style><div id="wide">wide</div>');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)>320);
    const result=await measureBaselineDocumentContainment(page,{styleSelector:'style[data-theme-lab-acceptance-styles]',baselineCss:'#wide{width:100px}'});
    assert.equal(result.complete,true);
    assert.equal(result.viewport_width,320);
    assert.equal(result.document_width,320);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth)>320);
    assert.match(await page.locator('style[data-theme-lab-acceptance-styles]').textContent(),/500px/u);
  }finally{await browser.close()}
});
