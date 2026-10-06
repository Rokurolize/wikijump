import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';

export function playwrightBrowserVersions(browserRoot) {
  const fromRoot=createRequire(path.join(browserRoot,'package.json'));
  let entry=null;
  for(const name of ['@playwright/test','playwright']){
    try{entry=fromRoot.resolve(name);break}catch{}
  }
  if(!entry)throw new Error(`could not resolve Playwright from ${browserRoot}`);
  const fromEntry=createRequire(entry);
  const corePackage=fromEntry.resolve('playwright-core/package.json');
  const registry=JSON.parse(fs.readFileSync(path.join(path.dirname(corePackage),'browsers.json'),'utf8'));
  const wanted=new Set(['chromium','firefox','webkit']);
  return Object.fromEntries(registry.browsers.filter(row=>wanted.has(row.name)).map(row=>[row.name,row.browserVersion]));
}
