import {applySurfaceState,cleanupSurfaceState} from './theme-surface-contract.mjs';
import {ACCEPTANCE_VIEWPORTS} from './acceptance-viewports.mjs';

export const CANONICAL_INTERACTION_STATES=Object.freeze(['settled','internal-existing-link','internal-missing-link','collapsible-open','tab-second','footnote-open','responsive-shell']);
export const CANONICAL_SEMANTIC_PROBES=Object.freeze(['headings','inline-formatting','existing-internal-link','missing-internal-link','external-link','lists','blockquote','table','code','collapsible','tabview','footnote','bibliography','math','toc','rating-widget-dom','tag-conditional']);

export function validateCanonicalExecutionContract(manifest,states){
  if(JSON.stringify(states.interaction_states)!==JSON.stringify(CANONICAL_INTERACTION_STATES))throw new Error('canonical interaction-state declaration differs from supported executor');
  if(JSON.stringify(manifest.semantic_probes)!==JSON.stringify(CANONICAL_SEMANTIC_PROBES))throw new Error('canonical semantic-probe declaration differs from supported executor');
}

const settle=page=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));

async function stateObservation(page,id){
  if(id==='settled')return page.evaluate(()=>({page_content:!!document.querySelector('#page-content'),scroll_width:document.documentElement.scrollWidth,viewport_width:innerWidth}));
  if(id==='internal-existing-link')return page.evaluate(()=>{const link=[...document.querySelectorAll('.tl-links a')].find(a=>a.textContent?.includes('Existing internal page'));return{present:!!link,newpage:link?.classList.contains('newpage')??null,href:link?.getAttribute('href')??null}});
  if(id==='internal-missing-link')return page.evaluate(()=>{const link=[...document.querySelectorAll('.tl-links a')].find(a=>a.textContent?.includes('Missing internal page'));return{present:!!link,newpage:link?.classList.contains('newpage')??null,href:link?.getAttribute('href')??null}});
  if(id==='collapsible-open'){
    await applySurfaceState(page,'content.collapsible','expanded');
    try{return await page.evaluate(()=>{const e=document.querySelector('.tl-collapsible .collapsible-block-unfolded');return{present:!!e,visible:!!e&&getComputedStyle(e).display!=='none'}})}finally{await cleanupSurfaceState(page,'content.collapsible','expanded')}
  }
  if(id==='tab-second'){
    await applySurfaceState(page,'content.tabview','second-tab-selected');
    try{return await page.evaluate(()=>{const tabs=[...document.querySelectorAll('.tl-tabview .yui-nav li')];const body=document.querySelector('.tl-tabview .yui-content > div:nth-child(2)');return{tab_count:tabs.length,second_selected:tabs[1]?.classList.contains('selected')??false,second_body_visible:!!body&&getComputedStyle(body).display!=='none'}})}finally{await cleanupSurfaceState(page,'content.tabview','second-tab-selected')}
  }
  if(id==='footnote-open'){
    const link=page.locator('.tl-footnote a.footnoteref').first();await link.click();await settle(page);
    return page.evaluate(()=>({reference_present:!!document.querySelector('.tl-footnote a.footnoteref'),footer_present:!!document.querySelector('.footnotes-footer'),footnote_present:!!document.querySelector('.footnotes-footer .footnote-footer')}));
  }
  if(id==='responsive-shell'){
    const original=page.viewportSize();await page.setViewportSize({width:390,height:844});await settle(page);
    try{return await page.evaluate(()=>({mobile_top_present:!!document.querySelector('.mobile-top-bar'),sidebar_present:!!document.querySelector('#side-bar'),document_width:document.documentElement.scrollWidth,viewport_width:innerWidth}))}finally{if(original)await page.setViewportSize(original);await settle(page)}
  }
  throw new Error(`unsupported canonical interaction state: ${id}`);
}

function attributeViewportOverflow(o,viewportStatus,widthKey){
  const viewport=ACCEPTANCE_VIEWPORTS.find(row=>row.width===o?.viewport_width);
  const baseline=viewport&&viewportStatus?.[viewport.id];
  if(!viewport||!Number.isFinite(baseline?.baseline_document_overflow_px))return{...o,overflow_attribution:'unavailable',overflow_delta_px:null};
  const candidateOverflow=Math.max(0,o[widthKey]-o.viewport_width);
  const baselineOverflow=Math.max(0,baseline.baseline_document_overflow_px);
  return{...o,candidate_document_overflow_px:candidateOverflow,baseline_document_overflow_px:baselineOverflow,overflow_delta_px:candidateOverflow-baselineOverflow,overflow_attribution:'same-target-baseline'};
}

function statePassed(id,o){
  if(id==='settled')return o.page_content&&Number.isFinite(o.overflow_delta_px)&&o.overflow_delta_px<=2;
  if(id==='internal-existing-link')return o.present&&o.newpage===false;
  if(id==='internal-missing-link')return o.present&&o.newpage===true;
  if(id==='collapsible-open')return o.present&&o.visible;
  if(id==='tab-second')return o.tab_count>=2&&o.second_selected&&o.second_body_visible;
  if(id==='footnote-open')return o.reference_present&&o.footer_present&&o.footnote_present;
  if(id==='responsive-shell')return o.mobile_top_present&&o.sidebar_present&&Number.isFinite(o.overflow_delta_px)&&o.overflow_delta_px<=2;
  return false;
}

export async function runCanonicalInteractionStates(page,ids=CANONICAL_INTERACTION_STATES,{baselineViewportStatus=null}={}){
  if(JSON.stringify(ids)!==JSON.stringify(CANONICAL_INTERACTION_STATES))throw new Error('canonical interaction states must execute as the exact closed set');
  const results=[];for(const id of ids){try{let observation=await stateObservation(page,id);if(id==='settled'||id==='responsive-shell')observation=attributeViewportOverflow(observation,baselineViewportStatus,id==='settled'?'scroll_width':'document_width');results.push({id,status:statePassed(id,observation)?'pass':'fail',observation})}catch(error){results.push({id,status:'fail',error:String(error?.message??error)})}}
  return results;
}

export async function runCanonicalSemanticProbes(page,ids=CANONICAL_SEMANTIC_PROBES){
  if(JSON.stringify(ids)!==JSON.stringify(CANONICAL_SEMANTIC_PROBES))throw new Error('canonical semantic probes must execute as the exact closed set');
  return page.evaluate(probeIds=>{
    const count=selector=>document.querySelectorAll(selector).length;
    const checks={
      'headings':()=>count('.tl-heading h1')>=1&&count('.tl-heading h2')>=1,
      'inline-formatting':()=>['.tl-heading strong','.tl-heading em','.tl-heading span[style*="underline"]','.tl-heading span[style*="line-through"]','.tl-heading tt'].every(s=>count(s)>=1),
      'existing-internal-link':()=>[...document.querySelectorAll('.tl-links a')].some(a=>!a.classList.contains('newpage')&&a.textContent?.includes('Existing internal page')),
      'missing-internal-link':()=>[...document.querySelectorAll('.tl-links a.newpage')].some(a=>a.textContent?.includes('Missing internal page')),
      'external-link':()=>count('.tl-heading a[href^="https://"]')>=1,
      'lists':()=>count('.tl-list ul li')>=3&&count('.tl-list ol li')>=2,
      'blockquote':()=>count('.tl-quote blockquote')>=1,
      'table':()=>count('.tl-table table.wiki-content-table th')>=3&&count('.tl-table table.wiki-content-table td')>=6,
      'code':()=>count('.tl-code .code pre code')>=1,
      'collapsible':()=>count('.tl-collapsible .collapsible-block')>=1,
      'tabview':()=>count('.tl-tabview .yui-navset .yui-nav li')>=2,
      'footnote':()=>count('.tl-footnote a.footnoteref')>=1&&count('.footnotes-footer .footnote-footer')>=1,
      'bibliography':()=>count('.tl-bibliography-reference .bibcite')>=1&&count('.bibitems .bibitem')>=1,
      'math':()=>count('.tl-math .math-equation')>=1,
      'toc':()=>count('.tl-toc #toc #toc-list a')>=2,
      'rating-widget-dom':()=>['.tl-rate .page-rate-widget-box','.tl-rate .rate-points','.tl-rate .rateup','.tl-rate .ratedown','.tl-rate .cancel'].every(s=>count(s)>=1),
      'tag-conditional':()=>document.querySelector('.tl-tag-positive')?.textContent?.includes('THEME_TAG_ACTIVE')===true&&!document.querySelector('.tl-tag-negative')?.textContent?.includes('THEME_TAG_INACTIVE'),
    };
    return probeIds.map(id=>{const predicate=checks[id];if(!predicate)return{id,status:'fail',error:'unsupported probe'};try{return{id,status:predicate()?'pass':'fail'}}catch(error){return{id,status:'fail',error:String(error?.message??error)}}});
  },ids);
}
