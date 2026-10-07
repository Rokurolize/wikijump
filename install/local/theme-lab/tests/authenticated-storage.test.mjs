import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {administratorBrowserObservationIsValid,loadThemeLabAuthenticatedStorage} from '../src/authenticated-storage.mjs';

const validStorage={cookies:[{name:'wikijump_token',value:`wj:${'A'.repeat(64)}`,domain:'.wikijump.localhost',path:'/'}],origins:[]};

test('authenticated storage is private and yields exactly one Wikijump session',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-lab-auth-'));
  try{
    const file=path.join(dir,'storage.json');
    await fs.writeFile(file,JSON.stringify(validStorage),{mode:0o600});
    const loaded=await loadThemeLabAuthenticatedStorage(file);
    assert.equal(loaded.sessionToken,validStorage.cookies[0].value);
    await fs.chmod(file,0o644);
    await assert.rejects(()=>loadThemeLabAuthenticatedStorage(file),/group- or world-readable/u);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('authenticated storage accepts the URI-encoded cookie delimiter preserved by Playwright',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'theme-lab-auth-'));
  try{
    const file=path.join(dir,'storage.json');
    const storage={cookies:[{...validStorage.cookies[0],value:`wj%3A${'B'.repeat(64)}`}],origins:[]};
    await fs.writeFile(file,JSON.stringify(storage),{mode:0o600});
    const loaded=await loadThemeLabAuthenticatedStorage(file);
    assert.equal(loaded.sessionToken,`wj:${'B'.repeat(64)}`);
    assert.equal(loaded.storage.cookies[0].value,storage.cookies[0].value);
  }finally{await fs.rm(dir,{recursive:true,force:true})}
});

test('administrator browser observation rejects guest or non-administrator sessions',()=>{
  const administrator={my_account_text:'Administrator',account_topbutton_present:true,logout_link_present:true,sign_in_link_present:false};
  assert.equal(administratorBrowserObservationIsValid(administrator),true);
  assert.equal(administratorBrowserObservationIsValid({...administrator,my_account_text:'Other User'}),false);
  assert.equal(administratorBrowserObservationIsValid({...administrator,sign_in_link_present:true}),false);
  assert.equal(administratorBrowserObservationIsValid({...administrator,logout_link_present:false}),false);
});
