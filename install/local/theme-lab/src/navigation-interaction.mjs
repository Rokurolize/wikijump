export async function activateNavigationControl(page, anchor, submenu) {
  if (await hasRenderedSubmenuGeometry(submenu)) return;
  const href=await anchor.getAttribute('href');
  if(href==='javascript:;'){
    await anchor.hover({force:true});
    const hoverDeadline=Date.now()+500;
    while(Date.now()<hoverDeadline){if(await hasRenderedSubmenuGeometry(submenu))return;await page.waitForTimeout(50)}
  }
  const reachable = await anchor.evaluate(element => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return false;
    const hit = document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, rect.left + rect.width / 2)), Math.max(0, Math.min(innerHeight - 1, rect.top + rect.height / 2)));
    return !!hit && (hit === element || element.contains(hit));
  });
  if (reachable) await anchor.click(); else await anchor.evaluate(element => element.click());
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){if(await hasRenderedSubmenuGeometry(submenu))return;await page.waitForTimeout(50)}
  throw new Error('source navigation action did not produce rendered submenu geometry');
}

export async function hasRenderedSubmenuGeometry(submenu){return submenu.evaluate(element=>{
  const style=getComputedStyle(element),rect=element.getBoundingClientRect();
  return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)>0&&rect.width>0&&rect.height>0&&rect.right>0&&rect.bottom>0&&rect.left<innerWidth&&rect.top<innerHeight;
})}

export async function expandMobileTopSubmenu(page) {
  const item = page.locator('.mobile-top-bar > ul > li').filter({has: page.locator(':scope > ul')}).first();
  if (!(await item.count())) throw new Error('mobile top navigation submenu fixture is absent');
  const anchor = item.locator(':scope > a').first(), submenu = item.locator(':scope > ul');
  if (!(await anchor.count()) || !(await anchor.isVisible())) throw new Error('mobile top navigation parent control is absent');
  await activateNavigationControl(page, anchor, submenu);
}

export async function expandTabletTopNavigation(page) {
  const desktop = page.locator('#top-bar .top-bar');
  const info = await desktop.evaluate(root => {
    const visible = element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
    };
    for (const item of root.querySelectorAll('li')) {
      const anchor = item.querySelector(':scope > a'), submenu = item.querySelector(':scope > ul');
      if (anchor && submenu && visible(anchor)) return {desktop: true, expanded: visible(submenu)};
    }
    return {desktop: [...root.querySelectorAll('a')].some(visible)};
  });
  if (info.desktop) {
    if (info.expanded) return;
    const item = desktop.locator('li').filter({has: page.locator(':scope > ul')}).filter({has: page.locator(':scope > a')}).first();
    const anchor = item.locator(':scope > a').first(), submenu = item.locator(':scope > ul');
    if (!(await anchor.count())) throw new Error('visible tablet desktop navigation has no submenu control');
    const reachable = await anchor.evaluate(element => {
      const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight && !!hit && (hit === element || element.contains(hit));
    });
    if (reachable) await anchor.hover(); else await anchor.evaluate(element => element.click());
    await submenu.waitFor({state: 'visible', timeout: 3000});
    return;
  }
  const item = page.locator('.mobile-top-bar > ul > li').filter({has: page.locator(':scope > ul')}).first();
  if (!(await item.count()) || !(await item.locator(':scope > a').isVisible())) throw new Error('no tablet top-navigation control is visible');
  await activateNavigationControl(page, item.locator(':scope > a').first(), item.locator(':scope > ul'));
}
