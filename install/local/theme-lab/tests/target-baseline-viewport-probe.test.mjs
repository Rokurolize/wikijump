import test from 'node:test';
import assert from 'node:assert/strict';

import {measureTargetBaselineViewportOverflow} from '../src/target-baseline-viewport-probe.mjs';

test('target baseline viewport probe restores the exact candidate style before candidate measurement',async()=>{
  const calls=[];
  const page={
    setViewportSize:async size=>calls.push(['viewport',size]),
    evaluate:async(_fn,arg)=>{
      if(arg&&typeof arg==='object'&&Object.hasOwn(arg,'id')&&Object.hasOwn(arg,'text'))calls.push(['style',arg.text]);
      return {document_overflow_px:0,viewport_escape_px:0,overflow_sources:[]};
    },
  };
  const result=await measureTargetBaselineViewportOverflow({page,styleId:'candidate',effectiveCss:'body{color:red}',viewports:[]});
  assert.deepEqual(result,{baseline:{},candidate:{}});
  assert.deepEqual(calls,[['style',''],['style','body{color:red}']]);
});

test('target baseline viewport probe restores candidate CSS when baseline collection throws',async()=>{
  const calls=[];
  const page={
    setViewportSize:async()=>{},
    evaluate:async(_fn,arg)=>{
      if(arg&&typeof arg==='object'&&Object.hasOwn(arg,'id')&&Object.hasOwn(arg,'text')){calls.push(arg.text);return}
      throw new Error('measurement failed');
    },
  };
  await assert.rejects(measureTargetBaselineViewportOverflow({page,styleId:'candidate',effectiveCss:'body{color:red}',viewports:[{id:'mobile',width:390,height:844}]}),/measurement failed/u);
  assert.deepEqual(calls,['','body{color:red}']);
});
