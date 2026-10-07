import test from 'node:test';import assert from 'node:assert/strict';import {verifyNavigationRowAuthority} from '../src/adaptation-authority.mjs';
test('navigation authority requires positive visible label ranges contained in their own bar',()=>{
 const receipt={rows:[{state:'navigation-row-layout',pass:true,measurement:{navigation_row_layout:[{label:'シリーズ',bar:{top:142,bottom:182,left:0,right:320},ink:[{top:142,bottom:160,left:20,right:90}]}]}}]};assert.doesNotThrow(()=>verifyNavigationRowAuthority(receipt));
 const overlap=structuredClone(receipt);overlap.rows[0].measurement.navigation_row_layout[0].ink[0].top=122;assert.throws(()=>verifyNavigationRowAuthority(overlap),/outside its bar/);
 overlap.rows[0].pass=false;assert.doesNotThrow(()=>verifyNavigationRowAuthority(overlap));
 const hidden=structuredClone(receipt);hidden.rows[0].measurement.navigation_row_layout[0].ink=[];assert.throws(()=>verifyNavigationRowAuthority(hidden),/lacks geometry/);
 const forged=structuredClone(receipt);forged.rows[0].measurement.navigation_row_layout[0].ink[0].right=NaN;assert.throws(()=>verifyNavigationRowAuthority(forged),/invalid text geometry/);
});
