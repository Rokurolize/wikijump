import fs from 'node:fs';
import crypto from 'node:crypto';
import {requireDeepwellRuntimeIdentity} from './deepwell-runtime-identity.mjs';
import {titleCompositionFact} from './semantic-browser-acceptance.mjs';

const policyPath=new URL('../ports/current-acceptance/visual-gate-policy.json',import.meta.url);
export const VISUAL_GATE_POLICY=JSON.parse(fs.readFileSync(policyPath,'utf8'));
export const VISUAL_GATE_POLICY_SHA256=crypto.createHash('sha256').update(fs.readFileSync(policyPath)).digest('hex');
if(VISUAL_GATE_POLICY.schema!=='theme_lab_visual_gate_policy.v2'||VISUAL_GATE_POLICY.risk_promotion?.c_runtime_identity_scope!=='every-row')throw new Error('visual gate policy must define per-row C runtime identity promotion');
const rowKey=row=>`${row.browser_engine}|${row.viewport}|${row.surface}.${row.state}`;
const rows=new Map(VISUAL_GATE_POLICY.rows.map(row=>[rowKey(row),row]));
const HASH=/^[a-f0-9]{64}$/u;
// Surface/authority-scoped identities: any change can intersect the observed
// surface, so the row itself is promoted to direct review.
const C_RISK_IDENTITIES=[
 {current:'candidate_sha256',previous:'previous_candidate_sha256',name:'candidate-css'},
 {current:'candidate_source_sha256',previous:'previous_candidate_source_sha256',name:'candidate-source'},
 {current:'candidate_structure_sha256',previous:'previous_candidate_structure_sha256',name:'candidate-structure',optional:true},
 {current:'asset_dependency_sha256',previous:'previous_asset_dependency_sha256',name:'asset-dependency'},
 {current:'fixture_contract_sha256',previous:'previous_fixture_contract_sha256',name:'fixture-contract'},
 {current:'capture_state_action_contract_sha256',previous:'previous_action_contract_sha256',name:'action-contract'},
 {current:'scoped_authority_contract_sha256',previous:'previous_scoped_authority_contract_sha256',name:'scoped-authority-contract'},
 {current:'runtime_surface_contract_sha256',previous:'previous_runtime_surface_contract_sha256',name:'runtime-surface-contract'},
];
// Whole-runtime identities (served Framerail tree, Deepwell build). Every row
// must still match the run contract exactly; a missing or changed prior value
// is global runtime drift. Drift promotes the runtime-drift representative
// rows (below) instead of every C row: surface-specific runtime risk remains
// covered by runtime-surface-contract and the measured state assertions.
const C_GLOBAL_RUNTIME_IDENTITIES=[
 {current:'runtime_source_sha256',previous:'previous_runtime_source_sha256',name:'runtime-source'},
 {current:'backend_runtime_identity_sha256',previous:'previous_backend_runtime_identity_sha256',name:'backend-runtime'},
];
// Contract fields that bind evidence identity but cannot affect what a single
// theme/viewport capture paints: the whole-runtime identities (compared through
// their own global-drift identities) and the publication freeze digest over all
// themes (each theme's own candidate entry and inventory row stay in the hash).
export const RUNTIME_SCOPED_CONTRACT_BINDINGS=Object.freeze(['expected_runtime_source_sha256','expected_backend_runtime_identity','candidate_set_sha256']);
// A legacy prior row predates scoped_authority_contract_sha256. Its scoped run
// contract hash is comparable when that contract equals the current one except
// for lacking some non-paint bindings (each was added at a different time); a
// differing value of any field still fails the comparison.
export function legacyComparableScopedShas(contract,row,scopedSha){
 const out=new Set();const keys=RUNTIME_SCOPED_CONTRACT_BINDINGS;
 for(let mask=0;mask<(1<<keys.length);mask++){
  const copy={...contract};keys.forEach((key,i)=>{if(mask&(1<<i))delete copy[key]});
  out.add(scopedSha(copy,row));
 }
 return [...out];
}
export function runContractWithoutRuntimeBindings(contract){
 const copy={...contract};
 for(const key of RUNTIME_SCOPED_CONTRACT_BINDINGS)delete copy[key];
 return copy;
}

export function visualGateIdentityRiskSnapshot(previous,{currentScopedAuthoritySha=null,legacyComparableScopedShas=[]}={}){
 // A legacy prior predates scoped_authority_contract_sha256. Its scoped run
 // contract hash is comparable only when that contract carried no runtime
 // bindings, i.e. it equals the current binding-free scoped hash exactly.
 const legacyAuthority=previous&&previous.scoped_authority_contract_sha256==null&&
  HASH.test(previous.scoped_run_contract_sha256??'')&&HASH.test(currentScopedAuthoritySha??'')&&(previous.scoped_run_contract_sha256===currentScopedAuthoritySha||legacyComparableScopedShas.includes(previous.scoped_run_contract_sha256))?currentScopedAuthoritySha:null;
 return Object.fromEntries([
  ...C_RISK_IDENTITIES.map(identity=>[identity.previous,identity.current==='scoped_authority_contract_sha256'?(previous?.scoped_authority_contract_sha256??legacyAuthority):previous?.[identity.current]??null]),
  ...C_GLOBAL_RUNTIME_IDENTITIES.map(identity=>[identity.previous,previous?.[identity.current]??null]),
  ['previous_scoped_run_contract_sha256',previous?.scoped_run_contract_sha256??null],
  ['previous_browser_version',previous?.browser_version??null],
 ]);
}

function identityTriggers(identities,previousSnapshot,current){
 const triggers=[];
 for(const identity of identities){
  const before=previousSnapshot?.[identity.previous]??null,after=current?.[identity.current]??null;
  if(identity.optional&&before===null&&after===null)continue;
  if(!HASH.test(before??'')||!HASH.test(after??''))triggers.push(`${identity.name}-identity-missing`);
  else if(before!==after)triggers.push(`${identity.name}-identity-changed`);
 }
 return triggers;
}

export function visualGateGlobalRuntimeDrift(previousSnapshot,current,{hasPriorCapture=true}={}){
 return hasPriorCapture?identityTriggers(C_GLOBAL_RUNTIME_IDENTITIES,previousSnapshot,current):[];
}

export function visualGateIdentityRiskTriggers(previousSnapshot,current,{hasPriorCapture=true}={}){
 if(!hasPriorCapture)return ['no-comparable-prior-capture'];
 const triggers=identityTriggers(C_RISK_IDENTITIES,previousSnapshot,current);
 const previousBrowser=previousSnapshot?.previous_browser_version;
 if(typeof previousBrowser!=='string'||!previousBrowser.trim()||typeof current?.browser_version!=='string'||!current.browser_version.trim())triggers.push('browser-engine-identity-missing');
 else if(previousBrowser!==current.browser_version)triggers.push('browser-engine-version-changed');
 const drift=visualGateGlobalRuntimeDrift(previousSnapshot,current,{hasPriorCapture});
 // Runtime identities are measured acceptance authorities. A changed or
 // missing Framerail/Deepwell identity makes this particular C-row's prior
 // incomparable, so promote every affected row instead of a representative
 // sample. The older representative-only rule let machine-only rows pass after
 // captures from an unidentified runtime.
 triggers.push(...drift);
 return triggers;
}

export function visualGatePolicyRow(record){
 return rows.get(`${record.browser_engine}|${record.viewport}|${record.surface}.${record.state}`)??null;
}

export function sigma10CreditDisclosureSelector(record,key){
 if(record?.baseline_theme!=='Sigma-10')return null;
 if(key==='credit.view.open')return '.creditRate > .rateBox.unfolded';
 if(key==='credit.otherwise.open')return '.creditRateOtherwise > li.unfolded';
 return null;
}

export const visualGateSelectorsFor=(row,record=null)=>{
 const key=row.surface+'.'+row.state;
 if(key.startsWith('shell.search.'))return row.state==='typed-focused'?['#search-top-box-input','#search-top-box-form input[type="submit"]']:['#search-top-box-form input[type="submit"]'];
 if(key==='credit.default.normal'||key.startsWith('credit.variant.')&&row.state==='default')return ['.creditRate','.creditButton','.page-rate-widget-box'];
 if(key.startsWith('credit.')){
  const nativeDisclosure=sigma10CreditDisclosureSelector(record,row.key);
  if(nativeDisclosure&&row.key==='credit.otherwise.open')return [nativeDisclosure,'#u-credit-otherwise .modalbox','#u-credit-otherwise .modalbox .credit.otherwise'];
  if(nativeDisclosure)return [nativeDisclosure,'#u-credit-view .modalbox','#u-credit-view .page-rate-widget-box'];
  return row.surface==='credit.otherwise'?['#u-credit-otherwise .modalbox','#u-credit-otherwise .modalbox .credit.otherwise']:['#u-credit-view .modalbox','#u-credit-view .page-rate-widget-box'];
 }
 if(key==='dialog.generic.edit-permission-error')return ['#odialog-container .owindow.error','#odialog-container .owindow.error .content'];
 if(key==='nav.sidebar.open-submenu')return ['#side-bar','#side-bar .collapsible-block-unfolded'];
 if(key==='nav.sidebar.open')return ['#side-bar'];
 if(key==='nav.mobile-top.submenu-expanded')return ['.mobile-top-bar','.mobile-top-bar ul'];
 if(key==='nav.desktop-top.keyboard-focus')return ['#top-bar a'];
 if(key==='shell.login.account-hover')return ['#login-status','#account-options','#account-topbutton'];
 if(key==='shell.footer-license.scrolled-bottom')return ['#footer','#license-area'];
 if(key.startsWith('page.history'))return key.endsWith('diff')?['.revision-diff']:['.page-history'];
 if(key==='page.source.open')return ['.page-source','#action-area'];
 if(key==='page.files.horizontal-actions')return ['.file-list-scroll','.file-list'];
 if(key==='page.files.list')return ['.file-list'];
 if(key.startsWith('page.options.'))return ['#page-options-bottom','#page-options-bottom-2'];
 if(key.startsWith('page.tags.'))return ['#action-area','#action-area input[type="text"]'];
 if(key==='page.edit.editor')return ['#action-area','textarea.editor-wikitext','textarea[name="wikitext"]'];
 if(key==='page.delete.confirm-pane')return ['#page-delete','#page-delete .buttons','#page-delete .page-delete-actions'];
 if(key==='page.rename.confirm-pane')return ['#page-move','#page-move .buttons','#page-move .page-move-actions'];
 if(key==='content.collapsible.expanded')return ['#page-content .collapsible-block-unfolded'];
 if(key==='content.tabview.second-tab-selected')return ['.yui-navset .selected','.yui-navset .yui-content'];
 if(key.startsWith('content.link.'))return ['a[href="#fixture-link"]'];
 if(key==='content.rating.focused')return ['.page-rate-widget-box a'];
 return ['#action-area','#page-content'];
};

export function buildVisualGateAssertion(record){
 const policy=visualGatePolicyRow(record);
 if(!policy||policy.class!=='C')return null;
 const elements=record.visual_diagnostics?.elements??{};
 const candidates=visualGateSelectorsFor(policy,record);
 const measured=candidates.map(selector=>({selector,observation:elements[selector]??null}));
 const focused=(record.action_sequence??[]).some(event=>event.type==='focusin');
 const hovered=(record.action_sequence??[]).some(event=>['pointerover','mouseover'].includes(event.type));
 const hash=record.action_contract_observation?.location_hash??record.action_contract_observation?.hash??null;
 const validTargets=measured.filter(item=>item.observation&&item.observation.visibility==='visible'&&item.observation.display!=='none'&&item.observation.rect?.width>0&&item.observation.rect?.height>0);
 const viewport=record.visual_diagnostics?.viewport;
 const viewportWidth=viewport?.client_width??viewport?.width;
 const geometryWithinViewport=validTargets.some(({observation})=>{
  const rect=observation?.rect;
  const viewportHeight=viewport?.client_height??viewport?.height;
  return !!rect&&Number.isFinite(viewportWidth)&&Number.isFinite(viewportHeight)&&rect.x>=-1&&rect.x+rect.width<=viewportWidth+1&&rect.y>=-1&&rect.y+rect.height<=viewportHeight+1;
 });
 return {schema:'theme_lab_state_machine_assertion.v1',policy_sha256:VISUAL_GATE_POLICY_SHA256,key:policy.key,profile:policy.assertion_profile,target_selectors:candidates,measured,visible_target_count:validTargets.length,focused,hovered,selected:false,location_hash:hash,viewport,candidate_sha256:record.candidate_sha256,candidate_source_sha256:record.candidate_source_sha256,candidate_structure_sha256:record.candidate_structure_sha256??null,asset_dependency_sha256:record.asset_dependency_sha256,fixture_contract_sha256:record.fixture_contract_sha256,runtime_source_sha256:record.runtime_source_sha256,backend_runtime_identity_sha256:record.backend_runtime_identity_sha256,runtime_surface_contract_sha256:record.runtime_surface_contract_sha256,run_contract_sha256:record.run_contract_sha256,scoped_run_contract_sha256:record.scoped_run_contract_sha256,environment_contract_sha256:record.environment_contract_sha256,action_contract_sha256:record.capture_state_action_contract_sha256,browser_engine:record.browser_engine,browser_version:record.browser_version,viewport_id:record.viewport,geometry_within_viewport:geometryWithinViewport,title_overlap_count:(record.visual_diagnostics?.title_overlaps??[]).filter(item=>item.effectively_visible!==false).length,horizontal_overflow_count:(record.visual_diagnostics?.horizontalOverflow??[]).length,diagnostics_contract_sha256:record.visual_diagnostics_contract_sha256??null};
}

export async function collectVisualGateInteraction(page,record){
 const policy=visualGatePolicyRow(record);if(!policy||policy.class!=='C')return null;
 const selectors=visualGateSelectorsFor(policy,record);
 const nativeDisclosure=sigma10CreditDisclosureSelector(record,policy.key);
 return page.evaluate(({selectors,nativeDisclosure})=>{
  const visible=e=>{if(!e)return false;const s=getComputedStyle(e),r=e.getBoundingClientRect();return s.display!=='none'&&s.visibility==='visible'&&Number(s.opacity)>0&&r.width>0&&r.height>0};
  const focused=selectors.some(selector=>[...document.querySelectorAll(selector)].some(e=>e===document.activeElement||e.contains(document.activeElement)));
  const hovered=selectors.some(selector=>[...document.querySelectorAll(selector)].some(e=>e.matches(':hover')));
  const selected=selectors.some(selector=>[...document.querySelectorAll(selector)].some(e=>e.matches('.selected,[aria-selected="true"],[aria-expanded="true"]')));
  const targetRects=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(visible).map(e=>{const r=e.getBoundingClientRect();return{selector,x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}}));
  const viewport={width:innerWidth,height:innerHeight};
  const geometryWithinViewport=targetRects.some(r=>r.x>=-1&&r.right<=viewport.width+1&&r.y>=-1&&r.bottom<=viewport.height+1);
  const scrollHeight=Math.max(document.documentElement.scrollHeight,document.body?.scrollHeight??0);
  const pageScroll={scroll_top:scrollY,scroll_height:scrollHeight,client_height:innerHeight,at_bottom:scrollY+innerHeight>=scrollHeight-2};
  const documentWidth=document.documentElement.clientWidth;
  const documentContained=targetRects.length>0&&targetRects.every(r=>r.x>=-1&&r.right<=documentWidth+1&&r.y+scrollY>=-1&&r.bottom+scrollY<=scrollHeight+1);
  const horizontalScrollerTargets=selectors.flatMap(selector=>[...document.querySelectorAll(selector)].filter(visible).map(e=>({selector,element:e,container:e.closest('.file-list-scroll,.file-list-wrapper')}))).filter(item=>item.container).map(({selector,element,container})=>{const r=element.getBoundingClientRect(),c=container.getBoundingClientRect();return{selector,container_selector:container.classList.contains('file-list-scroll')?'.file-list-scroll':'.file-list-wrapper',x:r.x,y:r.y,width:r.width,height:r.height,container_x:c.x,container_y:c.y,container_width:c.width,container_height:c.height,container_scroll_width:container.scrollWidth,container_client_width:container.clientWidth,contained: r.y>=c.y-1&&r.bottom<=c.bottom+1&&r.x>=c.x-1&&r.x<=c.right+1}});
  const nativeDisclosureOpen=nativeDisclosure?[...document.querySelectorAll(nativeDisclosure)].some(element=>element.classList.contains('unfolded')):null;
  return {visible_target_count:targetRects.length,target_rects:targetRects,geometry_within_viewport:geometryWithinViewport,document_contained:documentContained,horizontal_scroller_targets:horizontalScrollerTargets,focused,hovered,selected,location_hash:location.hash,native_disclosure_selector:nativeDisclosure,native_disclosure_open:nativeDisclosureOpen,active_element:document.activeElement?.id?`#${document.activeElement.id}`:document.activeElement?.tagName?.toLowerCase()??null,scroll_metrics:selectors.flatMap(selector=>[...document.querySelectorAll(selector)].map(e=>({selector,scroll_top:e.scrollTop,scroll_height:e.scrollHeight,client_height:e.clientHeight}))).filter(item=>item.scroll_height>item.client_height),page_scroll:pageScroll};
 },{selectors,nativeDisclosure});
}

// Composition questions are answered from the exact image of every member
// observation, so a visible title-text intersection always retains one.
export function visualGateTitleCompositionNeedsImage(record){return titleCompositionFact(record)==='visual'}

export function validateVisualGateRecord(record,{requirePolicyBinding=true,requireVisualReview=true}={}){
 const failures=[];const policy=visualGatePolicyRow(record);
 if(!policy){if(record.action_contract_observation?.mode==='source-navigation-replaces-sidebar')return failures;failures.push(`unclassified browser state ${record.theme}/${record.browser_engine}/${record.viewport}/${record.surface}.${record.state}`);return failures;}
 try{
  const backend=requireDeepwellRuntimeIdentity(record.backend_runtime_identity,`browser record ${record.theme}/${record.surface}.${record.state}`);
  if(backend.identity_sha256!==record.backend_runtime_identity_sha256)failures.push(`missing or inconsistent measured Deepwell backend identity ${record.theme}/${record.surface}.${record.state}`);
 }catch{failures.push(`missing or invalid measured Deepwell backend identity ${record.theme}/${record.surface}.${record.state}`)}
 const gate=record.visual_gate;
 // Only conditional-review (C) rows can be risk-promoted. Machine-only (M)
 // rows stay screenshot-free on success; a title measurement is not an
 // invitation to silently change their policy class.
 const promoted=policy.class==='C'&&(gate?.risk_triggers?.length??0)>0;
 if(requirePolicyBinding&&(gate?.policy_sha256!==VISUAL_GATE_POLICY_SHA256||gate?.class!==policy.class))failures.push(`stale or missing visual gate binding ${record.theme}/${record.surface}.${record.state}`);
 if(policy.class==='C'){
  const assertion=record.state_machine_assertion;
  const risk=gate?.risk_assessment;
  if(!risk||risk.scope!=='same-theme-surface-state-engine-viewport')failures.push(`missing scoped visual-risk assessment ${record.theme}/${record.surface}.${record.state}`);
  else{
   if(risk.identity_comparison_schema!=='theme_lab_visual_risk_identity.v3'||typeof risk.previous_capture_found!=='boolean')failures.push(`missing deterministic prior-identity comparison ${record.theme}/${record.surface}.${record.state}`);
   else{
    const expectedRuntimeDrift=visualGateGlobalRuntimeDrift(risk,record,{hasPriorCapture:risk.previous_capture_found});
    if(JSON.stringify(risk.global_runtime_drift??[])!==JSON.stringify(expectedRuntimeDrift))failures.push(`measured global runtime identity comparison is stale ${record.theme}/${record.surface}.${record.state}`);
    for(const trigger of visualGateIdentityRiskTriggers(risk,risk.previous_capture_found?record:null,{hasPriorCapture:risk.previous_capture_found}))if(!gate.risk_triggers?.includes(trigger))failures.push(`prior/current identity risk was not promoted to direct review (${trigger}) ${record.theme}/${record.surface}.${record.state}`);
   }
  }
  if(!assertion||assertion.schema!=='theme_lab_state_machine_assertion.v1'||assertion.policy_sha256!==VISUAL_GATE_POLICY_SHA256||assertion.key!==policy.key||assertion.diagnostics_contract_sha256!==record.visual_diagnostics_contract_sha256)failures.push(`missing current state-specific machine assertion ${record.theme}/${record.surface}.${record.state}`);
  else if(assertion.candidate_sha256!==record.candidate_sha256||assertion.candidate_source_sha256!==record.candidate_source_sha256||(assertion.candidate_structure_sha256??null)!==(record.candidate_structure_sha256??null)||assertion.asset_dependency_sha256!==record.asset_dependency_sha256||assertion.fixture_contract_sha256!==record.fixture_contract_sha256||assertion.runtime_source_sha256!==record.runtime_source_sha256||assertion.backend_runtime_identity_sha256!==record.backend_runtime_identity_sha256||assertion.runtime_surface_contract_sha256!==record.runtime_surface_contract_sha256||assertion.run_contract_sha256!==record.run_contract_sha256||assertion.scoped_run_contract_sha256!==record.scoped_run_contract_sha256||assertion.environment_contract_sha256!==record.environment_contract_sha256||assertion.action_contract_sha256!==record.capture_state_action_contract_sha256||assertion.browser_engine!==record.browser_engine||assertion.browser_version!==record.browser_version||assertion.viewport_id!==record.viewport)failures.push(`state-specific machine assertion is bound to stale candidate/runtime evidence ${record.theme}/${record.surface}.${record.state}`);
  else if(assertion.visible_target_count<1)failures.push(`state-specific target is not visibly measurable ${record.theme}/${record.surface}.${record.state}`);
  if(assertion&&/focus/u.test(policy.key)&&!assertion.focused)failures.push(`focused control state was not asserted ${record.theme}/${record.surface}.${record.state}`);
  if(assertion&&/hovered/u.test(policy.key)&&!assertion.hovered)failures.push(`hovered control state was not asserted ${record.theme}/${record.surface}.${record.state}`);
  if(assertion&&policy.key==='content.tabview.second-tab-selected'&&!assertion.selected)failures.push(`selected tab state was not asserted ${record.theme}/${record.surface}.${record.state}`);
  const nativeCreditDisclosure=sigma10CreditDisclosureSelector(record,policy.key);
  if(assertion&&nativeCreditDisclosure){
   const modalSelector=policy.key==='credit.view.open'?'#u-credit-view .modalbox':'#u-credit-otherwise .modalbox';
   const visiblyMeasured=selector=>assertion.measured?.some(item=>item.selector===selector&&item.observation?.visibility==='visible'&&item.observation?.display!=='none'&&item.observation?.rect?.width>0&&item.observation?.rect?.height>0);
   if(assertion.native_disclosure_selector!==nativeCreditDisclosure||assertion.native_disclosure_open!==true||!assertion.target_selectors?.includes(nativeCreditDisclosure)||!visiblyMeasured(modalSelector))failures.push(`native Sigma-10 credit disclosure state was not asserted ${record.theme}/${record.surface}.${record.state}`);
   if(assertion.location_hash!=='')failures.push(`native Sigma-10 credit disclosure unexpectedly used a fragment target ${record.theme}/${record.surface}.${record.state}`);
  }else{
   if(assertion&&policy.key==='credit.view.open'&&assertion.location_hash!=='#u-credit-view')failures.push(`credit view target was not asserted ${record.theme}/${record.surface}.${record.state}`);
   if(assertion&&policy.key==='credit.otherwise.open'&&assertion.location_hash!=='#u-credit-otherwise')failures.push(`otherwise credit target was not asserted ${record.theme}/${record.surface}.${record.state}`);
  }
  const allowedHorizontalScroll=policy.key==='page.files.horizontal-actions'||policy.key==='page.files.list'&&assertion?.horizontal_scroller_targets?.some(item=>item.contained);
  const documentScrollableTarget=policy.key==='shell.footer-license.scrolled-bottom'||policy.key==='credit.default.normal'||policy.key==='page.history.list'||policy.key==='page.files.list';
  const assertionViewport=assertion?.viewport??{};
  const documentWidth=assertionViewport.document_width??assertionViewport.client_width??assertionViewport.width;
  const scrollTop=assertion?.page_scroll?.scroll_top??assertionViewport.scroll_y??0;
  const documentRects=assertion?.target_rects??(assertion?.measured??[]).flatMap(item=>{const r=item.observation?.rect;return r&&r.width>0&&r.height>0?[{x:r.x,right:r.x+r.width,y:r.y,bottom:r.y+r.height}]:[]});
  const measuredDocumentContainment=assertion?.document_contained??(documentRects.length>0&&Number.isFinite(documentWidth)&&documentRects.every(rect=>rect.x>=-1&&rect.right<=documentWidth+1&&rect.y+scrollTop>=-1));
  const boundsRiskPromoted=gate?.risk_triggers?.includes('state-target-outside-allowed-bounds');
  if(assertion&&assertion.visible_target_count>0&&documentScrollableTarget&&!measuredDocumentContainment&&!allowedHorizontalScroll&&!boundsRiskPromoted)failures.push(`state target is outside the document or allowed scroll container ${record.theme}/${record.surface}.${record.state}`);
  if(assertion&&assertion.visible_target_count>0&&!documentScrollableTarget&&!assertion.geometry_within_viewport&&!allowedHorizontalScroll&&!boundsRiskPromoted)failures.push(`state target is outside the viewport bounds ${record.theme}/${record.surface}.${record.state}`);
  if(assertion&&assertion.title_overlap_count>0&&!promoted)failures.push(`measured title overlap was not promoted to direct review ${record.theme}/${record.surface}.${record.state}`);
  const baselineContainment=record.baseline_document_containment_measurement;
  const width=assertion?.viewport?.document_width??assertion?.viewport?.documentWidth;
  const viewportWidth=assertion?.viewport?.client_width??assertion?.viewport?.width;
  if(Number.isFinite(width)&&Number.isFinite(viewportWidth)&&width>viewportWidth+1&&(!Number.isFinite(baselineContainment?.document_width)||width>baselineContainment.document_width+1)&&!gate?.risk_triggers?.includes('unexpected-document-overflow'))failures.push(`unexpected document overflow was not promoted to direct review ${record.theme}/${record.surface}.${record.state}`);
 }
 if(policy.class==='C'&&!record.failure&&visualGateTitleCompositionNeedsImage(record)&&!gate?.risk_triggers?.includes('visible-title-composition'))failures.push(`visible title composition was not promoted to direct review ${record.theme}/${record.surface}.${record.state}`);
 const needsVisual=policy.class==='V'||(policy.class==='C'&&promoted);
 if(needsVisual&&(!record.screenshot||!/^[a-f0-9]{64}$/u.test(record.screenshot_sha256??'')))failures.push(`visual gate requires a screenshot ${record.theme}/${record.surface}.${record.state}`);
 if(requireVisualReview&&needsVisual&&record.screenshot_sha256){
  const review=record.visual_review;
  if(review?.method!=='direct-image-vision-review'||review.screenshot_sha256!==record.screenshot_sha256||typeof review.reviewer!=='string'||!review.reviewer.trim()||typeof review.note!=='string'||review.note.trim().length<12||!Number.isFinite(Date.parse(review.reviewed_at)))failures.push(`visual gate lacks exact-screenshot direct review ${record.theme}/${record.surface}.${record.state}`);
  else if(review.candidate_sha256!==record.candidate_sha256||review.candidate_source_sha256!==record.candidate_source_sha256)failures.push(`visual review is not bound to current candidate and source ${record.theme}/${record.surface}.${record.state}`);
  else if(!['PASS_NATURAL','PASS_INTENTIONAL_DIVERGENCE'].includes(record.classification))failures.push(`direct visual review did not accept the screenshot (${record.classification}) ${record.theme}/${record.surface}.${record.state}`);
 }
 if(policy.class==='M'&&!record.failure&&(!record.functional_assertion||record.functional_assertion.schema!=='theme_lab_functional_assertion.v1'||record.functional_assertion.policy_sha256!==VISUAL_GATE_POLICY_SHA256||record.functional_assertion.key!==policy.key||record.functional_assertion.action_contract_sha256!==record.capture_state_action_contract_sha256||record.functional_assertion.candidate_sha256!==record.candidate_sha256||record.functional_assertion.candidate_source_sha256!==record.candidate_source_sha256||record.functional_assertion.asset_dependency_sha256!==record.asset_dependency_sha256||record.functional_assertion.runtime_source_sha256!==record.runtime_source_sha256||record.functional_assertion.backend_runtime_identity_sha256!==record.backend_runtime_identity_sha256||record.functional_assertion.run_contract_sha256!==record.run_contract_sha256||record.functional_assertion.browser_engine!==record.browser_engine||record.functional_assertion.browser_version!==record.browser_version||record.functional_assertion.viewport!==record.viewport||record.functional_assertion.action_completed!==true))failures.push(`missing maintained functional action assertion ${record.theme}/${record.surface}.${record.state}`);
 if(policy.class==='M'&&record.failure&&(!record.screenshot||!/^[a-f0-9]{64}$/u.test(record.screenshot_sha256??'')))failures.push(`failed machine-only state lacks diagnostic screenshot ${record.theme}/${record.surface}.${record.state}`);
 if(policy.class==='M'&&!record.failure&&(record.screenshot||record.screenshot_sha256||record.visual_review))failures.push(`successful machine-only state retained visual evidence ${record.theme}/${record.surface}.${record.state}`);
 if(policy.class==='M'&&!record.failure&&(gate?.risk_triggers?.length??0)>0)failures.push(`successful machine-only state has an unsupported visual-risk promotion ${record.theme}/${record.surface}.${record.state}`);
 return failures;
}

export function visualGateNeedsScreenshot(record,{failure=false}={}){
 const policy=visualGatePolicyRow(record);
 return failure||policy?.class==='V'||(policy?.class==='C'&&(record.visual_gate?.risk_triggers?.length??0)>0);
}
