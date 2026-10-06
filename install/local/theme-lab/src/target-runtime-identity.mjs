import path from 'node:path';
import {framerailSourceFingerprintSync} from './framerail-source-fingerprint.mjs';
import {assertDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';

const HASH=/^[a-f0-9]{64}$/u;

export function currentTargetRuntimeSourceSha(themeLabRoot){
  return framerailSourceFingerprintSync(path.resolve(themeLabRoot,'../../..'));
}

export function targetRuntimeIdentityFailures(result,expectedSourceSha,expectedBackendRuntimeIdentity){
  const identity=result?.target_runtime_identity,failures=[];
  if(identity?.schema!=='theme_lab_built_target_runtime.v1')return ['Full check lacks a built target runtime identity'];
  if(!HASH.test(expectedSourceSha??'')||identity.source_sha256!==expectedSourceSha)failures.push('Full check uses a superseded built target runtime source');
  if(identity.header_source_sha256!==identity.source_sha256)failures.push('Full check target response does not match its built runtime source identity');
  if(!HASH.test(identity.source_sha256??''))failures.push('Full check has an invalid built target runtime source identity');
  try{assertDeepwellRuntimeIdentity(expectedBackendRuntimeIdentity,identity.backend_runtime_identity,'Full check target response')}
  catch(error){failures.push(`Full check uses a missing or superseded Deepwell backend runtime: ${error.message}`)}
  if(!Number.isInteger(identity.response_status)||identity.response_status<200||identity.response_status>=400)failures.push('Full check runtime identity was not read from a successful response');
  try{
    const origin=new URL(identity.transport_origin),response=new URL(identity.response_url);
    if(origin.protocol!=='https:'||origin.username||origin.password||origin.origin!==identity.transport_origin||
      response.origin!==origin.origin||response.hostname!=='scpaiueouiuiuiui.wikijump.localhost')failures.push('Full check runtime identity is not bound to the SCP-JP target transport');
  }catch{failures.push('Full check runtime identity has an invalid transport origin');}
  return failures;
}
