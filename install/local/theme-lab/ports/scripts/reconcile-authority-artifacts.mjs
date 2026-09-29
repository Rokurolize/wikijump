#!/usr/bin/env node
// Reconcile identities without carrying an old screenshot review forward to
// newly generated CSS. The old receipt remains immutable diagnostic evidence.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../src/adaptation-authority.mjs';
const ports=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerPath=path.join(ports,'adaptation-authority.json');
const ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
const exists=async file=>fs.access(file).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error});
const acceptanceKeys=['final_verdict','final_status','theme_lab_findings','theme_lab_checks','final_theme_lab_check','font_diagnostics','viewport_status','torture_status','visual_status','interaction_status','warnings','intentional_style_differences','screenshots','interaction_diagnostics','visual_review','final_check','manual_visual_review','surface_contract','asset_status','offline_external_request_count','theme_lab_css_iteration_benchmark','image_diagnostics','page_image_assets','technical_requirements','interactive_visual_findings','initial_actionable_finding','inline_css_bytes','check_count','edit_iterations','manual_devtools_fallback_count','manual_visual_inspection_count','theme_lab_final_check_count','check_count_note','edit_iterations_note'];
for(const [name,pkg] of Object.entries(ledger.packages)) {
  const dir=path.join(ports,name);
  if(name==='dear-dictator') await fs.writeFile(path.join(dir,'candidate.css'),await fs.readFile(path.join(dir,'candidate-input.css'),'utf8'));
  pkg.outputs={};
  for(const file of ['candidate.css','candidate-source.css',pkg.source_file,'candidate.wikidot.txt',
    ...(name==='quand-le-soleil-se-couche'?['publishable-theme.wikidot.txt']:['maintenance/base.wikidot.txt','maintenance/jp-overrides.css','maintenance/final.wikidot.txt'])]) {
    if(await exists(path.join(dir,file)))pkg.outputs[file]=digest(await fs.readFile(path.join(dir,file)));
  }
  const assetsFile=path.join(dir,'assets.json');
  let dependencyCount=null;
  if(await exists(assetsFile) && name!=='dear-dictator' && name!=='quand-le-soleil-se-couche') {
    const assets=JSON.parse(await fs.readFile(assetsFile,'utf8'));
    assets.dependency_decisions=[
      ...(assets.assets??[]).map(asset=>({resource_type:'candidate-css-asset',source_url:asset.original_url,sha256:asset.sha256,decision:'freeze-runtime-independent-asset'})),
      ...(assets.import_provenance??[]).map(asset=>({resource_type:'candidate-css-import',source_url:asset.source_url,sha256:asset.sha256,asset_file:asset.asset_file,decision:'freeze-source-stylesheet'})),
      ...(assets.omitted_assets??[]).map(asset=>({resource_type:'candidate-css-asset',source_url:asset.url,decision:'omit',rationale:asset.reason})),
    ];
    await fs.writeFile(assetsFile,JSON.stringify(assets,null,2)+'\n');
    const pageAssets=path.join(dir,'page-assets.json');
    dependencyCount=assets.dependency_decisions.length+(await exists(pageAssets)?JSON.parse(await fs.readFile(pageAssets,'utf8')).dependency_decisions?.length??0:0);
  }
  const receiptFile=path.join(dir,'receipt.json');
  if(await exists(receiptFile) || name==='dear-dictator') {
    const archive=path.join(dir,'maintenance/historical-receipt.json');
    if(name!=='dear-dictator'&&!await exists(archive))await fs.copyFile(receiptFile,archive);
    const receipt=await exists(receiptFile)?JSON.parse(await fs.readFile(receiptFile,'utf8')):{slug:'theme:dear-dictator'};
    for(const key of acceptanceKeys)delete receipt[key];
    if(name!=='dear-dictator')receipt.historical_acceptance={status:'SUPERSEDED_CANDIDATE',path:'maintenance/historical-receipt.json',sha256:digest(await fs.readFile(archive)),scope:'Old local Wikijump/fixture review only; cannot authorize current published adaptations or current screenshot acceptance.'};
    receipt.adaptation_authority={ledger:'../adaptation-authority.json',status:'pass',publishable_without_authority:0};
    // Full local port acceptance is a separate diagnostic dimension. This
    // cleanup certifies adaptation provenance, not unexecuted local states.
    receipt.overall_acceptance={status:'inconclusive',reason:'Historical CSS changed; previous local screenshot acceptance is superseded. Only the explicitly recaptured real-Wikidot authority states apply to current CSS.'};
    receipt.final_verdict='inconclusive';
    receipt.final_status='adaptation-authority-cleaned';
    receipt.state='authority-cleaned-local-candidate-not-published';
    if(dependencyCount!==null)receipt.asset_dependency_decision_count=dependencyCount;
    receipt.candidate_source_sha256=pkg.outputs[pkg.source_file];
    if('source_candidate_sha256' in receipt)receipt.source_candidate_sha256=pkg.outputs[pkg.source_file];
    if('candidate_preview_sha256' in receipt)receipt.candidate_preview_sha256=pkg.outputs['candidate.wikidot.txt'];
    receipt.candidate_css_sha256=pkg.outputs['candidate.css'];
    if('candidate_source_hash' in receipt)receipt.candidate_source_hash=pkg.outputs[pkg.source_file];
    if(name==='quand-le-soleil-se-couche') {
      const verdictFile=path.join(dir,'acceptance-verdict.json');
      const historicalVerdict=path.join(dir,'maintenance/historical-acceptance-verdict.json');
      if(!await exists(historicalVerdict))await fs.copyFile(verdictFile,historicalVerdict);
      await fs.writeFile(verdictFile,JSON.stringify({ok:true,result:{verdict:'inconclusive',
        overall_acceptance:receipt.overall_acceptance,
        port_decision:{verdict:'inconclusive'},target_acceptance:{status:'inconclusive'},
        adaptation_authority:receipt.adaptation_authority,
        historical_result:{path:'maintenance/historical-acceptance-verdict.json',sha256:digest(await fs.readFile(historicalVerdict))}}},null,2)+'\n');
    }
    if(name==='quand-le-soleil-se-couche') Object.assign(receipt.candidate,{
      template_css_sha256:digest(await fs.readFile(path.join(dir,'candidate-template.css'))),
      validation_css_sha256:pkg.outputs['candidate.css'],
      publishable_theme_sha256:pkg.outputs['publishable-theme.wikidot.txt'],
      publishable_theme_bytes:(await fs.stat(path.join(dir,'publishable-theme.wikidot.txt'))).size,
    });
    await fs.writeFile(receiptFile,JSON.stringify(receipt,null,2)+'\n');
  }
  const manifestFile=path.join(dir,'manifest.json');
  if(await exists(manifestFile)) {
    const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    if(manifest.source_identity)manifest.source_identity.final_verdict='inconclusive';
    if(dependencyCount!==null)manifest.asset_dependency_decision_count=dependencyCount;
    manifest.final_verdict='inconclusive';
    manifest.overall_acceptance={status:'inconclusive',reason:'Historical candidate acceptance superseded'};
    manifest.adaptation_authority={ledger:'../adaptation-authority.json',publishable_without_authority:0};
    await fs.writeFile(manifestFile,JSON.stringify(manifest,null,2)+'\n');
  }
  const portFile=path.join(dir,'PORT.md');
  if(await exists(portFile)) {
    let text=await fs.readFile(portFile,'utf8');
    const marker='<!-- adaptation-authority-current -->';
    if(text.includes(marker))text=text.slice(text.indexOf('<!-- adaptation-authority-end -->')+'<!-- adaptation-authority-end -->'.length).trimStart();
    text=`${marker}\nCurrent publication inputs have passed the adaptation-authority gate. Historical campaign/local-runtime screenshots describe the superseded candidate; they are not acceptance for this CSS. See ../ADAPTATION-AUTHORITY-AUDIT.md and maintenance/historical-receipt.json where present.\nCurrent source SHA-256: ${pkg.outputs[pkg.source_file]}; CSS SHA-256: ${pkg.outputs['candidate.css']}. Full port acceptance remains a separate combined result.\n<!-- adaptation-authority-end -->\n\n${text}`;
    await fs.writeFile(portFile,text);
  }
}
await fs.writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
const campaignFile=path.join(ports,'en-theme-campaign.json');
const campaign=JSON.parse(await fs.readFile(campaignFile,'utf8'));
for(const theme of campaign.themes) {
  const historical={};
  for(const key of acceptanceKeys)if(key in theme){historical[key]=theme[key];delete theme[key];}
  if(!theme.historical_acceptance)theme.historical_acceptance={status:'SUPERSEDED_CANDIDATE',...historical};
  theme.final_verdict='inconclusive';
  theme.adaptation_authority={status:'pass',publishable_without_authority:0};
}
campaign.adaptation_authority={schema:ledger.schema,ledger:'adaptation-authority.json',publishable_without_authority:0,scope:'Deterministic authority-cleaned inputs; historical local visual acceptance is superseded.'};
// Retain historical replay assets while distinguishing present dependencies.
const indexFile=path.join(ports,'shared-replay-assets.json');
const index=JSON.parse(await fs.readFile(indexFile,'utf8'));
const priorAssets=new Map(index.assets.map(row=>[path.basename(row.path),row]));
const currentUsers=new Map();
const use=(hash,name)=>{if(!currentUsers.has(hash))currentUsers.set(hash,new Set());currentUsers.get(hash).add(name)};
for(const theme of campaign.themes) {
  const name=theme.slug.replace(/^theme:/u,''),dir=path.join(ports,name);
  for(const file of ['assets.json','page-assets.json']) if(await exists(path.join(dir,file))) {
    const data=JSON.parse(await fs.readFile(path.join(dir,file),'utf8'));
    for(const asset of [...(data.assets??[]),...(data.import_provenance??[])])use(asset.sha256,name);
  }
  if(await exists(path.join(dir,'candidate-base.css')))for(const match of (await fs.readFile(path.join(dir,'candidate-base.css'),'utf8')).matchAll(/([a-f0-9]{64})\.[a-z0-9]+/gu))use(match[1],name);
  const data=JSON.parse(await fs.readFile(path.join(dir,'assets.json'),'utf8'));
  const pageFile=path.join(dir,'page-assets.json');
  theme.dependency_decision_count=data.dependency_decisions.length+(await exists(pageFile)?JSON.parse(await fs.readFile(pageFile,'utf8')).dependency_decisions?.length??0:0);
}
const assetRoot=path.join(ports,'shared-replay-assets');
index.assets=[];
for(const name of (await fs.readdir(assetRoot)).sort()) {
  const file=path.join(assetRoot,name);if(!(await fs.stat(file)).isFile())continue;
  const bytes=await fs.readFile(file),hash=digest(bytes);
  if(!name.startsWith(hash+'.'))throw new Error(`corrupt shared replay asset: ${name}`);
  const previous=priorAssets.get(name);
  index.assets.push({path:`install/local/theme-lab/ports/shared-replay-assets/${name}`,sha256:hash,bytes:bytes.length,
    used_by:[...(currentUsers.get(hash)??[])].sort(),historical_used_by:previous?.historical_used_by??previous?.used_by??[]});
}
index.asset_count=index.assets.length;index.total_bytes=index.assets.reduce((total,row)=>total+row.bytes,0);
index.scope='Current dependency usage and retained historical replay usage are separate; no historical asset was deleted.';
await fs.writeFile(indexFile,JSON.stringify(index,null,2)+'\n');
await fs.writeFile(campaignFile,JSON.stringify(campaign,null,2)+'\n');
console.log(JSON.stringify({packages:Object.keys(ledger.packages).length,outputs_bound:true,publishable_without_authority:0}));
