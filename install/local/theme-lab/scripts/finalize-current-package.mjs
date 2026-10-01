import {validateSemanticSourceAuthority} from '../src/semantic-source-authority.mjs';
import {runtimeSurfaceContractSha} from '../src/browser-runtime-contract.mjs';
#!/usr/bin/env node
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
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2),value=key=>args[args.indexOf(key)+1];
for(const key of ['--package','--result','--review','--audit','--output'])if(!args.includes(key))throw new Error(`Missing ${key}`);
const name=value('--package'),ledger=JSON.parse(await fs.readFile(path.join(root,'ports/adaptation-authority.json')));
if(!Object.hasOwn(ledger.packages,name))throw new Error('Unknown maintained package');
const read=file=>fs.readFile(path.resolve(file));
const raw=JSON.parse(await read(value('--result'))),review=JSON.parse(await read(value('--review'))),audit=JSON.parse(await read(value('--audit')));
const dir=path.join(root,'ports',name),pkg=ledger.packages[name];
const [css,source,preview,base]=await Promise.all([fs.readFile(path.join(dir,'candidate.css')),fs.readFile(path.join(dir,pkg.source_file)),fs.readFile(path.join(dir,'candidate.wikidot.txt')),fs.readFile(path.join(dir,'candidate-base.css')).catch(()=>Buffer.alloc(0))]);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const candidate=candidateIdentity(css,base).candidateSha;
const subset={...audit,records:audit.records.filter(row=>row.theme===name)};
const failures=validateBrowserCoverage(subset,[name]);
const semantic=subset.acceptance_model===SEMANTIC_BROWSER_MODEL;
if(semantic){
 failures.push(...validateSemanticBrowserAcceptance(subset).failures, ...validateSemanticSourceAuthority(root,subset));
 for(const {binding,label} of semanticReviewArtifactBindings(subset)){
  const file=path.resolve(root,binding?.path??'');
  if(!file.startsWith(root+path.sep)||sha(await fs.readFile(file))!==binding?.sha256)failures.push(`Unbound source visual artifact: ${label}`);
 }
}
for(const row of subset.records){
 if(semantic&&row.runtime_surface_contract_sha256!==runtimeSurfaceContractSha(path.resolve(root,'../../..'),row.surface,row.viewport))failures.push(`Stale interactive runtime: ${row.surface}.${row.state}`);
 if(row.candidate_sha256!==candidate||row.candidate_source_sha256!==sha(source))failures.push(`Stale interactive candidate: ${row.surface}.${row.state}`);
 if(!semantic && (!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE'].includes(row.classification)||!row.reviewed_after_last_change||row.unconfirmed_items?.length||row.asset_failures?.length||row.page_errors?.length||row.external_requests_sent!==0||row.failure))failures.push(`Unaccepted interaction: ${row.surface}.${row.state}`);
 if(!semantic && row.visual_review?.screenshot_sha256!==row.screenshot_sha256)failures.push('Unbound interactive image review');
 const file=path.resolve(root,'ports',row.screenshot??'');
 if(!file.startsWith(path.join(root,'ports')+path.sep)||sha(await fs.readFile(file))!==row.screenshot_sha256)failures.push('Stale interactive screenshot');
}
if(failures.length)throw new Error(failures.join('\n'));
const result=await finalizeVisualAcceptance({result:raw.result??raw,review,css:css.toString(),source:source.toString(),preview:preview.toString(),baseCss:base.toString()});
const dimensions=validateCombinedAcceptance(result,name);if(dimensions.length)throw new Error(dimensions.join('\n'));
const out=path.resolve(value('--output'));
if(!out.startsWith(path.join(root,'ports/current-acceptance')+path.sep))throw new Error('Current acceptance outputs must be isolated from historical evidence');
await fs.mkdir(out,{recursive:true});
const write=async(file,value)=>{const bytes=JSON.stringify(value,null,2)+'\n';await fs.writeFile(path.join(out,file),bytes);return{path:path.relative(root,path.join(out,file)),sha256:sha(bytes)}};
const browserBinding=await write('browser-audit.json',subset);
result.browser_acceptance={...browserBinding,records:subset.records.length};
result.current_acceptance_recorded_at=reviewCompletionTime(review);
const resultBinding=await write('accepted-result.json',result);
await write('visual-review.json',review);
const receiptFile=path.join(dir,'receipt.json'),receipt=JSON.parse(await fs.readFile(receiptFile));
Object.assign(receipt,{current_acceptance:{path:path.relative(dir,path.join(root,resultBinding.path)),sha256:resultBinding.sha256},overall_acceptance:result.overall_acceptance,final_verdict:result.verdict,final_status:'current-full-acceptance',state:'accepted-local-candidate-not-published',candidate_css_sha256:sha(css),candidate_source_sha256:sha(source),candidate_preview_sha256:sha(preview)});
await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n');
if(name==='quand-le-soleil-se-couche')await fs.writeFile(path.join(dir,'acceptance-verdict.json'),JSON.stringify({ok:true,result},null,2)+'\n');
console.log(JSON.stringify({package:name,overall:result.verdict,browser_records:subset.records.length,receipt:resultBinding,browser_audit:browserBinding}));
