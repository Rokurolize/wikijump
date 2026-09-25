#!/usr/bin/env node
import {createRequire} from 'node:module';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir=path.dirname(fileURLToPath(import.meta.url));
const require=createRequire(path.resolve(dir,'../../../../../framerail/package.json'));
const {chromium}=require('@playwright/test');
const origin='https://scpaiueouiuiuiui.wikijump.localhost:18443';
const fixture=`${origin}/run-owned%3Atheme-lab-visual-acceptance-imported-20260924`;
const filename='theme-lab-visual-fixture_日本語長名_320px_readability_and_download_controls.txt';
if(!process.env.WIKIDOT_VERIFY_ADMIN_EMAIL||!process.env.WIKIDOT_VERIFY_ADMIN_PASS)throw new Error('Use the established local verification admin environment');
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},ignoreHTTPSErrors:true});
 await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort('blockedbyclient'));
 const page=await context.newPage();page.setDefaultTimeout(12000);
 await page.goto(`${origin}/-/login`,{waitUntil:'domcontentloaded'});
 await page.locator('.auth-name-or-email').fill(process.env.WIKIDOT_VERIFY_ADMIN_EMAIL);
 await page.locator('.auth-password').fill(process.env.WIKIDOT_VERIFY_ADMIN_PASS);
 await page.locator('#login button[type=submit]').click();
 await page.waitForFunction(()=>!document.querySelector('#login'));
 await page.goto(fixture,{waitUntil:'domcontentloaded'});await page.waitForTimeout(1100);
 await page.locator('#files-button').click();await page.locator('.file-list').waitFor();
 const row=page.locator('.file-row').filter({hasText:filename});
 if(process.argv.includes('--remove')){
 if(await row.count()){
   await row.locator('a').last().click();
   await row.waitFor({state:'detached'});
  }
  console.log(JSON.stringify({fixture_file:filename,operation:'removed',remaining:await row.count()}));
 }else if(!(await row.count())){
  const uploadAction=page.locator('.file-action button.upload-file, .file-action input[type=button], .file-panel .buttons input[type=button]').first();
  await uploadAction.waitFor({state:'visible'});await uploadAction.click();await page.locator('#file-upload input[type=file]').waitFor();
  await page.locator('#file-upload input[type=file]').setInputFiles({name:filename,mimeType:'text/plain',buffer:Buffer.from('日本語の長いファイル名と添付欄のcontrast、折返し、control幅を確認するrun-owned file fixtureです。\n')});
  await page.locator('#file-upload input[name=name]').fill(filename);
  await page.locator('#file-upload textarea[name=comments]').fill('Theme Lab visual acceptance run-owned attachment');
  await page.locator('#file-upload button.button-upload, #file-upload input[type=submit]').first().click();
  await row.waitFor({state:'visible'});
  console.log(JSON.stringify({fixture_file:filename,operation:'uploaded',row_visible:true}));
 }else console.log(JSON.stringify({fixture_file:filename,operation:'already-present',row_visible:true}));
 await context.close();
}finally{await browser.close()}
