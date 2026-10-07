// Source themes can supply their own container-wrap target control. Prefer
// the ordinary Wikidot button when visible, then the actual source DOM link.
export async function openSidebar(page){
 for(const selector of ['.mobile-top-bar .open-menu a','a[href="#container-wrap"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);if(!await link.isVisible())continue;
   const hash=await link.getAttribute('href');
   if(await sidebarOccupiesViewport(page))return hash;
   const reachable=await link.evaluate(anchor=>{const r=anchor.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));return !!hit&&(hit===anchor||anchor.contains(hit))});
   if(!reachable)continue;
   await link.click();
   await page.waitForFunction(hash=>location.hash===hash,hash);
   await page.locator('#side-bar').waitFor({state:'visible'});
   return await page.evaluate(()=>location.hash);
  }
 }
 throw new Error('No reachable ordinary or source-owned sidebar control');
}
export async function closeSidebar(page,openHash){
 for(const selector of ['#side-bar .close-menu','a[href="##"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);
   if(await sidebarIsClosed(page,openHash))return;
   const reachable=await link.evaluate(anchor=>{const r=anchor.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return null;const x=Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),y=Math.max(0,Math.min(innerHeight-1,r.top+r.height/2));const hit=document.elementFromPoint(x,y);return hit&&(hit===anchor||anchor.contains(hit))?{x,y}:null});
   // Click the viewport point actually hit-tested above. Locator.click may pick
   // a different clipped center for a tall drawer backdrop and hit its content.
   if(reachable)await page.mouse.click(reachable.x,reachable.y);else await link.evaluate(anchor=>anchor.click());
   await page.waitForFunction(async hash=>{
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const side=document.querySelector('#side-bar');if(!side)return true;
    const style=getComputedStyle(side),r=side.getBoundingClientRect();
    const occupies=style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
    return location.hash!==hash&&!occupies;
   },openHash,{timeout:5000});return;
  }
 }
 // Some source themes use their opener as a true toggle. Only accept it after
 // its own DOM event produces both a changed hash and a closed viewport state.
 const opener=page.locator('.mobile-top-bar .open-menu a, a[href="#container-wrap"]').first();
 if(await opener.count()){
  if(await sidebarIsClosed(page,openHash))return;
  await opener.evaluate(anchor=>anchor.click());
  await page.waitForFunction(async hash=>{
   await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
   const side=document.querySelector('#side-bar');if(!side)return true;
   const style=getComputedStyle(side),r=side.getBoundingClientRect();
   const occupies=style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
   return location.hash!==hash&&!occupies;
  },openHash,{timeout:5000});return;
 }
 throw new Error('No source-owned sidebar close or toggle control');
}
export async function sidebarIsClosed(page,openHash){return page.evaluate(hash=>{
 const side=document.querySelector('#side-bar');if(!side)return true;
 const style=getComputedStyle(side),r=side.getBoundingClientRect();
 const intersects=style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
 const sampleX=Math.max(0,Math.min(innerWidth-1,r.left+Math.min(24,Math.max(1,r.width/4))));
 const sampleY=Math.max(0,Math.min(innerHeight-1,r.top+Math.min(24,Math.max(1,r.height/4))));
 const hit=intersects?document.elementFromPoint(sampleX,sampleY):null;
 const painted=!!hit&&(hit===side||side.contains(hit));
 return location.hash!==hash&&(!intersects||!painted);
 },openHash)}
export async function sidebarOccupiesViewport(page){return page.evaluate(()=>{
 const side=document.querySelector('#side-bar');if(!side)return false;
 const style=getComputedStyle(side),r=side.getBoundingClientRect();
 if(style.display==='none'||style.visibility==='hidden'||Number(style.opacity)<=0||r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;
 // A drawer can retain an in-viewport box while its negative stacking order
 // leaves it painted behind the page. Treat it as open only when it is the
 // hit-tested surface at an interior point; geometry alone misclassifies that
 // closed Monotypical drawer and skips the actual opener click.
 const sampleX=Math.max(0,Math.min(innerWidth-1,r.left+Math.min(24,Math.max(1,r.width/4))));
 const sampleY=Math.max(0,Math.min(innerHeight-1,r.top+Math.min(24,Math.max(1,r.height/4))));
 const hit=document.elementFromPoint(sampleX,sampleY);
 return !!hit&&(hit===side||side.contains(hit));
})}
