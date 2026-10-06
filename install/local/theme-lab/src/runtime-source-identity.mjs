export const RUNTIME_SOURCE_HEADER = 'x-theme-lab-runtime-source-sha';
export const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

export function requireRuntimeSourceSha(value, context = 'run contract') {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${context} needs a valid expected_runtime_source_sha256`);
  }
  return value;
}

export function runtimeSourceShaFromHeaders(headers) {
  if (!headers) return null;
  if (typeof headers.get === 'function') {
    const value = headers.get(RUNTIME_SOURCE_HEADER);
    return typeof value === 'string' ? value.trim().toLowerCase() : null;
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() === RUNTIME_SOURCE_HEADER && typeof value === 'string') return value.trim().toLowerCase();
  }
  return null;
}

export function assertRuntimeSourceSha(expected, actual, context = 'runtime response') {
  requireRuntimeSourceSha(expected, 'run contract');
  if (typeof actual !== 'string' || !SHA256_PATTERN.test(actual)) {
    throw new Error(`${context} is missing a valid ${RUNTIME_SOURCE_HEADER} header`);
  }
  if (actual !== expected) throw new Error(`${context} Framerail source SHA ${actual} does not match run contract ${expected}`);
  return actual;
}

export function observationRuntimeSourceMatchesContract(row, runContract) {
  try{return row?.runtime_source_sha256===requireRuntimeSourceSha(runContract?.expected_runtime_source_sha256,'run contract')}
  catch{return false}
}

export function isThemeLabFixtureNavigationUrl(value,origin){
  try{
    const url=new URL(value),expected=new URL(origin);
    return url.origin===expected.origin&&decodeURIComponent(url.pathname.slice(1)).split('/')[0].startsWith('run-owned:');
  }catch{return false}
}

export function parseCurlRuntimeResponseHeaders(rawHeaders) {
  const lines = String(rawHeaders).split(/\r?\n/u);
  let status = null;
  let runtimeSourceSha = null;
  for (const line of lines) {
    const statusMatch = line.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/iu);
    if (statusMatch) {
      status = Number(statusMatch[1]);
      runtimeSourceSha = null;
      continue;
    }
    const headerMatch = line.match(/^x-theme-lab-runtime-source-sha\s*:\s*(.*?)\s*$/iu);
    if (headerMatch) runtimeSourceSha = headerMatch[1].toLowerCase();
  }
  if (status === null || status < 200 || status >= 300) throw new Error(`runtime fixture probe returned HTTP ${status ?? 'without a status'}`);
  return {status, runtimeSourceSha};
}
