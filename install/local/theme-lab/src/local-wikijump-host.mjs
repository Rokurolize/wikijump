// A local Wikijump site host: standing serves `<site>.wikijump.localhost`,
// the local development stack serves `<site>.wikijump.dev.localhost`.
const LOCAL_WIKIJUMP_HOST = /\.wikijump\.(?:[a-z0-9-]+\.)*localhost$/u;

export function isLocalWikijumpHost(hostname) {
  return LOCAL_WIKIJUMP_HOST.test(hostname);
}
