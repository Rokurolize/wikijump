import fs from 'node:fs';
import crypto from 'node:crypto';
export const NAVIGATION_OVERLAY_SOURCE = {
  path:'ports/authority-evidence/source-navigation-overlays-20261001/receipt.json',
  sha256:'4ed86008d4c7d385f9be29edeb6057aefc332c2018bd471858b4d2163f68e112'
};
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const root=new URL('../',import.meta.url);
const text=value=>String(value??'').replace(/\s+/gu,' ').trim();
const finite=rect=>rect&&['x','y','width','height'].every(k=>Number.isFinite(rect[k]))&&rect.width>0&&rect.height>0;
const contained=(inner,outer)=>finite(inner)&&finite(outer)&&inner.x>=outer.x-1&&inner.y>=outer.y-1&&inner.x+inner.width<=outer.x+outer.width+1&&inner.y+inner.height<=outer.y+outer.height+1;
const sameRect=(a,b)=>finite(a)&&finite(b)&&['x','y','width','height'].every(key=>Math.abs(a[key]-b[key])<=1);
let authority;
function readAuthority(){
 if(authority!==undefined)return authority;
 try{
  const bytes=fs.readFileSync(new URL(NAVIGATION_OVERLAY_SOURCE.path,root));
  if(sha(bytes)!==NAVIGATION_OVERLAY_SOURCE.sha256)throw new Error('source receipt drift');
  const proof=JSON.parse(bytes);
  if(proof.schema!=='theme_lab_source_shell_overlap_probe.v1'||proof.url!=='https://scp-jp.wikidot.com/scp-173-jp'||proof.public_writes!==0||proof.external_requests_sent!==0||!proof.snapshot?.replay_complete)throw new Error('unknown source authority');
  const normal=proof.rows.filter(r=>!r.action),open=proof.rows.filter(r=>r.action);
  if(normal.length<2||open.filter(r=>r.text.intersections.length).length<2||proof.rows.some(r=>r.error||!r.text.complete||r.external_requests_sent!==0)||normal.some(r=>r.text.intersections.length))throw new Error('source overlay evidence incomplete');
  const labels={};
  for(const binding of proof.fixture_bindings){
   const html=fs.readFileSync(new URL(binding.path,root));if(sha(html)!==binding.sha256)throw new Error('canonical navigation fixture drift');
   const key=binding.path.includes('sidebar')?'sidebar':'top';
   labels[key]=new Set([...html.toString().matchAll(/<(a|p)\b[^>]*>([^<]+)<\/\1>/giu)].map(match=>text(match[2].replace(/&amp;/gu,'&'))));
  }
  if(!labels.top?.size||!labels.sidebar?.size)throw new Error('canonical navigation labels absent');
  return authority=labels;
 }catch{return authority=null;}
}

// A known label alone does not prove that it belongs to navigation. Bind each
// intersecting leaf to the retained submenu ancestry or rendered drawer bounds.
// Unknown text, account/header controls and unmeasured provenance stay visual.
export function navigationOverlayProvenance(row,labels=readAuthority()){
 if(!labels)return false;
 const intersections=row.title_text_measurement?.intersections;
 if(!intersections?.length)return false;
 if(row.surface==='nav.sidebar'){
  const side=row.visual_diagnostics?.elements?.['#side-bar'];
  return side&&['fixed','absolute'].includes(side.position)&&intersections.every(item=>
   labels.sidebar.has(text(item.text))&&contained(item.rect,side.rect)&&
   side.children?.some(child=>child.tag==='DIV'&&/(?:^|\s)side-block(?:\s|$)/u.test(child.class??'')&&contained(item.rect,child.rect)));
 }
 const width=row.viewport_size?.width;
 return Number.isFinite(width)&&intersections.every(item=>{
  if(item.tag!=='A'||!labels.top.has(text(item.text)))return false;
  const retained=row.visual_diagnostics?.title_overlaps?.find(leaf=>leaf.tag===item.tag&&text(leaf.text)===text(item.text)&&sameRect(leaf.rect,item.rect));
  const ancestors=retained?.ancestors;
  return ancestors?.[0]?.tag==='LI'&&ancestors[1]?.tag==='UL'&&ancestors[2]?.tag==='LI'&&
   ['fixed','absolute'].includes(ancestors[1].position)&&contained(item.rect,ancestors[1].rect)&&
   ancestors[1].rect.x>=-1&&ancestors[1].rect.x+ancestors[1].rect.width<=width+1;
 });
}
