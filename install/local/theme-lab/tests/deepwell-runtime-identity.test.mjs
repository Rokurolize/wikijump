import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertDeepwellRuntimeIdentity,
  createDeepwellRuntimeIdentity,
  deepwellRuntimeIdentityFromHeaders,
  deepwellRuntimeIdentityMatchesContract,
  parseCurlDeepwellRuntimeHeaders,
  requireDeepwellRuntimeIdentity
} from '../src/deepwell-runtime-identity.mjs';

const identity=createDeepwellRuntimeIdentity({source_sha256:'a'.repeat(64),ftml_git_revision:'b'.repeat(40),container_id:'c'.repeat(64),image_id:`sha256:${'d'.repeat(64)}`,binary_sha256:'e'.repeat(64),config_sha256:'f'.repeat(64)});
const headers={
  'X-Theme-Lab-Backend-Source-Sha':identity.source_sha256,
  'X-Theme-Lab-Backend-FTML-Git-Revision':identity.ftml_git_revision,
  'X-Theme-Lab-Backend-Container-Id':identity.container_id,
  'X-Theme-Lab-Backend-Image-Id':identity.image_id,
  'X-Theme-Lab-Backend-Binary-Sha':identity.binary_sha256,
  'X-Theme-Lab-Backend-Config-Sha':identity.config_sha256,
  'X-Theme-Lab-Backend-Identity-Sha':identity.identity_sha256
};

test('Deepwell response identity binds source, FTML, running image, executable and config',()=>{
  assert.equal(requireDeepwellRuntimeIdentity(identity).identity_sha256,identity.identity_sha256);
  assert.equal(deepwellRuntimeIdentityFromHeaders(headers).identity_sha256,identity.identity_sha256);
  assert.equal(deepwellRuntimeIdentityFromHeaders(new Headers(headers)).identity_sha256,identity.identity_sha256);
  const parsed=parseCurlDeepwellRuntimeHeaders(`HTTP/2 103\r\n\r\nHTTP/2 200\r\n${Object.entries(headers).map(([key,value])=>`${key}: ${value}`).join('\r\n')}\r\n\r\n`);
  assert.equal(parsed.backendRuntimeIdentity.identity_sha256,identity.identity_sha256);
  assert.equal(assertDeepwellRuntimeIdentity(identity,parsed.backendRuntimeIdentity).identity_sha256,identity.identity_sha256);
  assert.equal(deepwellRuntimeIdentityMatchesContract({backend_runtime_identity:identity},{expected_backend_runtime_identity:identity}),true);
  assert.equal(deepwellRuntimeIdentityMatchesContract({backend_runtime_identity:{...identity,image_id:`sha256:${'9'.repeat(64)}`}},{expected_backend_runtime_identity:identity}),false);
  assert.equal(deepwellRuntimeIdentityFromHeaders({'X-Theme-Lab-Backend-Source-Sha':identity.source_sha256}),null);
  assert.throws(()=>assertDeepwellRuntimeIdentity(identity,null,'fixture'),/fixture/u);
  assert.throws(()=>parseCurlDeepwellRuntimeHeaders('HTTP/2 503\r\n\r\n'),/HTTP 503/u);
});
