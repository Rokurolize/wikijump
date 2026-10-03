import fs from 'node:fs/promises';import crypto from 'node:crypto';
const privateDir='/tmp/theme-semantic-authority/blank-theme-development-proof-v2-20261004';
const environment=Object.fromEntries((await fs.readFile(privateDir+'/deepwell-auth.env','utf8')).trim().split('\n').map(line=>{const at=line.indexOf('=');return[line.slice(0,at),line.slice(at+1)]}));
const privateActor=JSON.parse(await fs.readFile(privateDir+'/actor-inputs.json'));
const seed={email:privateActor.email,password:privateActor.password};
const endpoint='http://127.0.0.1:12748/jsonrpc';let nextId=0,sessionToken=null,siteId=null;
async function rpc(method,params,slug=null){const headers={authorization:'Bearer '+environment.DEEPWELL_RPC_TOKEN,'content-type':'application/json'};if(sessionToken)headers['X-Deepwell-Session-Token']=sessionToken;if(siteId)headers['X-Deepwell-Site-Id']=String(siteId);if(slug)headers['X-Deepwell-Page']=slug;const response=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:++nextId,method,params})});const body=await response.json();if(!response.ok||body.error)throw Error(method+' failed (code '+(body.error?.code??response.status)+')');return body.result;}
const site=await rpc('site_get',{site:'scpaiueouiuiuiui'});siteId=site.site_id;
const login=await rpc('login',{name_or_email:seed.email,password:seed.password??'',ip_address:'127.0.0.1',user_agent:'theme-blank-saved-proof/1'});if(login.needs_mfa||!login.session_token)throw Error('Seed actor did not resolve');sessionToken=login.session_token;
const session=await rpc('session_get',[sessionToken]);
const module='[[module ThemePreviewer noUi="true" theme_url=" "]]';
const definitions=[['baseline','Theme preview boundary probe.\n',false],['blank',module+'\nTheme preview boundary probe.\n',true],['abutted','[[module themepreviewer noUi="true"theme_url=" "]]\nTheme preview boundary probe.\n',true],['code','[[code]]\n'+module+'\n[[/code]]\nTheme preview boundary probe.\n',false],['comment','[!-- '+module+' --]\nTheme preview boundary probe.\n',false],['included','[[include run-owned:blank-theme-blank-20261004]]\nIncluded boundary probe.\n',true]];
definitions.push(['styled-blank',module+'\n[[module CSS]]\n.blank-theme-proof{color:#123456;}\n[[/module]]\nTheme preview boundary probe.\n',true]);
const rows=[],sha=s=>crypto.createHash('sha256').update(s).digest('hex');
for(const [id,wikitext,expected] of definitions){
 const slug='run-owned:blank-theme-'+id+'-20261004';let page=await rpc('page_get',{site_id:siteId,page:slug,details:{wikitext:true,compiled_html:true}},slug);
 if(!page){await rpc('page_create',{site_id:siteId,wikitext,title:'Blank Theme Boundary '+id,alt_title:null,slug,layout:'wikidot',revision_comments:'Run-owned bounded native ThemePreviewer parity proof',user_id:session.user_id,ip_address:'127.0.0.1',tags:['theme-lab-blank-proof']},slug);page=await rpc('page_get',{site_id:siteId,page:slug,details:{wikitext:true,compiled_html:true}},slug);}
 if(page.wikitext!==wikitext)throw Error('Source mismatch '+id);
 const view=await rpc('page_view',{site_id:siteId,session_token:sessionToken,route:{slug,extra:''},locales:['en']},slug);
 if(view.type!=='found'||view.data.theme_previewer_blank!==expected||!Array.isArray(view.data.compiled_body_styles))throw Error('Saved metadata mismatch '+id);
 const preview=await rpc('wikidot_page_preview',{site_id:siteId,title:'Blank Theme Boundary '+id,wikitext,syntax_only:false},slug);
 if(preview.errors?.length||!preview.body.includes('Theme preview boundary probe.')||(!['code'].includes(id)&&preview.body.includes('[[module')))throw Error('Preview boundary mismatch '+id);
 if(id==='styled-blank'&&(!view.data.compiled_body_styles.some(css=>css.includes('#123456'))||!(preview.styles??[]).some(css=>css.includes('#123456'))))throw Error('Source CSS was lost');
 rows.push({id,slug,page_id:page.page_id,revision_id:page.revision_id,source_sha256:sha(wikitext),compiled_generator:page.compiled_generator,saved_blank_theme:expected,saved_style_sha256:sha(JSON.stringify(view.data.compiled_body_styles)),saved_html_sha256:sha(view.data.compiled_body_html),preview_html_sha256:sha(preview.body),preview_styles:preview.styles??[]});console.log(JSON.stringify(rows.at(-1)));
}
await fs.writeFile(privateDir+'/saved-runtime-proof.json',JSON.stringify({schema:'theme_lab_blank_theme_saved_runtime.v1',rpc_url:endpoint,site:'scpaiueouiuiuiui',public_writes:0,runtime:JSON.parse(await fs.readFile(privateDir+'/identity.json')),rows},null,2)+'\n');
