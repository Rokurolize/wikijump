// Frozen Sigma-10 uses the native foldable-list fixer. Its controls do not
// navigate or create history entries; return and close toggle their own LI.
export async function openSigma10CreditView(page) {
  await page.locator('.creditRate > .rateBox > .rate-box-with-credit-button .creditButton a:visible').last().click();
  await page.locator('.creditRate > .rateBox.unfolded').waitFor({state:'attached'});
  await page.locator('#u-credit-view .modalbox').first().waitFor({state:'visible'});
}

export async function openSigma10CreditOtherwise(page) {
  await openSigma10CreditView(page);
  await page.locator('#u-credit-view .creditRateOtherwise > li > .foldable-list-container a').click();
  await page.locator('.creditRateOtherwise > li.unfolded').waitFor({state:'attached'});
  await page.locator('#u-credit-otherwise .modalbox').waitFor({state:'visible'});
}

export async function returnSigma10CreditView(page, keyboard=false) {
  const control=page.locator('#u-credit-otherwise .return-credits a');
  if(keyboard){await control.focus();await control.press('Enter')}else await control.click();
  await page.locator('.creditRateOtherwise > li.folded').waitFor({state:'attached'});
  await page.locator('#u-credit-otherwise .modalbox').waitFor({state:'hidden'});
  await page.locator('#u-credit-view .modalbox').first().waitFor({state:'visible'});
}

export const sigma10CreditActions = {
  'credit.view.open':openSigma10CreditView,
  'credit.view.scrolled-bottom':async page=>{
    await openSigma10CreditView(page);
    await page.locator('#u-credit-view .modalbox > .credit.first').evaluate(element=>element.scrollTop=element.scrollHeight);
  },
  'credit.otherwise.open':openSigma10CreditOtherwise,
  'credit.otherwise.scrolled-bottom':async page=>{
    await openSigma10CreditOtherwise(page);
    await page.locator('#u-credit-otherwise .credit.otherwise').evaluate(element=>element.scrollTop=element.scrollHeight);
  },
  'credit.otherwise.back-control-click':async page=>{
    await openSigma10CreditOtherwise(page);
    await page.locator('#u-credit-otherwise .credit.otherwise').evaluate(element=>element.scrollTop=element.scrollHeight);
    await returnSigma10CreditView(page);
  },
  'credit.otherwise.back-to-view':async page=>{
    await openSigma10CreditOtherwise(page);
    await returnSigma10CreditView(page,true);
  },
  'credit.close-back.restored':async page=>{
    await openSigma10CreditView(page);
    const close=page.locator('#u-credit-view > .modalcontainer > .modalbox > .close-credits a');
    await close.focus();
    await close.press('Enter');
    await page.locator('.creditRate > .rateBox.folded').waitFor({state:'attached'});
    await page.locator('#u-credit-view .modalbox').first().waitFor({state:'hidden'});
  },
};
