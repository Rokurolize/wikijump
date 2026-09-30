import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export async function loadCandidateStructure(directory){
 const file=path.join(directory,'acceptance-structure.json');
 let bytes;try{bytes=await fs.readFile(file)}catch(error){if(error.code==='ENOENT')return null;throw error}
 const spec=JSON.parse(bytes),sha=value=>crypto.createHash('sha256').update(value).digest('hex');
 if(spec.schema!=='theme_lab_source_owned_structure.v1'||spec.authority!=='SOURCE_THEME')throw new Error('Acceptance structure lacks source authority');
 const read=async name=>{if(typeof name!=='string'||path.basename(name)!==name)throw new Error('Structure path escapes package');return fs.readFile(path.join(directory,name),'utf8')};
 const [source,upstream,excerpt,html]=await Promise.all([read(spec.source_file),read(spec.upstream_file),read(spec.excerpt.path),read(spec.html.path)]);
 if(!excerpt.trim()||!source.includes(excerpt)||!upstream.includes(excerpt)||sha(excerpt)!==spec.excerpt.sha256||sha(html)!==spec.html.sha256)throw new Error('Acceptance structure is stale or differs from source theme');
 return{html,sha256:sha(bytes)};
}
