// Source themes can supply their own container-wrap target control. Prefer
// the ordinary Wikidot button when visible, then the actual source DOM link.
export async function openSidebar(page){
 for(const selector of ['.mobile-top-bar .open-menu a','a[href="#container-wrap"]']){
  const links=page.locator(selector);
  for(let index=0;index<await links.count();index++){
   const link=links.nth(index);if(!await link.isVisible())continue;
   const hash=await link.getAttribute('href');await link.click();
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
   await link.click();await page.waitForFunction(hash=>location.hash!==hash,openHash);return;
  }
 }
 throw new Error('No visible ordinary or source-owned sidebar close control');
}
