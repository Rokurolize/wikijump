import test from 'node:test';
import assert from 'node:assert/strict';
import {loadChromium} from '../src/browser-lab.mjs';
import {measureVisibleTextBounds} from '../src/visible-text-bounds.mjs';
test('header ink excludes transparent padding, projects generated labels, and restores the DOM',async()=>{
 const browser=await loadChromium().launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent(`<style>body{margin:0}h1{margin:0;padding-top:80px;font:20px Arial}h1::before{content:"Theme"}h1 span{font-size:0}input{position:absolute;top:10px}</style><h1 data-theme-lab-ink="original"><span>Hidden native title</span></h1><input>`);
  const before=await page.content();const box=await page.locator('h1').boundingBox();
  const measured=await measureVisibleTextBounds(page,['h1']);
  assert.equal(box.y,0);assert.ok(box.height>80);
  assert.ok(measured.h1.length>0);assert.ok(measured.h1.every(rect=>rect.top>=80));
  assert.equal(await page.content(),before);
  assert.deepEqual(await measureVisibleTextBounds(page,['h1']),measured);
 }finally{await browser.close()}
});
