#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateIdentity} from '../ports/scripts/candidate-identity.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const ports=path.resolve(root,'../ports');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const fail=[];
const read=async file=>JSON.parse(await fs.readFile(path.join(root,file),'utf8'));
const [audit,comparison,manifest,contract,findings,campaign]=await Promise.all([
 read('evidence/interactive-visual-audit.json'),read('evidence/sigma9-comparison-audit.json'),read('fixture-manifest.json'),read('run-contract.json'),read('findings.json'),
 JSON.parse(await fs.readFile(path.join(ports,'en-theme-campaign.json'),'utf8'))
]);
const candidates=['dear-dictator',...campaign.themes.map(x=>x.slug.replace(/^theme:/u,'')),'sigma10-baseline'];
if(candidates.length!==36||new Set(candidates).size!==36)fail.push('candidate inventory is not exactly 36 unique candidates');
const normal=audit.records.filter(r=>r.surface==='page.normal'&&r.state==='settled');
const cells=new Map(normal.map(r=>[`${r.theme}|${r.browser_engine}|${r.viewport}`,r]));
const matrix=[['chromium','desktop'],['chromium','laptop'],['chromium','tablet'],['chromium','mobile'],['chromium','narrow-mobile'],['firefox','desktop'],['firefox','mobile'],['webkit','desktop'],['webkit','mobile']];
for(const candidate of candidates)for(const [engine,viewport] of matrix)if(!cells.has(`${candidate}|${engine}|${viewport}`))fail.push(`missing page.normal cell ${candidate}/${engine}/${viewport}`);
const comparisonRows=comparison.records.filter(r=>r.surface==='page.normal'&&r.state==='settled');
const comparisonCells=new Map(comparisonRows.map(r=>[`${r.theme}|${r.browser_engine}|${r.viewport}`,r]));
for(const candidate of candidates)for(const [engine,viewport] of matrix)if(!comparisonCells.has(`${candidate}|${engine}|${viewport}`))fail.push(`missing Sigma-9 comparison cell ${candidate}/${engine}/${viewport}`);
const manifestSha=sha(await fs.readFile(path.join(root,'fixture-manifest.json')));
const contractSha=sha(await fs.readFile(path.join(root,'run-contract.json')));
const fixturePackage=path.resolve(ports,'interactive-visual-fixture');
const themeFixtureHash=async row=>{
 const variant=row.fixture?.endsWith('credit-no-rate-20260924')?'fixture-no-rate.wikidot.txt':row.fixture?.endsWith('credit-heritage-20260924')?'fixture-heritage.wikidot.txt':null;
 const names=[variant??(row.surface==='page.history'?'history-fixture.wikidot.txt':'fixture.wikidot.txt'),'nav-top.wikidot.txt','nav-side.wikidot.txt','nav-interwiki.wikidot.txt'];
 if(row.surface==='page.backlinks')names.push('backlink-fixture.wikidot.txt');
 const h=crypto.createHash('sha256').update('theme-lab-fixture-state.v2\0');
 for(const name of [...new Set(names)].sort()){h.update(name);h.update('\0');h.update(sha(await fs.readFile(path.join(fixturePackage,name))))}
 h.update(manifestSha);
 for(const slug of [contract.migration_fixture.main_slug,contract.migration_fixture.top_slug,contract.migration_fixture.side_slug]){
  const fixture=manifest.fixtures.find(x=>x.slug===slug);
  if(!fixture)throw new Error(`migration fixture missing from manifest: ${slug}`);
  const bytes=await fs.readFile(path.join(root,fixture.file));
  if(sha(bytes)!==fixture.sha256)fail.push(`fixture hash mismatch: ${slug}`);
  h.update(slug);h.update('\0');h.update(sha(bytes));
 }
 return h.digest('hex');
};
const seenShots=new Set();
for(const [label,records] of [['Sigma-10',audit.records],['Sigma-9 control',comparison.records]]) for(const r of records){
 if(!r.migration_review||r.migration_review.screenshot_sha256!==r.screenshot_sha256)fail.push(`missing/stale direct visual review in ${label} ${r.theme}/${r.browser_engine}/${r.viewport}/${r.surface}.${r.state}`);
 if(!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE','NEEDS_FIX','EXTERNAL_CONTRACT_UNVERIFIABLE','NOT_APPLICABLE'].includes(r.migration_review?.classification))fail.push(`invalid reviewed classification in ${label} ${r.theme}/${r.surface}.${r.state}`);
 if(r.unconfirmed_items?.length)fail.push(`unexplained unconfirmed item in ${label} ${r.theme}/${r.surface}.${r.state}: ${r.unconfirmed_items.join('; ')}`);
 if(r.external_requests_sent!==0)fail.push(`external request sent in ${label} ${r.theme}/${r.surface}.${r.state}`);
 if(r.asset_failures?.length||r.page_errors?.length)fail.push(`runtime failure in ${label} ${r.theme}/${r.surface}.${r.state}`);
 if(!r.screenshot||!r.screenshot_sha256)fail.push(`screenshot missing in ${label} ${r.theme}/${r.surface}.${r.state}`);
 else if(!seenShots.has(`${r.screenshot}|${r.screenshot_sha256}`)){
  seenShots.add(`${r.screenshot}|${r.screenshot_sha256}`);
  try{if(sha(await fs.readFile(path.join(ports,r.screenshot)))!==r.screenshot_sha256)fail.push(`screenshot hash mismatch: ${r.screenshot}`)}catch{fail.push(`screenshot not found: ${r.screenshot}`)}
 }
}
for(const r of audit.records){
 if(r.target_site!==contract.target_site.slug)fail.push(`wrong target site in ${r.theme}/${r.surface}.${r.state}`);
 if(r.run_contract_sha256!==contractSha)fail.push(`stale run contract in ${r.theme}/${r.surface}.${r.state}`);
 if(r.fixture_contract_sha256!==await themeFixtureHash(r))fail.push(`stale fixture contract in ${r.theme}/${r.surface}.${r.state}`);
 if(r.asset_failures?.length)fail.push(`asset failure in ${r.theme}/${r.surface}.${r.state}`);
 if(r.page_errors?.length)fail.push(`page error in ${r.theme}/${r.surface}.${r.state}`);
 if(r.unconfirmed_items?.some(x=>x.startsWith('action/capture failed')))fail.push(`action failed in ${r.theme}/${r.surface}.${r.state}`);
 if(!r.screenshot||!r.screenshot_sha256)fail.push(`screenshot missing in ${r.theme}/${r.surface}.${r.state}`);
 else if(!seenShots.has(`${r.screenshot}|${r.screenshot_sha256}`)){
  seenShots.add(`${r.screenshot}|${r.screenshot_sha256}`);
  try{if(sha(await fs.readFile(path.join(ports,r.screenshot)))!==r.screenshot_sha256)fail.push(`screenshot hash mismatch: ${r.screenshot}`)}catch{fail.push(`screenshot not found: ${r.screenshot}`)}
 }
 if(r.classification==='UNCONFIRMED')fail.push(`unclassified evidence ${r.theme}/${r.browser_engine}/${r.viewport}/${r.surface}.${r.state}`);
 if(!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE','NEEDS_FIX','EXTERNAL_CONTRACT_UNVERIFIABLE','NOT_APPLICABLE'].includes(r.classification))fail.push(`invalid classification ${r.theme}/${r.surface}.${r.state}: ${r.classification}`);
 const themeDir=r.theme==='sigma10-baseline'?path.join(root,'baseline-probe'):path.join(ports,r.theme);
 try{
  const css=await fs.readFile(path.join(themeDir,'candidate.css'));
  const base=await fs.readFile(path.join(themeDir,'candidate-base.css')).catch(()=>Buffer.alloc(0));
  const source=await fs.readFile(path.join(themeDir,'candidate.wikidot.source.txt')).catch(()=>fs.readFile(path.join(themeDir,'candidate.wikidot.txt')));
  const current=candidateIdentity(css,base,new Set([r.candidate_sha256]));
  if(current.candidateSha!==r.candidate_sha256||sha(source)!==r.candidate_source_sha256)fail.push(`stale candidate ${r.theme}/${r.surface}.${r.state}`);
 }catch{fail.push(`candidate files missing for ${r.theme}`)}
}
for(const f of findings.findings??[])if(f.blocker===true&&!String(f.owner??'').trim())fail.push(`ownerless blocker ${f.id}`);
for(const f of findings.findings??[])if(f.actionable===true&&!String(f.classification??'').trim())fail.push(`unclassified actionable finding ${f.id}`);
if((findings.findings??[]).some(f=>f.id==='SIGMA10-SEARCH-002'))fail.push('obsolete SIGMA10-SEARCH-002 finding remains; hidden search is expected Wikidot unavailable-search parity');
const searchParityRows=audit.records.filter(r=>r.surface==='shell.search'&&r.state==='typed-focused');
if(searchParityRows.length!==3)fail.push(`expected 3 desktop/laptop/tablet search parity rows, got ${searchParityRows.length}`);
for(const r of searchParityRows){
 if(r.classification!=='PASS_INTENTIONAL_DIVERGENCE')fail.push(`search parity row is not intentional divergence: ${r.browser_engine}/${r.viewport}`);
 if(r.migration_review?.owner!=null)fail.push(`search parity row incorrectly has an owner: ${r.browser_engine}/${r.viewport}`);
 if(r.migration_review?.confirmed_finding_ids?.length)fail.push(`search parity row incorrectly references a migration finding: ${r.browser_engine}/${r.viewport}`);
 if(r.action_contract_observation?.control!=='#search-top-box-input'||r.action_contract_observation?.display!=='none')fail.push(`search parity observation changed: ${r.browser_engine}/${r.viewport}`);
 if(!r.migration_review?.intentional_difference?.includes('Wikijump deliberately reproduces that unavailable search contract'))fail.push(`search parity rationale is missing the Wikidot-unavailable contract: ${r.browser_engine}/${r.viewport}`);
}
const expectedCoverage=findings.coverage?.current_records;
if(expectedCoverage!=null&&expectedCoverage!==audit.records.length)fail.push(`findings current record count ${expectedCoverage} != audit ${audit.records.length}`);
if(findings.coverage?.comparison_records!=null&&findings.coverage.comparison_records!==comparison.records.length)fail.push(`findings comparison count ${findings.coverage.comparison_records} != audit ${comparison.records.length}`);
if(findings.fixture_manifest_sha256&&findings.fixture_manifest_sha256!==manifestSha)fail.push('findings fixture manifest hash is stale');
const {execFileSync}=await import('node:child_process');
const gitRoot=path.resolve(root,'../../../../');
const touched=execFileSync('git',['diff','--name-only','HEAD','--','install/local/theme-lab/ports/interactive-visual-audit.json'],{cwd:gitRoot,encoding:'utf8'});
if(touched.trim())fail.push('accepted Sigma-9 audit was modified / normal campaign evidence was contaminated');
if(fail.length){console.error(JSON.stringify({result:'FINAL-ZERO FAIL',failures:fail.length,details:fail.slice(0,100)},null,2));process.exitCode=1}
else console.log(JSON.stringify({result:'FINAL-ZERO PASS',candidates:candidates.length,page_normal_cells:candidates.length*matrix.length,current_records:audit.records.length,superseded_records:audit.superseded_records?.length??0,unique_screenshots:seenShots.size,fixture_manifest_sha256:manifestSha,run_contract_sha256:contractSha},null,2));
