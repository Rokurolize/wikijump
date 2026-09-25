import crypto from 'node:crypto';

// Preserve the CSS-only identity used by older captures, while recognizing the
// combined identity used by the initial candidate replay format. A base CSS
// layer always requires the combined key.
export function candidateIdentity(css, baseCss, knownIdentities = new Set()) {
  const cssText = Buffer.isBuffer(css) ? css.toString('utf8') : String(css);
  const baseBytes = Buffer.isBuffer(baseCss) ? baseCss : Buffer.from(String(baseCss ?? ''));
  const rawSha = crypto.createHash('sha256').update(cssText).digest('hex');
  const baseSha = baseBytes.length ? crypto.createHash('sha256').update(baseBytes).digest('hex') : null;
  const combinedSha = crypto.createHash('sha256').update(JSON.stringify({ baseCssSha: baseSha, css: cssText })).digest('hex');
  return { candidateSha: baseSha ? combinedSha : knownIdentities.has(rawSha) ? rawSha : knownIdentities.has(combinedSha) ? combinedSha : rawSha, rawSha, combinedSha, baseSha };
}
