#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {candidateIdentity} from '../../scripts/candidate-identity.mjs';

const work=path.dirname(fileURLToPath(import.meta.url));
const themeLab=path.resolve(work,'../../..');
const ports=path.join(themeLab,'ports');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ledger=JSON.parse(fs.readFileSync(path.join(ports,'adaptation-authority.json'),'utf8'));
const rows=[];
for(const [name,pkg] of Object.entries(ledger.packages)){
  const rawPath=path.join(work,'visual/raw',`${name}.json`);
  const raw=JSON.parse(fs.readFileSync(rawPath,'utf8'));
  const result=raw.result;
  const dir=path.join(ports,name);
  const css=fs.readFileSync(path.join(dir,'candidate.css'));
  const base=fs.existsSync(path.join(dir,'candidate-base.css'))?fs.readFileSync(path.join(dir,'candidate-base.css')):Buffer.alloc(0);
  const source=fs.readFileSync(path.join(dir,pkg.source_file));
  const preview=fs.readFileSync(path.join(dir,'candidate.wikidot.txt'));
  const identity={candidate_sha256:candidateIdentity(css,base).candidateSha,candidate_css_sha256:sha(css),candidate_base_css_sha256:base.length?sha(base):null,candidate_source_sha256:sha(source),candidate_source_path:`ports/${name}/${pkg.source_file}`,candidate_preview_sha256:sha(preview)};
  for(const [viewport,capture] of Object.entries(result.visual?.viewports??{})){
    const candidate=path.resolve(capture.candidate_path),reference=path.resolve(capture.reference_path);
    const artifactRoot=path.resolve(work,'visual/artifacts',name)+path.sep;
    if(!candidate.startsWith(artifactRoot)||!reference.startsWith(artifactRoot))throw new Error(`${name}/${viewport}: screenshot outside current package-work artifact tree`);
    const candidateHash=sha(fs.readFileSync(candidate)),referenceHash=sha(fs.readFileSync(reference));
    if(candidateHash!==capture.candidate_screenshot_sha256||referenceHash!==capture.reference_screenshot_sha256)throw new Error(`${name}/${viewport}: screenshot hash mismatch`);
    const priorDir=path.join(dir,'artifacts');
    const priorCandidate=path.join(priorDir,`candidate-${viewport}.png`),priorReference=path.join(priorDir,`reference-${viewport}.png`);
    const priorCandidateHash=fs.existsSync(priorCandidate)?sha(fs.readFileSync(priorCandidate)):null;
    const priorReferenceHash=fs.existsSync(priorReference)?sha(fs.readFileSync(priorReference)):null;
    rows.push({package:name,viewport,status:'pending-direct-review',candidate_screenshot:{path:path.relative(themeLab,candidate),sha256:candidateHash},reference_screenshot:{path:path.relative(themeLab,reference),sha256:referenceHash},candidate_identity:identity,reference_identity:{url:result.reference?.url??null},prior_screenshot_byte_matches:{candidate:priorCandidateHash===candidateHash,reference:priorReferenceHash===referenceHash},reuse:{eligible:false,reason:'No retained review record binds this exact screenshot pair to the current candidate inputs. Historical package screenshots or aggregate contact-sheet notes do not provide that identity binding.'}});
  }
}
const out={schema:'theme_lab_current_package_visual_review_worklist.v1',generated_at:new Date().toISOString(),browser:{executable:'/usr/bin/google-chrome',version:'154.0.8037.57'},package_count:Object.keys(ledger.packages).length,pair_count:rows.length,pending_pair_count:rows.length,status:'pending-direct-review',rows};
fs.writeFileSync(path.join(work,'review-worklist.json'),JSON.stringify(out,null,2)+'\n');
console.log(JSON.stringify({packages:out.package_count,pairs:out.pair_count,pending:out.pending_pair_count,worklist:path.join(work,'review-worklist.json')}));
