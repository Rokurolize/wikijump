#!/usr/bin/env node
import {readCurrentBrowserContracts,observationHasCurrentActionAndFixture} from '../src/current-browser-contracts.mjs';
import {semanticSourceReferenceHtmlSha,validateSemanticSourceAuthority} from '../src/semantic-source-authority.mjs';
import {runtimeSurfaceContractSha} from '../src/browser-runtime-contract.mjs';
// Complete only the exact image review dimension of a full recorded check.
// Failed measurements, stale identities and missing interactive states remain
// blockers. Historical receipts are never inputs to this operation.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {finalizeVisualAcceptance,reviewCompletionTime} from '../src/finalize-visual-acceptance.mjs';
import {validateCombinedAcceptance,validateBrowserCoverage} from '../src/campaign-completion.mjs';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';
import {SEMANTIC_BROWSER_MODEL,validateSemanticBrowserAcceptance,semanticReviewArtifactBindings} from '../src/semantic-browser-acceptance.mjs';
import {candidateAssetDependencyState} from '../src/candidate-asset-dependencies.mjs';
import {resolveRunContractPath} from '../src/run-contract-path.mjs';
import {currentPackageFullCheckInputBindings} from '../src/full-check-input-bindings.mjs';
import {prepareCanonicalChildOutputDirectory,prepareContainedOutputFile,resolveExistingContainedFile,resolveExistingPackageDirectory,resolveExistingPackageFile} from '../src/package-path.mjs';
import {currentPackageBaseCss} from '../src/candidate-base-contract.mjs';
import {validateCanonicalScenarioMatrix} from '../src/theme-test-matrix-evidence.mjs';
import {playwrightBrowserVersions} from '../src/playwright-browser-versions.mjs';
import {currentTargetRuntimeSourceSha,targetRuntimeIdentityFailures} from '../src/target-runtime-identity.mjs';
import {requireRuntimeSourceSha} from '../src/runtime-source-identity.mjs';
import {visualGateNeedsScreenshot} from '../src/visual-gate.mjs';
import {deepwellRuntimeIdentityMatchesContract,requireDeepwellRuntimeIdentity} from '../src/deepwell-runtime-identity.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
for(const key of ['--package','--result','--review','--audit','--scenario-matrix','--output'])if(!args.includes(key))throw new Error(`Missing ${key}`);
const ledgerPath=resolveExistingContainedFile(root,'ports/adaptation-authority.json','Maintained package ledger');
const name=value('--package'),ledger=JSON.parse(await fs.readFile(ledgerPath));
if(!Object.hasOwn(ledger.packages,name))throw new Error('Unknown maintained package');
const read=file=>fs.readFile(path.resolve(file));
const raw=JSON.parse(await read(value('--result'))),review=JSON.parse(await read(value('--review'))),audit=JSON.parse(await read(value('--audit'))),scenarioMatrix=JSON.parse(await read(value('--scenario-matrix')));
const dir=resolveExistingPackageDirectory(path.join(root,'ports'),name,`${name}: package directory`),pkg=ledger.packages[name];
const sourcePath=resolveExistingPackageFile(dir,pkg.source_file??'candidate.wikidot.source.txt',`${name}: source file`);
const cssPath=resolveExistingPackageFile(dir,'candidate.css',`${name}: candidate CSS`),previewPath=resolveExistingPackageFile(dir,'candidate.wikidot.txt',`${name}: preview source`);
const base=currentPackageBaseCss(dir,name)??Buffer.alloc(0);
const [css,source,preview]=await Promise.all([fs.readFile(cssPath),fs.readFile(sourcePath),fs.readFile(previewPath)]);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const candidate=candidateIdentity(css,base).candidateSha;
let structurePath=null;try{structurePath=resolveExistingPackageFile(dir,'acceptance-structure.json',`${name}: acceptance structure`)}catch(error){if(error.code!=='ENOENT')throw error}
const structureBytes=structurePath?await fs.readFile(structurePath):null;
const candidateStructureSha=structureBytes?sha(structureBytes):null;
const runContractPath=resolveExistingContainedFile(root,'ports/current-acceptance/run-contract.json','Current browser run contract');
const runContract=JSON.parse(await fs.readFile(runContractPath,'utf8'));
const expectedRuntimeSourceSha=requireRuntimeSourceSha(runContract.expected_runtime_source_sha256,'current Sigma-9 run contract');
requireDeepwellRuntimeIdentity(runContract.expected_backend_runtime_identity,'current Sigma-9 run contract');
const [runtimeSupportCss,baselineCss]=await Promise.all([
 fs.readFile(resolveExistingContainedFile(root,'ports/interactive-visual-fixture/runtime-asset-replay.css','Runtime asset replay CSS'),'utf8'),
 fs.readFile(resolveRunContractPath(root,path.dirname(runContractPath),runContract.baseline_theme.replacement_css_path,'baseline replacement CSS'),'utf8'),
]);
const assetDependencySha=candidateAssetDependencyState({portsDir:path.join(root,'ports'),themeDir:dir,runtimeSupportCss,baselineCss,baseCss:base,candidateCss:css,candidateSource:source}).asset_dependency_sha256;
const fullCheckBindings=currentPackageFullCheckInputBindings(root,name);
const browserRoot=args.includes('--browser-root')?path.resolve(value('--browser-root')):path.resolve(root,'../../../framerail');
const canonicalScenario=validateCanonicalScenarioMatrix({root,packageName:name,generation:'sigma9',matrix:scenarioMatrix,browserVersions:playwrightBrowserVersions(browserRoot)});
const subset={...audit,canonical_scenario:scenarioMatrix,records:audit.records.filter(row=>row.theme===name)};
const failures=validateBrowserCoverage(subset,[name]);
const semantic=subset.acceptance_model===SEMANTIC_BROWSER_MODEL;
const rawResult=raw.result??raw;
failures.push(...targetRuntimeIdentityFailures(rawResult,currentTargetRuntimeSourceSha(root),runContract.expected_backend_runtime_identity));
const captureContracts=semantic?readCurrentBrowserContracts(root,'ports/current-acceptance/run-contract.json',{browserRoot}):null;
if(semantic){
 failures.push(...validateSemanticBrowserAcceptance(subset).failures, ...validateSemanticSourceAuthority(root,subset));
 try{
  const sourceHtmlSha=semanticSourceReferenceHtmlSha(root,subset,name);
  if(rawResult.reference_identity?.original_html_sha256!==sourceHtmlSha)failures.push('Full package reference differs from the current frozen source rendering');
 }catch(error){failures.push(error.message)}
 for(const {binding,label} of semanticReviewArtifactBindings(subset)){
  let file;try{file=resolveExistingContainedFile(root,binding?.path??'',`Source visual artifact ${label}`)}catch{failures.push(`Unbound source visual artifact: ${label}`);continue}
  if(sha(await fs.readFile(file))!==binding?.sha256)failures.push(`Unbound source visual artifact: ${label}`);
 }
}
for(const row of subset.records){
 if(row.runtime_source_sha256!==expectedRuntimeSourceSha)failures.push(`Stale or missing Framerail runtime source identity: ${row.surface}.${row.state}`);
 if(!deepwellRuntimeIdentityMatchesContract(row,runContract))failures.push(`Stale or missing Deepwell backend runtime identity: ${row.surface}.${row.state}`);
 if(semantic&&row.runtime_surface_contract_sha256!==runtimeSurfaceContractSha(path.resolve(root,'../../..'),row.surface,row.viewport))failures.push(`Stale interactive runtime: ${row.surface}.${row.state}`);
 if(semantic&&!observationHasCurrentActionAndFixture(row,captureContracts))failures.push(`Stale interactive action/fixture/browser: ${row.surface}.${row.state}`);
 if(row.candidate_sha256!==candidate||row.candidate_source_sha256!==sha(source))failures.push(`Stale interactive candidate: ${row.surface}.${row.state}`);
 if((row.candidate_structure_sha256??null)!==candidateStructureSha)failures.push(`Stale interactive candidate structure: ${row.surface}.${row.state}`);
 if(row.asset_dependency_sha256!==assetDependencySha)failures.push(`Stale interactive asset dependency: ${row.surface}.${row.state}`);
 if(!semantic && (!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE'].includes(row.classification)||!row.reviewed_after_last_change||row.unconfirmed_items?.length||row.asset_failures?.length||row.page_errors?.length||row.external_requests_sent!==0||row.failure))failures.push(`Unaccepted interaction: ${row.surface}.${row.state}`);
 if(!semantic && row.visual_review?.screenshot_sha256!==row.screenshot_sha256)failures.push('Unbound interactive image review');
 // V/C/M: a screenshot is required exactly when the visual gate requires one;
 // a successful machine-only row must not retain one (validated by the gate).
 if(!visualGateNeedsScreenshot(row,{failure:!!row.failure})&&!row.screenshot&&!row.screenshot_sha256)continue;
 let file;try{file=resolveExistingContainedFile(path.join(root,'ports'),row.screenshot??'','Interactive screenshot')}catch{failures.push('Stale interactive screenshot');continue}
 if(sha(await fs.readFile(file))!==row.screenshot_sha256)failures.push('Stale interactive screenshot');
}
if(failures.length)throw new Error(failures.join('\n'));
const result=await finalizeVisualAcceptance({result:rawResult,review,css:css.toString(),source:source.toString(),preview:preview.toString(),baseCss:base.toString(),fullCheckInputBindings:fullCheckBindings});
const dimensions=validateCombinedAcceptance(result,name);if(dimensions.length)throw new Error(dimensions.join('\n'));
for(const viewport of Object.values(result.visual?.viewports??{}))for(const side of ['candidate','reference']) {
 const file=path.resolve(root,viewport[`${side}_path`]);
 if(!file.startsWith(root+path.sep))throw new Error('Paired visual artifact escapes Theme Lab');
 viewport[`${side}_path`]=path.relative(root,file);
}
const out=prepareCanonicalChildOutputDirectory(path.join(root,'ports/current-acceptance'),name,value('--output'),'Current acceptance output');
const write=async(file,value)=>{const target=prepareContainedOutputFile(out,file,'Current acceptance artifact');const bytes=JSON.stringify(value,null,2)+'\n';await fs.writeFile(target,bytes);return{path:path.relative(root,target),sha256:sha(bytes)}};
const browserBinding=await write('browser-audit.json',subset);
result.browser_acceptance={...browserBinding,records:subset.records.length};
result.canonical_scenario_evidence={generation:'sigma9',...canonicalScenario};
result.current_acceptance_recorded_at=reviewCompletionTime(review);
const resultBinding=await write('accepted-result.json',result);
await write('visual-review.json',review);
const receiptFile=prepareContainedOutputFile(dir,'receipt.json',`${name}: package receipt`),receipt=JSON.parse(await fs.readFile(receiptFile));
Object.assign(receipt,{current_acceptance:{path:path.relative(dir,path.join(root,resultBinding.path)),sha256:resultBinding.sha256},overall_acceptance:result.overall_acceptance,final_verdict:result.verdict,final_status:'current-full-acceptance',state:'accepted-local-candidate-not-published',candidate_css_sha256:sha(css),candidate_source_sha256:sha(source),candidate_preview_sha256:sha(preview)});
await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n');
if(name==='quand-le-soleil-se-couche')await fs.writeFile(prepareContainedOutputFile(dir,'acceptance-verdict.json',`${name}: acceptance verdict`),JSON.stringify({ok:true,result},null,2)+'\n');
console.log(JSON.stringify({package:name,overall:result.verdict,browser_records:subset.records.length,receipt:resultBinding,browser_audit:browserBinding}));
