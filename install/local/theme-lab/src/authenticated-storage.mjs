import fs from 'node:fs/promises';
import path from 'node:path';

export async function loadThemeLabAuthenticatedStorage(storagePath) {
  const absolute=path.resolve(storagePath);
  const stat=await fs.lstat(absolute);
  if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Authenticated storage must be a regular non-symlink file');
  if((stat.mode&0o077)!==0)throw new Error('Authenticated storage must not be group- or world-readable');
  const storage=JSON.parse(await fs.readFile(absolute,'utf8'));
  if(!Array.isArray(storage.cookies)||!Array.isArray(storage.origins))throw new Error('Authenticated storage is not a Playwright storage-state document');
  const sessionCookies=storage.cookies.filter(cookie=>cookie?.name==='wikijump_token'&&typeof cookie.value==='string'&&cookie.value.length>0);
  if(sessionCookies.length!==1)throw new Error('Authenticated storage must contain exactly one wikijump_token cookie');
  const sessionCookie=sessionCookies[0];
  // Playwright storage-state preserves the URI-encoded form emitted by
  // SvelteKit's cookie serializer. Validate that representation without
  // changing the cookie bytes passed back to the browser.
  const sessionToken=sessionCookie.value.replace(/^wj%3a/iu,'wj:');
  if(!sessionToken.startsWith('wj:'))throw new Error('Authenticated storage contains an invalid wikijump_token');
  if(typeof sessionCookie.domain!=='string'||!sessionCookie.domain.endsWith('.wikijump.localhost'))throw new Error('Authenticated storage wikijump_token is not scoped to wikijump.localhost');
  return {absolute,storage,sessionToken};
}

export function administratorBrowserObservationIsValid(observation) {
  return observation?.my_account_text==='Administrator'&&
    observation?.logout_link_present===true&&
    observation?.sign_in_link_present===false;
}
