import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

export async function storeContentAddressedScreenshot({portsDir, theme, engine, viewport, stateKey, bytes}) {
  if (!/^[a-z0-9-]+$/u.test(theme) || !/^(?:chromium|firefox|webkit)$/u.test(engine) || !/^[a-z-]+$/u.test(viewport) || !/^[a-z0-9-]+$/u.test(stateKey)) {
    throw new Error('invalid screenshot artifact identity');
  }
  const digest = sha256(bytes);
  const relativePath = path.join(theme, 'artifacts', 'interactive', engine, viewport, `${stateKey}-${digest}.png`);
  const destination = path.join(portsDir, relativePath);
  await fs.mkdir(path.dirname(destination), {recursive: true});
  try {
    const existing = await fs.readFile(destination);
    if (sha256(existing) !== digest) throw new Error(`content-addressed screenshot was altered: ${relativePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Publish complete bytes atomically. Two captures of the same image may
    // race, but neither may observe a partially written content-addressed file.
    const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, bytes, {flag: 'wx'});
      try { await fs.link(temporary, destination); }
      catch (publishError) {
        if (publishError.code !== 'EEXIST') throw publishError;
        if (sha256(await fs.readFile(destination)) !== digest) throw new Error(`content-addressed screenshot was altered: ${relativePath}`);
      }
    } finally { await fs.rm(temporary, {force: true}); }
  }
  return {path: relativePath.split(path.sep).join('/'), sha256: digest};
}
