// A concealed input cannot prove typing. Exercise the source's visible submit
// instead, observing the native navigation request without leaving the fixture.
export async function exerciseHeaderSearch(page, sourceAuthority = null) {
  const query = page.locator('#search-top-box-input');
  const submit = page.locator('#search-top-box-form input[type="submit"]');
  await submit.focus();
  const state = await query.evaluate(element => {
    const style = getComputedStyle(element), rect = element.getBoundingClientRect();
    return {display: style.display, visibility: style.visibility, width: rect.width, height: rect.height, value: element.value};
  });
  let observation;
  if (state.display === 'none' || state.visibility === 'hidden' || !state.width || !state.height) {
    const origin = new URL(page.url()).origin;
    const expected = '/search:site/q/' + encodeURIComponent(state.value);
    let observed = null, finish;
    const requested = new Promise(resolve => { finish = resolve; });
    const pattern = origin + '/search:site/q/**';
    const intercept = async route => {
      if (!route.request().isNavigationRequest()) return route.continue();
      observed = new URL(route.request().url()).pathname;
      await route.fulfill({status: 204}); // Browser keeps the original document.
      finish();
    };
    await page.route(pattern, intercept);
    let timer;
    try {
      await submit.click({noWaitAfter: true});
      await Promise.race([requested, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Visible search submit did not request the Wikidot search route')), 2000);
      })]);
      if (observed !== expected) throw new Error('Visible search submit requested a different query route');
    } finally {
      clearTimeout(timer);
      await page.unroute(pattern, intercept);
    }
    observation = {schema: 'theme_lab_search_action.v1', control: '#search-top-box-input',
      mode: 'source-hidden-submit', query: state, expected_path: expected, observed_path: observed,
      source_authority: sourceAuthority};
  } else {
    await query.fill('SCP-JP テーマ');
    await query.focus();
    observation = {schema: 'theme_lab_search_action.v1', control: '#search-top-box-input',
      mode: 'typed-focused', query: state,
      typed_and_focused: await query.evaluate(element => element.value === 'SCP-JP テーマ' && document.activeElement === element)};
    if (!observation.typed_and_focused) throw new Error('Visible search input did not retain the typed query and focus');
  }
  await page.evaluate(value => {window.__themeLabActionContractObservation = value;}, observation);
  return observation;
}
