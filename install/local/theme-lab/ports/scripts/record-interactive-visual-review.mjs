#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {withAuditLock} from './audit-lock.mjs';
import {candidateIdentity} from './candidate-identity.mjs';
import {captureRunContractIsCurrent} from '../../src/scoped-run-contract.mjs';
import {observationRuntimeSourceMatchesContract} from '../../src/runtime-source-identity.mjs';
import {deepwellRuntimeIdentityMatchesContract,requireDeepwellRuntimeIdentity} from '../../src/deepwell-runtime-identity.mjs';

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export function applyVisualReviews(rows, reviews, currentIdentity, reviewedAt = new Date().toISOString()) {
  const allowed = new Set(['PASS_NATURAL', 'PASS_INTENTIONAL_DIVERGENCE', 'NEEDS_FIX']);
  const updates = [];
  const rowsByScreenshot = new Map();
  for (const row of rows) {
    if (!row.screenshot_sha256) continue;
    const matching = rowsByScreenshot.get(row.screenshot_sha256) ?? [];
    matching.push(row);
    rowsByScreenshot.set(row.screenshot_sha256, matching);
  }
  for (const review of reviews) {
    if (!/^[0-9a-f]{64}$/u.test(review.screenshot_sha256 ?? '')) throw new Error('review needs an exact screenshot SHA-256');
    if (!allowed.has(review.classification)) throw new Error(`invalid visual classification: ${review.classification}`);
    if (typeof review.note !== 'string' || review.note.trim().length < 12) throw new Error('review needs a concrete visual note');
    if (review.classification === 'PASS_INTENTIONAL_DIVERGENCE' && (typeof review.intentional_difference !== 'string' || !review.intentional_difference.trim())) throw new Error('intentional divergence needs its reason');
    if (review.classification === 'NEEDS_FIX' && (!Array.isArray(review.visual_findings) || !review.visual_findings.length || review.visual_findings.some(item => typeof item !== 'string' || !item.trim()))) throw new Error('NEEDS_FIX needs a concrete finding');
    const matched = rowsByScreenshot.get(review.screenshot_sha256) ?? [];
    if (!matched.length) throw new Error(`screenshot hash not present in audit: ${review.screenshot_sha256}`);
    for (const row of matched) {
      const identity = currentIdentity.get(row.theme);
      if (!identity || row.candidate_sha256 !== identity.candidate_sha256 || row.candidate_source_sha256 !== identity.candidate_source_sha256) {
        throw new Error(`stale candidate evidence: ${row.theme} ${row.viewport} ${row.surface}.${row.state}`);
      }
      if (row.failure || !Array.isArray(row.asset_failures) || row.asset_failures.length ||
          !Array.isArray(row.page_errors) || row.page_errors.length || row.external_requests_sent !== 0 ||
          !Array.isArray(row.unconfirmed_items) ||
          row.unconfirmed_items.some(item => item !== 'screenshot captured but awaiting image review') ||
          row.action_responses != null && (!Array.isArray(row.action_responses) ||
            row.action_responses.some(response => !response || response.type === 'failure' || response.status >= 400 || response.error_message))) {
        throw new Error('cannot clear failed or unknown capture evidence with visual review');
      }
      updates.push({row, review});
    }
  }
  for (const {row, review} of updates) {
    row.decision_authority = 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY';
    row.port_conclusion_eligible = false;
    row.classification = review.classification;
    row.visual_findings = review.visual_findings ?? [];
    row.intentional_differences = review.intentional_difference ? [review.intentional_difference] : [];
    row.unconfirmed_items = [];
    row.reviewed_after_last_change = true;
    delete row.visual_review_reuse;
    delete row.review_provenance;
    row.visual_review = {
      method: 'direct-image-vision-review',
      reviewed_at: reviewedAt,
      screenshot_sha256: review.screenshot_sha256,
      candidate_sha256: row.candidate_sha256,
      candidate_source_sha256: row.candidate_source_sha256,
      note: review.note,
      reviewer: typeof review.reviewer==='string'&&review.reviewer.trim()?review.reviewer.trim():'Codex visual capability',
      decision_authority: 'SCP_JP_LOCAL_TARGET_ACCEPTANCE_ONLY',
      port_conclusion_eligible: false
    };
  }
  return {updated_rows: updates.length, unique_images: new Set(updates.map(({review}) => review.screenshot_sha256)).size};
}

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const args=process.argv.slice(2);
  const input = args[0];
  if (!input) throw new Error('usage: node record-interactive-visual-review.mjs <review-evidence.json>');
  const auditOption=args.indexOf('--audit');
  const runContractArg=args.find(arg=>arg.startsWith('--run-contract='))?.slice('--run-contract='.length);
  const auditPath = auditOption<0 ? path.join(root, 'interactive-visual-audit.json') : path.resolve(args[auditOption+1]);
  if(!auditPath.startsWith(path.resolve(root,'..')+path.sep))throw new Error('review audit must remain inside Theme Lab');
  const evidence = JSON.parse(await fs.readFile(path.resolve(input), 'utf8'));
  if (!Array.isArray(evidence.reviews) || evidence.reviews.length === 0) throw new Error('review evidence must contain a non-empty reviews array');
  await withAuditLock(auditPath, async () => {
    const auditBytes=await fs.readFile(auditPath);
    if(evidence.audit_sha256&&sha(auditBytes)!==evidence.audit_sha256)throw new Error('visual review evidence names a stale input audit SHA');
    const audit = JSON.parse(auditBytes.toString('utf8'));
    const known = new Map();
    for (const row of audit.records) {
      const values = known.get(row.theme) ?? new Set();
      if (row.candidate_sha256) values.add(row.candidate_sha256);
      known.set(row.theme, values);
    }
    const current = new Map();
    const migrationContractPath=path.resolve(root,'../sigma10-migration/current-campaign/run-contract.json');
    const sigma9ContractPath=path.resolve(root,'current-acceptance/run-contract.json');
    let migrationContract=null;
    if(auditPath.startsWith(path.dirname(migrationContractPath)+path.sep)){
      try{migrationContract=JSON.parse(await fs.readFile(migrationContractPath,'utf8'))}catch{}
    }
    const migrationSha=migrationContract?sha(await fs.readFile(migrationContractPath)):null;
    const runContractPath=runContractArg?path.resolve(runContractArg):migrationContract?migrationContractPath:sigma9ContractPath;
    const runContractBytes=await fs.readFile(runContractPath);
    const currentRunContract=JSON.parse(runContractBytes);
    const currentRunContractSha=sha(runContractBytes);
    requireDeepwellRuntimeIdentity(currentRunContract.expected_backend_runtime_identity,`${migrationContract?'Sigma-10':'Sigma-9'} review run contract`);
    if(evidence.candidate_set_sha256&&evidence.candidate_set_sha256!==currentRunContract.candidate_set_sha256)throw new Error('visual review evidence is not bound to the current candidate set');
    if(evidence.run_contract_sha256&&evidence.run_contract_sha256!==currentRunContractSha)throw new Error('visual review evidence is not bound to the selected run contract');
    if(migrationContract){
      for(const binding of Object.values(migrationContract.frozen_sigma10_authority?.artifacts??{})){
        const bytes=await fs.readFile(path.resolve(root,'..',binding.path));
        if(sha(bytes)!==binding.sha256)throw new Error(`frozen Sigma-10 authority changed: ${binding.path}`);
      }
      const manifestBytes=await fs.readFile(path.resolve(root,'..',migrationContract.frozen_sigma10_authority.source_manifest));
      if(sha(manifestBytes)!==migrationContract.frozen_sigma10_authority.source_manifest_sha256)throw new Error('Sigma-10 source manifest differs from frozen authority');
      const manifest=JSON.parse(manifestBytes);
      for(const [identity,page] of Object.entries(manifest.pages??[])){
        const bytes=await fs.readFile(path.resolve(path.dirname(migrationContractPath),'..',page.file));
        if(sha(bytes)!==page.sha256)throw new Error(`frozen Sigma-10 source changed: ${identity}`);
      }
      const saved=JSON.parse(await fs.readFile(path.resolve(path.dirname(migrationContractPath),'saved-credit-component.json')));
      if(JSON.stringify(saved.cascade)!==JSON.stringify(migrationContract.saved_component_css?.cascade)||sha(await fs.readFile(path.resolve(path.dirname(migrationContractPath),migrationContract.saved_component_css.path)))!==saved.css_sha256)throw new Error('saved-page Credit cascade or CSS binding changed');
    }
    for (const theme of new Set(audit.records.map(row => row.theme))) {
      const declared=migrationContract?.current_candidate_inventory?.find(item=>item.package===theme);
      const dir = declared?path.resolve(path.dirname(migrationContractPath),declared.directory):path.join(root, theme);
      const css = await fs.readFile(path.join(dir, 'candidate.css'));
      const base = await fs.readFile(path.join(dir, 'candidate-base.css')).catch(() => Buffer.alloc(0));
      const source = await fs.readFile(path.join(dir, 'candidate.wikidot.source.txt')).catch(() => fs.readFile(path.join(dir, 'candidate.wikidot.txt')));
      current.set(theme, {
        candidate_sha256: candidateIdentity(css, base, known.get(theme)).candidateSha,
        candidate_source_sha256: sha(source)
      });
      if(declared&&(current.get(theme).candidate_sha256!==declared.candidate_sha256||current.get(theme).candidate_source_sha256!==declared.source_sha256))throw new Error(`stale current Sigma-10 candidate identity: ${theme}`);
    }
    const rowsByScreenshot = new Map();
    for (const row of audit.records) {
      if (!row.screenshot_sha256) continue;
      const matching = rowsByScreenshot.get(row.screenshot_sha256) ?? [];
      matching.push(row);
      rowsByScreenshot.set(row.screenshot_sha256, matching);
    }
    const verifiedPaths = new Set();
    for (const review of evidence.reviews) {
      const matching = rowsByScreenshot.get(review.screenshot_sha256) ?? [];
      if (!matching.length) throw new Error(`no audit row for screenshot ${review.screenshot_sha256}`);
      if(matching.some(row=>!captureRunContractIsCurrent(row,currentRunContract,currentRunContractSha)))throw new Error('cannot review browser evidence from a superseded run contract');
      if(matching.some(row=>!observationRuntimeSourceMatchesContract(row,currentRunContract)))throw new Error('cannot review browser evidence from a superseded Framerail runtime');
      if(matching.some(row=>!deepwellRuntimeIdentityMatchesContract(row,currentRunContract)))throw new Error('cannot review browser evidence from a superseded Deepwell backend runtime');
      for (const screenshot of new Set(matching.map(row => row.screenshot))) {
        const key = `${screenshot}\0${review.screenshot_sha256}`;
        if (verifiedPaths.has(key)) continue;
        const bytes = await fs.readFile(path.join(root, screenshot));
        if (sha(bytes) !== review.screenshot_sha256) throw new Error(`screenshot bytes do not match review hash: ${screenshot}`);
        verifiedPaths.add(key);
      }
    }
    const result = applyVisualReviews(audit.records, evidence.reviews, current);
    audit.updated_at = new Date().toISOString();
    audit.visual_review_updates = (audit.visual_review_updates ?? 0) + evidence.reviews.length;
    const temporary = `${auditPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(audit) + '\n');
    await fs.rename(temporary, auditPath);
    console.log(JSON.stringify({schema:'theme_lab_visual_review_update.v1', ...result, evidence_entries:evidence.reviews.length}));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
