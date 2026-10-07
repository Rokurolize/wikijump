import test from 'node:test';
import assert from 'node:assert/strict';
import {targetRuntimeIdentityFailures} from '../src/target-runtime-identity.mjs';
import {createDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';

const sha='a'.repeat(64);
const backendRuntimeIdentity=createDeepwellRuntimeIdentity({source_sha256:'b'.repeat(64),ftml_git_revision:'c'.repeat(40),container_id:'d'.repeat(64),image_id:`sha256:${'e'.repeat(64)}`,binary_sha256:'f'.repeat(64),config_sha256:'1'.repeat(64)});
const result={target_runtime_identity:{schema:'theme_lab_built_target_runtime.v1',source_sha256:sha,header_source_sha256:sha,
  transport_origin:'https://scpaiueouiuiuiui.wikijump.localhost:3398',response_url:'https://scpaiueouiuiuiui.wikijump.localhost:3398/boundary-check',response_status:200,backend_runtime_identity:backendRuntimeIdentity}};

test('current target runtime requires matching source and SCP-JP response identity',()=>{
  assert.deepEqual(targetRuntimeIdentityFailures(result,sha,backendRuntimeIdentity),[]);
  assert.ok(targetRuntimeIdentityFailures(result,'b'.repeat(64),backendRuntimeIdentity).some(message=>message.includes('superseded')));
  assert.ok(targetRuntimeIdentityFailures({...result,target_runtime_identity:{...result.target_runtime_identity,header_source_sha256:'b'.repeat(64)}},sha,backendRuntimeIdentity).some(message=>message.includes('response')));
  const changedBackend=createDeepwellRuntimeIdentity({...backendRuntimeIdentity,config_sha256:'2'.repeat(64)});
  assert.ok(targetRuntimeIdentityFailures(result,sha,changedBackend).some(message=>message.includes('Deepwell')));
});

test('target runtime identity rejects non-SCP-JP or non-HTTPS response origins',()=>{
  const identity={...result.target_runtime_identity,transport_origin:'http://example.com',response_url:'http://example.com'};
  assert.ok(targetRuntimeIdentityFailures({target_runtime_identity:identity},sha,backendRuntimeIdentity).some(message=>message.includes('SCP-JP')));
});
