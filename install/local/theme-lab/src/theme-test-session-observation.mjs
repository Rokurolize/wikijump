// Bind the role actually rendered by the local runtime, not the requested
// storage/profile label. No cookie or actor credential is returned.
export async function observeThemeSession(page) {
  return page.evaluate(() => ({
    my_account_text: document.querySelector('#my-account')?.textContent?.trim() ?? null,
    logout_link_present: !!document.querySelector('#login-status a[href="/-/logout"]'),
    sign_in_link_present: !!document.querySelector('#login-status a[href="/-/login"]'),
  }));
}

export function themeSessionObservationIsValid(profile, observation) {
  if (profile === 'authenticated') return observation?.my_account_text === 'Administrator' &&
    observation.logout_link_present === true && observation.sign_in_link_present === false;
  if (profile === 'anonymous') return observation?.my_account_text === null &&
    observation.logout_link_present === false && observation.sign_in_link_present === true;
  return false;
}
