import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyNativeCreditFoldAuthority} from '../src/adaptation-authority.mjs';
test('native credit authority requires settled actual fold controls and bound producer',()=>{
 const capture=state=>({state,measurement:{credit_fold:{initial_hash:'',hash:'',outer_unfolded:true,inner_unfolded:state==='credit-fold-otherwise',view_visibility:'visible',otherwise_visibility:state==='credit-fold-otherwise'?'visible':'hidden'},rows:[{rect:{width:240,height:300},style:{visibility:'visible',display:'block'}}]}});
 const receipt={archived_sources:[{path:'measurement-sigma10-credit-actions.mjs'}],rows:['credit-fold-view','credit-fold-otherwise','credit-fold-return'].map(capture)};
 assert.doesNotThrow(()=>verifyNativeCreditFoldAuthority(receipt));
 for(const [key,value] of [['hash','#u-credit-view'],['outer_unfolded',false],['inner_unfolded',true],['otherwise_visibility','visible']]){const bad=structuredClone(receipt);bad.rows[0].measurement.credit_fold[key]=value;assert.throws(()=>verifyNativeCreditFoldAuthority(bad),/settled control state/)}
 const hidden=structuredClone(receipt);hidden.rows[0].measurement.rows[0].style.visibility='hidden';assert.throws(()=>verifyNativeCreditFoldAuthority(hidden),/hidden geometry/);
 assert.throws(()=>verifyNativeCreditFoldAuthority({...receipt,archived_sources:[]}),/unbound/);
});

test('failed before-treatment credit action remains failure and cannot authorize an unsettled candidate',()=>{
 const row={state:'credit-fold-return',variant:'without',pass:false,interaction_error:'fader intercepts pointer',measurement:{credit_fold:{initial_hash:'',hash:'',outer_unfolded:true,inner_unfolded:true,view_visibility:'visible',otherwise_visibility:'visible'},rows:[]}};
 const receipt={archived_sources:[{path:'measurement-sigma10-credit-actions.mjs'}],rows:[row]};
 assert.doesNotThrow(()=>verifyNativeCreditFoldAuthority(receipt));
 for(const change of [{variant:'with'},{pass:true},{interaction_error:null}])assert.throws(()=>verifyNativeCreditFoldAuthority({...receipt,rows:[{...row,...change}]}),/settled control state/);
 const changed=structuredClone(receipt);changed.rows[0].measurement.credit_fold.hash='#u-credit-view';assert.throws(()=>verifyNativeCreditFoldAuthority(changed),/navigation identity/);
});
