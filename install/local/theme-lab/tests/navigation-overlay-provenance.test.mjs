import test from 'node:test';
import assert from 'node:assert/strict';
import {navigationOverlayProvenance} from '../src/navigation-overlay-provenance.mjs';
const rect={x:20,y:100,width:100,height:20};
const menu={x:10,y:90,width:200,height:300};
const leaf={tag:'A',text:'ガイドハブ',rect};
const top=()=>({surface:'nav.mobile-top',viewport_size:{width:390},title_text_measurement:{intersections:[leaf]},
 visual_diagnostics:{title_overlaps:[{...leaf,ancestors:[{tag:'LI'},{tag:'UL',position:'absolute',rect:menu},{tag:'LI'}]}]}});
const side=()=>({surface:'nav.sidebar',title_text_measurement:{intersections:[{...leaf,tag:'P',text:'SCP-JPシリーズ'}]},
 visual_diagnostics:{elements:{'#side-bar':{position:'fixed',rect:menu,children:[{tag:'DIV',class:'side-block',rect:menu}]}}}});
test('known menu leaves settle only with retained positioned submenu ancestry',()=>{
 assert.equal(navigationOverlayProvenance(top()),true);
 assert.equal(navigationOverlayProvenance({...top(),surface:'nav.tablet-top'}),true);
 const unknown=top();unknown.title_text_measurement.intersections=[{...leaf,text:'マイアカウント'}];assert.equal(navigationOverlayProvenance(unknown),false);
 const unowned=top();unowned.visual_diagnostics.title_overlaps[0].ancestors[1].position='static';assert.equal(navigationOverlayProvenance(unowned),false);
 const escaping=top();escaping.visual_diagnostics.title_overlaps[0].ancestors[1].rect={...menu,width:500};assert.equal(navigationOverlayProvenance(escaping),false);
});
test('known sidebar leaves settle only inside their rendered side-block and drawer',()=>{
 assert.equal(navigationOverlayProvenance(side()),true);
 const unowned=side();unowned.visual_diagnostics.elements['#side-bar'].children[0].class='account-overlay';assert.equal(navigationOverlayProvenance(unowned),false);
 const outside=side();outside.title_text_measurement.intersections[0].rect={...rect,x:350};assert.equal(navigationOverlayProvenance(outside),false);
 const unknown=side();unknown.title_text_measurement.intersections[0].text='サインアウト';assert.equal(navigationOverlayProvenance(unknown),false);
 assert.equal(navigationOverlayProvenance(side(),null),false);
});
