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
   if(reachable)await link.click();else await link.evaluate(anchor=>anchor.click());
   await page.waitForFunction(hash=>location.hash===hash,hash);
   await page.locator('#side-bar').waitFor({state:'visible'});
   return await page.evaluate(()=>location.hash);
  }
 }
 throw new Error('No visible ordinary or source-owned sidebar control');
}
export async function closeSidebar(page,openHash){
 for(const selector of ['#side-bar .close-menu','a[href="##"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);
   if(await sidebarIsClosed(page,openHash))return;
   const reachable=await link.evaluate(anchor=>{const r=anchor.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));return !!hit&&(hit===anchor||anchor.contains(hit))});
   if(reachable)await link.click();else await link.evaluate(anchor=>anchor.click());
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
 const occupies=style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
 return location.hash!==hash&&!occupies;
 },openHash)}
export async function sidebarOccupiesViewport(page){return page.evaluate(()=>{
 const side=document.querySelector('#side-bar');if(!side)return false;
 const style=getComputedStyle(side),r=side.getBoundingClientRect();
 return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&r.width>0&&r.height>0&&r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight;
})}
