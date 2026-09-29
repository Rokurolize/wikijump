#!/usr/bin/env node
// One-time inventory migration from the pre-authority campaign. The immutable
// diagnostic bytes remain reviewable but are never a publication input.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {digest} from '../../src/adaptation-authority.mjs';
import {splitMaintainableCandidate} from './prepare-maintainable-sources.mjs';

const ports=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerPath=path.join(ports,'adaptation-authority.json');
try { await fs.access(ledgerPath); throw new Error('inventory already exists; reconcile reviewed inputs instead of reclassifying history'); }
catch(error) { if(error.code!=='ENOENT') throw error; }
const campaign=JSON.parse(await fs.readFile(path.join(ports,'en-theme-campaign.json'),'utf8'));
const ledger={schema:'theme_lab_adaptation_authority.v1',audited_at:new Date().toISOString(),
  policy:'Local Wikijump acceptance, synthetic fixtures, and campaign image review cannot authorize published JP adaptation CSS.',packages:{}};

function diagnosticBlocks(css) {
  const markers=[...css.matchAll(/\/\*([\s\S]*?)\*\//gu)].filter(m=>/^(?:SCP-JP|Campaign JP|JP runtime|SCPedia JP runtime)/u.test(m[1].trim()));
  return markers.map((m,i)=>({marker:m[1].replace(/\s+/gu,' ').trim(),css:css.slice(m.index,markers[i+1]?.index??css.length).trim()}));
}
function disposition(marker) {
  return /interaction adaptation: reveal Sigma|navigation adaptation:/u.test(marker)?'REMOVE':'NONPUBLISHABLE_QUARANTINE';
}
for(const theme of campaign.themes) {
  const name=theme.slug.replace(/^theme:/u,''),dir=path.join(ports,name);
  const source=await fs.readFile(path.join(dir,'candidate.wikidot.source.txt'),'utf8');
  const prior=JSON.parse(await fs.readFile(path.join(dir,'maintenance/manifest.json'),'utf8'));
  const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  const classification=manifest.maintenance_classification?JSON.parse(await fs.readFile(path.join(dir,manifest.maintenance_classification),'utf8')):{};
  const {base}=splitMaintainableCandidate(source,{unmarkedAdaptations:classification.unmarked_adaptation_modules??[]});
  const css=await fs.readFile(path.join(dir,'candidate-source.css'),'utf8');
  const first=css.search(/\/\* SCP-JP (?:responsive adaptation|interaction adaptation)/u);
  if(first<0) throw new Error(`${name}: historical CSS boundary missing`);
  const input=css.slice(0,first).trimEnd()+'\n';
  await fs.writeFile(path.join(dir,'maintenance/historical-diagnostic.wikidot.txt'),source);
  await fs.writeFile(path.join(dir,'maintenance/historical-diagnostic.css'),css);
  await fs.writeFile(path.join(dir,'maintenance/authority-base.wikidot.txt'),base);
  await fs.writeFile(path.join(dir,'candidate-input.css'),input);
  await fs.writeFile(path.join(dir,'authority-overrides.css'),'');
  const blocks=prior.historical_adaptations.map(row=>({...row,origin:'historical-source-module',authority:disposition(row.marker),
    rationale:disposition(row.marker)==='REMOVE'?'Established source/target read-only A/B rejects the invented shared behavior.':'Historical runtime/image-review provenance is not certified Wikidot adaptation authority; excluded from publication.',
    diagnostic_file:'maintenance/historical-diagnostic.wikidot.txt'}));
  for(const block of diagnosticBlocks(css.slice(first))) {
    const sha256=digest(block.css);
    if(blocks.some(row=>row.sha256===sha256)) continue;
    blocks.push({marker:block.marker,sha256,origin:'historical-css-input',authority:disposition(block.marker),
      rationale:'Campaign-only runtime/fixture evidence; this complete historical block is excluded from publishable inputs.',diagnostic_file:'maintenance/historical-diagnostic.css'});
  }
  if(manifest.flattened_css_transforms) {
    const file=path.join(dir,manifest.flattened_css_transforms), transforms=JSON.parse(await fs.readFile(file,'utf8'));
    await fs.writeFile(path.join(dir,'maintenance/historical-localization-transforms.json'),JSON.stringify(transforms,null,2)+'\n');
    for(const transform of transforms.transforms) blocks.push({marker:transform.id,sha256:digest(JSON.stringify(transform)),origin:'flattened-css-transform',authority:'NONPUBLISHABLE_QUARANTINE',rationale:transform.reason,diagnostic_file:'maintenance/historical-localization-transforms.json'});
    transforms.transforms=[];
    await fs.writeFile(file,JSON.stringify(transforms,null,2)+'\n');
  }
  const evidence=[{path:`${name}/upstream-en.wikidot.txt`,sha256:digest(await fs.readFile(path.join(dir,'upstream-en.wikidot.txt'))),decision_authority:'FROZEN_WIKIDOT_SOURCE'}];
  if(manifest.jp_previous_source_sha256) evidence.push({path:`${name}/existing-jp.wikidot.txt`,sha256:digest(await fs.readFile(path.join(dir,'existing-jp.wikidot.txt'))),decision_authority:'FROZEN_WIKIDOT_SOURCE'});
  blocks.push({marker:'source-theme-and-localized-document-input',origin:'preserved-source',sha256:digest(input),authority:'SOURCE_THEME',
    rationale:'Preserve source-theme imports, source declarations, include parameters and localized documentation before the historical campaign suffix. Asset freezing and include expansion are separate runtime-independent transforms.',evidence});
  ledger.packages[name]={source_file:'candidate.wikidot.source.txt',blocks,inputs:{'maintenance/authority-base.wikidot.txt':digest(base),'candidate-input.css':digest(input),'authority-overrides.css':digest('')},outputs:{}};
}

// Dear Dictator is a standalone package without the EN maintenance manifest.
{
  const name='dear-dictator',dir=path.join(ports,name),css=await fs.readFile(path.join(dir,'candidate.css'),'utf8');
  await fs.mkdir(path.join(dir,'maintenance'),{recursive:true});
  await fs.writeFile(path.join(dir,'maintenance/historical-diagnostic.css'),css);
  let input=css.slice(0,css.indexOf('/* SCP-JP interaction adaptation:'));
  const blocks=diagnosticBlocks(css.slice(input.length)).map(row=>({marker:row.marker,sha256:digest(row.css),origin:'historical-css-input',authority:disposition(row.marker),rationale:'Local campaign evidence only; excluded from publication.',diagnostic_file:'maintenance/historical-diagnostic.css'}));
  for(const [marker,start,end] of [
    ['unmarked-search-reveal',input.indexOf('@media (min-width: 768px) {\n  #search-top-box-form:hover'),input.indexOf('#search-top-box-form input[type="submit"]')],
    ['unmarked-credit-modal-flow',input.indexOf('/* Keep the current SCP-JP Rate module'),input.indexOf('.chapter {')],
    ['unmarked-mobile-runtime-layout',input.indexOf('@media (max-width: 767px) {\n  #side-bar { display: none; }'),input.length],
  ].sort((a,b)=>b[1]-a[1])) {
    if(start<0||end<=start) throw new Error(`Dear Dictator historical boundary missing: ${marker}`);
    blocks.push({marker,sha256:digest(input.slice(start,end).trim()),origin:'unmarked-historical-css',authority:'NONPUBLISHABLE_QUARANTINE',rationale:'Runtime-based repair without a Wikidot authority receipt.',diagnostic_file:'maintenance/historical-diagnostic.css'});
    input=input.slice(0,start)+input.slice(end);
  }
  const reference=JSON.parse(await fs.readFile(path.join(dir,'reference.json'),'utf8'));
  const cache=path.join(process.env.HOME,'.cache/wikijump/theme-lab/objects',reference.theme_css_sha256.slice(0,2),reference.theme_css_sha256);
  const upstream=await fs.readFile(cache);
  if(digest(upstream)!==reference.theme_css_sha256) throw new Error('Dear Dictator source CSS identity mismatch');
  await fs.writeFile(path.join(dir,'upstream-ko.css'),upstream);
  await fs.writeFile(path.join(dir,'candidate-input.css'),input);
  const base=await fs.readFile(path.join(dir,'candidate.wikidot.txt'),'utf8');
  // The source currently also carries campaign CSS modules. Retain prose and
  // source-specific demonstration markup, remove marked campaign modules.
  const clean=base.replace(/\[\[module\s+CSS\]\]([\s\S]*?)\[\[\/module\]\]/giu,(whole,body)=>/^SCP-JP\b/mu.test(body.match(/\/\*([\s\S]*?)\*\//u)?.[1]?.trim()??'')?'':whole);
  await fs.writeFile(path.join(dir,'maintenance/authority-base.wikidot.txt'),clean);
  await fs.writeFile(path.join(dir,'authority-overrides.css'),'');
  blocks.push({marker:'localized-source-and-demo',sha256:digest(input),origin:'preserved-source',authority:'RUNTIME_INDEPENDENT',rationale:'Localized strings/fonts, frozen assets, existing JP license policy and authored .dd-* demonstration markup preserve the source; unproven search/modal/mobile repairs are excluded.',evidence:[{path:`${name}/upstream-ko.css`,sha256:reference.theme_css_sha256,decision_authority:'FROZEN_WIKIDOT_SOURCE'}]});
  ledger.packages[name]={source_file:'candidate.wikidot.txt',blocks,inputs:{'candidate-input.css':digest(input),'authority-overrides.css':digest(''),'maintenance/authority-base.wikidot.txt':digest(clean)},outputs:{}};
}

// FR's mapped ct_* variables and responsive Sigma geometry are source-backed;
// remove only the invalid final shared navigation adaptation.
{
  const name='quand-le-soleil-se-couche',dir=path.join(ports,name),css=await fs.readFile(path.join(dir,'candidate-template.css'),'utf8');
  const start=css.indexOf('/* SCP-JP navigation adaptation:');
  if(start<0) throw new Error('FR historical navigation boundary missing');
  await fs.mkdir(path.join(dir,'maintenance'),{recursive:true});
  await fs.writeFile(path.join(dir,'maintenance/historical-diagnostic.css'),css);
  const input=css.slice(0,start).trimEnd()+'\n';
  await fs.writeFile(path.join(dir,'candidate-template.css'),input);
  await fs.writeFile(path.join(dir,'candidate.css'),input.replace('{$sous-titre}','夜明けまで忘れるな'));
  ledger.packages[name]={source_file:'candidate.wikidot.txt',blocks:[{marker:'SCP-JP navigation adaptation: localized-label shared sizing',sha256:digest(css.slice(start).trim()),origin:'historical-css-input',authority:'REMOVE',rationale:'Real target passes without this rule; the rule introduces off-left clipping.',diagnostic_file:'maintenance/historical-diagnostic.css'},
    {marker:'source-ct-variable-Sigma-mapping',sha256:digest(input),origin:'preserved-source',authority:'RUNTIME_INDEPENDENT',rationale:'Frozen FR variables, KO structural mapping and JP hub source establish the port mapping; responsive header follows source intent at 100px desktop / 55px mobile.',evidence:await Promise.all(['upstream-fr.wikidot.txt','upstream-ko.wikidot.txt','current-jp-hub.wikidot.txt'].map(async file=>({path:`${name}/${file}`,sha256:digest(await fs.readFile(path.join(dir,file))),decision_authority:'FROZEN_WIKIDOT_SOURCE'})))}],inputs:{'candidate-template.css':digest(input)},outputs:{}};
}
await fs.writeFile(ledgerPath,JSON.stringify(ledger,null,2)+'\n');
console.log(JSON.stringify({packages:Object.keys(ledger.packages).length,blocks:Object.values(ledger.packages).reduce((n,p)=>n+p.blocks.length,0)}));
