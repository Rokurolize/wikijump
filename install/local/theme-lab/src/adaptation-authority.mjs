import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {extractSCPJPAdaptationBlocks} from './port-maintenance.mjs';

export const PUBLISHABLE_AUTHORITIES = new Set([
  'SOURCE_THEME', 'SOURCE_AND_TARGET_CERTIFIED', 'TARGET_WIKIDOT_CERTIFIED', 'RUNTIME_INDEPENDENT',
]);
export const ADAPTATION_AUTHORITIES = new Set([...PUBLISHABLE_AUTHORITIES, 'NONPUBLISHABLE_QUARANTINE', 'REMOVE']);
export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const ports = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ports');

// Independently certified corrections retain their own module/provenance boundary.
export function composeAuthoritySource(base, css) {
  const trimmed = css.trim();
  if (!trimmed) return base.trimEnd() + '\n';
  const blocks = trimmed.split('/* THEME_LAB_AUTHORITY_BLOCK_BOUNDARY */').map(block => block.trim());
  if (blocks.some(block => !block)) throw new Error('empty authority block');
  return base.trimEnd() + '\n' + blocks.map(block => `\n[[module CSS]]\n${block}\n[[/module]]\n`).join('');
}

export function validateAuthority(row) {
  if (!ADAPTATION_AUTHORITIES.has(row.authority)) throw new Error(`missing/unsupported adaptation authority: ${row.marker}`);
  if (PUBLISHABLE_AUTHORITIES.has(row.authority)) {
    if (!row.evidence?.length) throw new Error(`publishable adaptation lacks evidence: ${row.marker}`);
    for (const evidence of row.evidence) {
      if (!evidence.path || !/^[a-f0-9]{64}$/u.test(evidence.sha256 ?? '')) throw new Error(`unbound authority evidence: ${row.marker}`);
      if (/LOCAL_TARGET_ACCEPTANCE_ONLY|SYNTHETIC/iu.test(evidence.decision_authority ?? '')) throw new Error(`local/synthetic observation cannot authorize adaptation: ${row.marker}`);
    }
  }
  return row;
}

export function verifyEvidence(rows, root = ports) {
  for (const row of rows) {
    validateAuthority(row);
    if (!PUBLISHABLE_AUTHORITIES.has(row.authority)) continue;
    for (const evidence of row.evidence) {
      const file = path.resolve(root, evidence.path);
      if (!file.startsWith(root + path.sep)) throw new Error('authority evidence must be frozen inside the package tree');
      if (digest(fs.readFileSync(file)) !== evidence.sha256) throw new Error(`stale authority evidence: ${evidence.path}`);
      if (row.authority.includes('CERTIFIED')) {
        const receipt = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (receipt.schema !== 'theme_lab_wikidot_adaptation_ab.v1' || receipt.public_writes !== 0 || !receipt.url || !receipt.observed_at || !receipt.snapshot?.entry) throw new Error(`invalid Wikidot A/B authority receipt: ${evidence.path}`);
        const after = receipt.rows.filter(r=>r.variant==='with');
        if(!/^https:\/\/[a-z0-9-]+\.wikidot\.com\//u.test(receipt.url) || receipt.site!==new URL(receipt.url).hostname || receipt.external_browser_requests!==0) throw new Error(`invalid public read-only Wikidot identity: ${evidence.path}`);
        if(row.scope?.target_url && receipt.url!==row.scope.target_url) throw new Error(`wrong target authority: ${evidence.path}`);
        if(row.scope?.viewports?.some(width=>!after.some(r=>r.width===width))) throw new Error(`incomplete authority viewport coverage: ${evidence.path}`);
        if(!receipt.rows.some(r=>r.variant==='without' && !r.pass)) throw new Error(`target adaptation has no demonstrated A/B need: ${evidence.path}`);
        if (!after.length || after.some(r=>!r.pass || r.bounds.some(b=>!b.pass))) throw new Error(`failed target geometry authority: ${evidence.path}`);
        if (row.published_css_sha256 && after.some(r=>r.css_sha256!==row.published_css_sha256)) throw new Error(`authority capture has stale candidate CSS: ${evidence.path}`);
        for(const capture of receipt.rows) for(const [fileKey,hashKey] of [['screenshot','screenshot_sha256'],['dom','dom_sha256']]) {
          if(digest(fs.readFileSync(path.join(path.dirname(file),capture[fileKey])))!==capture[hashKey]) throw new Error(`corrupt authority artifact: ${capture[fileKey]}`);
        }
        for(const hash of receipt.snapshot.object_digests) {
          if(digest(fs.readFileSync(path.join(root,'authority-evidence/replay/objects',hash.slice(0,2),hash)))!==hash) throw new Error(`corrupt frozen Wikidot replay object: ${hash}`);
        }
      }
    }
  }
}

export function authorityInventory(name) {
  const ledger = JSON.parse(fs.readFileSync(path.join(ports, 'adaptation-authority.json'), 'utf8'));
  const pkg = ledger.packages[name];
  if (!pkg) throw new Error(`package lacks adaptation authority inventory: ${name}`);
  return pkg;
}

export function assertPublishablePackage(name, {checkOutputs = false} = {}) {
  const pkg = authorityInventory(name), dir = path.join(ports, name);
  verifyEvidence(pkg.blocks);
  for(const block of pkg.blocks) if(block.diagnostic_file && digest(fs.readFileSync(path.join(dir,block.diagnostic_file)))!==block.diagnostic_file_sha256) throw new Error(`${name}: historical diagnostic evidence changed: ${block.marker}`);
  for (const [file, sha] of Object.entries(pkg.inputs)) {
    if (digest(fs.readFileSync(path.join(dir,file))) !== sha) throw new Error(`${name}: unreviewed adaptation input ${file}`);
  }
  const sourceDisposition=pkg.blocks.find(row=>row.origin==='preserved-source');
  if(!sourceDisposition || sourceDisposition.sha256!==pkg.inputs[name==='quand-le-soleil-se-couche'?'candidate-template.css':'candidate-input.css']) throw new Error(`${name}: source input lacks matching authority disposition`);
  const sourceFile = pkg.source_file;
  const manifestFile=path.join(dir,'manifest.json');
  if(fs.existsSync(manifestFile)) {
    const manifest=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
    if(manifest.flattened_css_transforms) {
      const transforms=JSON.parse(fs.readFileSync(path.join(dir,manifest.flattened_css_transforms),'utf8'));
      for(const transform of transforms.transforms ?? []) {
        const disposition=pkg.blocks.find(row=>row.origin==='flattened-css-transform' && row.sha256===digest(JSON.stringify(transform)));
        if(!disposition || !PUBLISHABLE_AUTHORITIES.has(disposition.authority)) throw new Error(`${name}: unauthorized flattened CSS transform: ${transform.id}`);
      }
    }
  }
  const source = fs.readFileSync(path.join(dir,sourceFile),'utf8');
  if (pkg.inputs['maintenance/authority-base.wikidot.txt']) {
    const base=fs.readFileSync(path.join(dir,'maintenance/authority-base.wikidot.txt'),'utf8');
    const css=fs.readFileSync(path.join(dir,'authority-overrides.css'),'utf8').trim();
    const expected=composeAuthoritySource(base,css);
    if(source!==expected) throw new Error(`${name}: candidate source is not the authority-bound composition`);
  }
  for (const block of extractSCPJPAdaptationBlocks(source)) {
    const disposition = pkg.blocks.find(r=>r.sha256===block.sha256 && r.marker===block.marker);
    if (!disposition || !PUBLISHABLE_AUTHORITIES.has(disposition.authority)) throw new Error(`${name}: unauthorized publishable adaptation: ${block.marker}`);
  }
  for (const file of ['candidate-input.css', 'authority-overrides.css'].filter(f=>pkg.inputs[f])) {
    const css=fs.readFileSync(path.join(dir,file),'utf8');
    if (/SCP-JP interaction adaptation: reveal Sigma|Theme Lab evidenced viewport|Campaign JP|SCP-JP navigation adaptation: constrain submenu/u.test(css)) throw new Error(`${name}: historical/synthetic CSS in publishable input ${file}`);
  }
  if (checkOutputs) {
    if(!pkg.outputs?.['candidate.css'] || !pkg.outputs?.[pkg.source_file]) throw new Error(`${name}: unbound publication outputs`);
    for (const [file, sha] of Object.entries(pkg.outputs)) {
      if (digest(fs.readFileSync(path.join(dir,file))) !== sha) throw new Error(`${name}: stale derived candidate ${file}`);
    }
    for(const block of pkg.blocks) if(block.published_css_sha256 && block.published_css_sha256!==pkg.outputs['candidate.css']) throw new Error(`${name}: retained adaptation proof does not match current published CSS`);
    const receipt=JSON.parse(fs.readFileSync(path.join(dir,'receipt.json'),'utf8'));
    if(receipt.candidate_source_sha256!==pkg.outputs[pkg.source_file] || receipt.candidate_css_sha256!==pkg.outputs['candidate.css']) throw new Error(`${name}: stale current candidate receipt`);
    if(receipt.final_verdict!==receipt.overall_acceptance?.status) throw new Error(`${name}: ambiguous receipt final acceptance`);
  }
  return {theme:name,audited:pkg.blocks.length,publishable:pkg.blocks.filter(r=>PUBLISHABLE_AUTHORITIES.has(r.authority)).length,without_authority:0};
}
