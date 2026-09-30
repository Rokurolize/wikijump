// Source themes can supply their own container-wrap target control. Prefer
// the ordinary Wikidot button when visible, then the actual source DOM link.
export async function openSidebar(page){
 for(const selector of ['.mobile-top-bar .open-menu a','a[href="#container-wrap"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);if(!await link.isVisible())continue;
   const hash=await link.getAttribute('href');
   if(await page.locator('#side-bar').isVisible())return hash;
   const reachable=await link.evaluate(anchor=>{const r=anchor.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));return !!hit&&(hit===anchor||anchor.contains(hit))});
   if(reachable)await link.click();else await link.evaluate(anchor=>anchor.click());
   await page.waitForFunction(hash=>location.hash===hash,hash);
   await page.locator('#side-bar').waitFor({state:'visible'});
   return hash;
  }
 }
 throw new Error('No visible ordinary or source-owned sidebar control');
}
export async function closeSidebar(page,openHash){
 for(const selector of ['#side-bar .close-menu','a[href="##"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);if(!await link.isVisible())continue;
   if(!await page.locator('#side-bar').isVisible())return;
   const reachable=await link.evaluate(anchor=>{const r=anchor.getBoundingClientRect();if(r.width<=0||r.height<=0||r.right<=0||r.bottom<=0||r.left>=innerWidth||r.top>=innerHeight)return false;const hit=document.elementFromPoint(Math.max(0,Math.min(innerWidth-1,r.left+r.width/2)),Math.max(0,Math.min(innerHeight-1,r.top+r.height/2)));return !!hit&&(hit===anchor||anchor.contains(hit))});
   if(reachable)await link.click();else await link.evaluate(anchor=>anchor.click());
   await page.waitForFunction(hash=>location.hash!==hash,openHash);await page.locator('#side-bar').waitFor({state:'hidden'});return;
  }
 }
 throw new Error('No visible ordinary or source-owned sidebar close control');
}
