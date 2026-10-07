import test from'node:test';import assert from'node:assert/strict';
import{nativeNavigationDoesNotWorsen}from'../src/native-navigation-attribution.mjs';
const observation=(documentWidth,left,right)=>({width:320,state:'navigation-action',index:2,interaction_error:null,measurement:{document_width:documentWidth,rows:[{selector:'a',text:'Same parent link'}]},bounds:[{off_left_px:left,off_right_px:right}]});
test('native navigation accepts inherited escape and rejects worsening either edge',()=>{
 const baseline=observation(345,0,25);
 assert.equal(nativeNavigationDoesNotWorsen(observation(345,0,25),baseline),true);
 assert.equal(nativeNavigationDoesNotWorsen(observation(320,0,0),baseline),true);
 assert.equal(nativeNavigationDoesNotWorsen(observation(348,0,25),baseline),false);
 assert.equal(nativeNavigationDoesNotWorsen(observation(320,3,0),baseline),false);
 assert.equal(nativeNavigationDoesNotWorsen(observation(345,0,28),baseline),false);
 assert.equal(nativeNavigationDoesNotWorsen({...observation(345,0,25),interaction_error:'not reachable'},baseline),false);
});
