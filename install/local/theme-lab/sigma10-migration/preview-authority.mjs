import fs from 'node:fs';
import path from 'node:path';
import {digest} from '../src/adaptation-authority.mjs';
export function validateSigmaPreviewFinding(finding, evidenceRoot = null) {
  if(!finding || finding.id!=='SIGMA10-MOB-001')throw new Error('Sigma-10 preview authority disposition missing');
  if(finding.classification==='UNVERIFIED_PREVIEW_HYPOTHESIS') {
    if(finding.blocker!==false || finding.actionable!==false || finding.port_conclusion_eligible!==false)throw new Error('unverified Sigma-10 preview hypothesis cannot require a migration or source change');
    if(!finding.confirmation_required || !finding.read_only_preview_attempt || !finding.source_saved_page_evidence)throw new Error('unverified preview hypothesis lacks bounded evidence and a confirmation requirement');
    if(evidenceRoot) {
      for(const key of ['read_only_preview_attempt','source_saved_page_evidence']) {
        const file=path.resolve(evidenceRoot,finding[key]);
        if(digest(fs.readFileSync(file))!==finding[key+'_sha256'])throw new Error('stale Sigma-10 preview authority evidence');
        const receipt=JSON.parse(fs.readFileSync(file,'utf8'));
        if(receipt.public_writes!==0 || receipt.url!=='https://pseudo-scp-jp.wikidot.com/sigma-10:main')throw new Error('invalid read-only Sigma-10 source identity');
        if(key==='read_only_preview_attempt') {
          if(receipt.edit_locks!==0)throw new Error('preview evidence acquired an edit lock');
          for(const source of receipt.source_reads)if(digest(fs.readFileSync(path.join(path.dirname(file),source.file)))!==source.sha256)throw new Error('stale Sigma-10 source chain');
          if(digest(fs.readFileSync(path.join(path.dirname(file),'preview.html')))!==receipt.result.sha256)throw new Error('stale partial preview response');
        }
      }
    }
    return;
  }
  // A local preview simulation, saved-page screenshot, or anonymous rendered
  // body alone cannot establish the real editor/browser preview cascade.
  throw new Error('Sigma-10 preview blocker requires a separately reviewed true non-mutating Wikidot preview-state certificate');
}
