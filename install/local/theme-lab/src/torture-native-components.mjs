import fs from'node:fs/promises';
import crypto from'node:crypto';
import path from'node:path';
import{fileURLToPath}from'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export async function loadTortureNativeRating(){
 const receipt=JSON.parse(await fs.readFile(path.join(root,'fixtures/wikidot-rate-widget.provenance.json'),'utf8'));
 if(receipt.schema!=='theme_lab_frozen_native_component.v1'||receipt.public_writes!==0||receipt.external_requests!==0||receipt.component.selector!=='.page-rate-widget-box')throw new Error('invalid native torture component authority');
 const read=async binding=>{
  const file=path.resolve(root,binding.path);
  if(!file.startsWith(root+path.sep))throw new Error('native torture component escapes evidence tree');
  const bytes=await fs.readFile(file);if(digest(bytes)!==binding.sha256)throw new Error('stale native torture component');return bytes;
 };
 const [source,component]=await Promise.all([read(receipt.source),read(receipt.component)]);
 if(!source.includes(component))throw new Error('torture component is not an exact native fragment');
 return {html:component.toString('utf8'),sha256:receipt.component.sha256,source_sha256:receipt.source.sha256};
}
