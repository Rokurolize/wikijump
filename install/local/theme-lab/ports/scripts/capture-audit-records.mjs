export function compactAuditRecord(record){
 const diagnostics=record.visual_diagnostics;
 const compactSelectors=record.surface.startsWith('credit.')?['.page-rate-widget-box','.creditButton a','#u-credit-view .modalbox','#u-credit-view .page-rate-widget-box','#u-credit-view .page-rate-widget-box .rate-points','#u-credit-view .page-rate-widget-box .rateup','#u-credit-view .page-rate-widget-box .ratedown','#u-credit-view .page-rate-widget-box .cancel','#u-credit-view .creditRate','#u-credit-view .creditBottomRate','#u-credit-view .creditBottomRate .page-rate-widget-box','#u-credit-view .creditBottomRate .rate-points','#u-credit-view .creditBottomRate .rateup','#u-credit-otherwise .modalbox','#u-credit-otherwise .modalbox .credit.otherwise','#u-credit-otherwise .modalbox .credit-back','#u-credit-otherwise .modalbox .credit-back a[href="#u-credit-view"]']:record.surface.startsWith('page.edit')?['#action-area','textarea.editor-wikitext','#edit-page-comments']:record.surface.startsWith('page.history')?['.page-history','.revision-diff','.revision-diff-controls','.page-source']:record.surface.startsWith('page.source')?['#action-area','#page-options-bottom','#page-options-bottom-2','.page-source','.action-area-close','.mobile-top-bar .open-menu a']:record.surface.startsWith('page.files')?['.file-list-scroll','.file-list','.file-row']:record.surface.startsWith('nav.')?['#top-bar','#top-bar .top-bar','.mobile-top-bar','#side-bar','#side-bar .close-menu','#side-bar .collapsible-block-unfolded']:record.surface.startsWith('shell.')?['#login-status','#footer','#license-area','.scpnet-interwiki-frame']:record.surface==='page.normal'?['#page-content','#action-area','#side-bar','#header','#extra-div-1','#extra-div-2','#page-title','#login-status','.mobile-top-bar','.yui-navset','.yui-navset .yui-nav a','.yui-navset .yui-nav a em','.yui-navset .yui-content']:['#action-area','#page-title','#page-content'];
 const elements=diagnostics?.elements?Object.fromEntries(compactSelectors.filter(selector=>selector in diagnostics.elements).map(selector=>{const value=diagnostics.elements[selector];return[selector,value?{text:value.text,value:value.value?.slice(0,240)??null,children:value.children,rect:value.rect,display:value.display,visibility:value.visibility,position:value.position,z:value.z_index,color:value.color,background:value.background_color,backgroundImage:value.background_image,backgroundPosition:value.background_position,backgroundSize:value.background_size,font:value.font_family,fontSize:value.font_size,fontWeight:value.font_weight,lineHeight:value.line_height,letterSpacing:value.letter_spacing,textShadow:value.text_shadow,textStroke:value.text_stroke,textFill:value.text_fill,filter:value.filter,before:value.before,after:value.after,overflowX:value.overflow_x,scrollWidth:value.scroll_width,clientWidth:value.client_width}:null]})):undefined;
 const history=diagnostics?.historyInstances?{tables:diagnostics.historyInstances.length,rows:diagnostics.historyInstances.reduce((sum,table)=>sum+(table.rows?.length??0),0),rect:diagnostics.historyInstances[0]?.rect??null,layout:diagnostics.historyInstances.flatMap(table=>table.rows.map(row=>({row:row.text,rect:row.rect,cells:row.cells.map(cell=>({name:cell.class_name,text:cell.text,rect:cell.rect,display:cell.display,font_size:cell.font_size,line_height:cell.line_height}))})))}:undefined;
 const sequence=[];const seen=new Set();for(const event of record.action_sequence??[]){const compact={type:event.type,target:event.target};const key=JSON.stringify(compact);if(!seen.has(key)){seen.add(key);sequence.push(compact)}if(sequence.length>=16)break}
 const {asset_dependencies:assetDependencies,visual_diagnostics:_,action_sequence:__,...rest}=record;
 const viewport=diagnostics?.viewport?{width:diagnostics.viewport.width,height:diagnostics.viewport.height,documentWidth:diagnostics.viewport.document_width,scrollX:diagnostics.viewport.scroll_x,scrollY:diagnostics.viewport.scroll_y}:undefined;
 return{...rest,asset_dependency_count:assetDependencies?.length??record.asset_dependency_count??0,visual_diagnostics:diagnostics?{viewport,top_fixed_navigation_inset:diagnostics.topFixedNavigationInset,elements,history,title_overlaps:diagnostics.titleOverlaps??[],header_text:diagnostics.headerText??[],header_children:diagnostics.headerChildren??[]}:null,action_sequence:sequence};
}
function failureCount(count, failures){
 if(failures!=null&&!Array.isArray(failures))return null;
 if(count!=null&&(!Number.isInteger(count)||count<0))return null;
 return failures?Math.max(failures.length,count??0):count??null;
}
export function compactSupersededRecord(record){
 const visualFindings=(record.visual_findings?.length??0)>0?record.visual_findings:undefined;
 const intentionalDifferences=(record.intentional_differences?.length??0)>0?record.intentional_differences:undefined;
 const reviewProvenance=record.visual_review?{
  method:record.visual_review.method??null,
  reviewed_at:record.visual_review.reviewed_at??null,
  reviewer:record.visual_review.reviewer??null,
  screenshot_sha256:record.visual_review.screenshot_sha256??null,
  note:record.visual_review.note??null
 }:record.review_provenance;
 return{
  theme:record.theme,browser_engine:record.browser_engine,browser_version:record.browser_version,viewport:record.viewport,surface:record.surface,state:record.state,
  screenshot:record.screenshot,screenshot_sha256:record.screenshot_sha256,candidate_sha256:record.candidate_sha256,candidate_source_sha256:record.candidate_source_sha256,
  base_css_sha256:record.base_css_sha256,asset_dependency_sha256:record.asset_dependency_sha256,fixture_contract_sha256:record.fixture_contract_sha256,
  run_contract_sha256:record.run_contract_sha256,environment_contract_sha256:record.environment_contract_sha256,
   capture_state_action_contract_sha256:record.capture_state_action_contract_sha256,runtime_surface_contract_sha256:record.runtime_surface_contract_sha256,
   classification:record.classification,reviewed_after_last_change:record.reviewed_after_last_change,
   visual_findings:visualFindings,intentional_differences:intentionalDifferences,review_provenance:reviewProvenance,
   unconfirmed_items:(record.unconfirmed_items?.length??0)>0?record.unconfirmed_items:undefined,
   asset_failure_count:failureCount(record.asset_failure_count,record.asset_failures),
   page_error_count:failureCount(record.page_error_count,record.page_errors),
   external_requests_sent:record.external_requests_sent??null,
   action_responses:record.action_responses,
   superseded_at:record.superseded_at,historical_screenshot_valid:record.historical_screenshot_valid,
   historical_screenshot_status:record.historical_screenshot_status,
   failure:record.failure??record.unconfirmed_items?.find(item=>String(item).startsWith('action/capture failed'))??null
  }
}
