import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root=path.resolve(process.argv[2]),lab=path.join(root,'install/local/theme-lab'),failures=[];
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const read=p=>JSON.parse(fs.readFileSync(p));
let checked=0;
const check=(file,hash)=>{if(!path.resolve(file).startsWith(root+'/'))throw new Error('Path escapes clean checkout');if(sha(fs.readFileSync(file))!==hash)failures.push('Hash mismatch: '+path.relative(root,file));checked++;};
const rich=path.join(lab,'ports/current-acceptance/rich-body-probe-20261006');
const review=read(path.join(rich,'visual-review.json'));
for(const name of ['receipt','baseline-receipt']){
 const doc=read(path.join(rich,name+'.json')), {receipt_sha256,...body}=doc;
 if(sha(JSON.stringify(body))!==receipt_sha256)failures.push(name+' canonical body hash mismatch');
 if(review[name==='receipt'?'capture_receipt':'baseline_receipt'].sha256!==receipt_sha256)failures.push(name+' review binding mismatch');
}
for(const row of [...review.reviews,...review.baseline_screenshots])check(path.join(lab,row.screenshot_path),row.screenshot_sha256);
for(const row of review.contact_sheets)check(path.join(lab,row.path),row.sha256);
for(const folder of ['al-slop-current-navigation-20261007','flopstyle-dark-rev401-sigma10-credit-otherwise-20261007','space-current-navigation-20261007']){
 const dir=path.join(lab,'ports/authority-evidence',folder),receipt=read(path.join(dir,'receipt.json')),review=read(path.join(dir,'visual-review.json'));
 check(path.join(dir,'receipt.json'),review.capture_receipt.sha256);
 for(const row of receipt.archived_sources)check(path.join(dir,row.path),row.sha256);
 for(const row of receipt.rows)check(path.join(dir,row.screenshot),row.screenshot_sha256);
 for(const row of review.reviewed_screenshots)check(path.join(lab,'ports',row.path),row.sha256);
 if(receipt.rows.length!==review.reviewed_screenshots.length)failures.push(folder+' review screenshot count mismatch');
}
console.log(JSON.stringify({status:failures.length?'fail':'pass',checked_bindings:checked,failures},null,2));
process.exitCode=failures.length?1:0;
