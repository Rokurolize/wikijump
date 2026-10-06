import test from 'node:test';
import assert from 'node:assert/strict';
import {loadChromium} from '../src/browser-lab.mjs';
import {measureGeneratedTextLines} from '../src/generated-text-lines.mjs';
import {verifyGeneratedLineAuthority} from '../src/adaptation-authority.mjs';

test('generated line authority rejects forged intersections, hidden geometry and a missing producer',()=>{
  const line={left:0,right:20,top:0,bottom:30,width:20,height:30};
  const receipt={archived_sources:[{path:'measurement-generated-text-lines.mjs'}],rows:[{state:'header-line-layout',pass:true,measurement:{generated_text_lines:[{selector:'h1::before',text:'Title',lines:[line],overlaps:[]}]}}]};
  assert.doesNotThrow(()=>verifyGeneratedLineAuthority(receipt));
  const forged=structuredClone(receipt);
  forged.rows[0].measurement.generated_text_lines[0].lines.push(line);
  assert.throws(()=>verifyGeneratedLineAuthority(forged),/intersections/);
  forged.rows[0].measurement.generated_text_lines[0].overlaps=[{i:0,j:1,width:20,height:30}];
  assert.throws(()=>verifyGeneratedLineAuthority(forged),/cannot pass/);
  const hidden=structuredClone(receipt);hidden.rows[0].measurement.generated_text_lines[0].lines[0].height=0;
  assert.throws(()=>verifyGeneratedLineAuthority(hidden),/geometry/);
  assert.throws(()=>verifyGeneratedLineAuthority({...receipt,archived_sources:[]}),/unbound/);
});

test('generated title lines expose zero-height line overlap and restore the source DOM', async()=>{
  const browser=await loadChromium().launch({headless:true});
  try {
    const page=await browser.newPage();
    await page.setContent('<style>h1{width:180px;font:32px Arial;line-height:0}h1::before{content:"ONE TWO THREE"}</style><h1 data-theme-lab-line-probe="original"></h1><div data-theme-lab-line-probe="theme-lab-line-0"></div>');
    const original=await page.content();
    const before=await measureGeneratedTextLines(page,['h1::before']);
    assert.ok(before[0].lines.length>1);
    assert.ok(before[0].overlaps.length>0);
    assert.equal(await page.content(),original);
    await page.addStyleTag({content:'h1::before{line-height:40px}'});
    const corrected=await page.content();
    const after=await measureGeneratedTextLines(page,['h1::before']);
    assert.ok(after[0].lines.length>1);
    assert.equal(after[0].overlaps.length,0);
    assert.equal(await page.content(),corrected);
    await assert.rejects(measureGeneratedTextLines(page,['h1']),/pseudo selector/);
  } finally {await browser.close()}
});
