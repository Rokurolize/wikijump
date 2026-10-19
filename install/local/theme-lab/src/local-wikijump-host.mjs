// Local Wikijump hosts. Standing and task-owned runtimes serve
// `*.wikijump.localhost`; the development stack serves
// `*.wikijump.dev.localhost` (see issue #2546). Matching is by suffix so that
// cookie domains (`.wikijump.dev.localhost`) and hostnames are both accepted.
const LOCAL_WIKIJUMP_HOST = /\.wikijump\.(?:[a-z0-9-]+\.)*localhost$/u;

export function isLocalWikijumpHostname(hostname) {
  return typeof hostname === 'string' && LOCAL_WIKIJUMP_HOST.test(hostname);
}

export function isSiteLocalWikijumpHostname(hostname, siteSlug) {
  return isLocalWikijumpHostname(hostname) && hostname.startsWith(`${siteSlug}.`);
}
