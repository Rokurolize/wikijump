import crypto from 'node:crypto';

export const BUNDLE_SCHEMA = 'wikijump.theme_lab_authority_evidence_bundle.v1';
export const TAR_MTIME_DEFAULT = 0;
export const TAR_MODE_FILE = 0o644;

const sha256Bytes = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

/**
 * Split a tar path across the USTAR name (100 bytes) and prefix (155 bytes)
 * fields. Rejects paths that fit neither field instead of truncating them.
 */
export function splitTarPath(relativePath) {
  const encoded = Buffer.from(relativePath, 'utf8');
  if (encoded.length <= 100) return { name: relativePath, prefix: '' };
  const slash = relativePath.lastIndexOf('/', 155);
  if (slash <= 0 || slash > 155) {
    throw new Error(`path does not fit USTAR name/prefix fields: ${relativePath}`);
  }
  const name = relativePath.slice(slash + 1);
  const prefix = relativePath.slice(0, slash);
  if (Buffer.from(name, 'utf8').length > 100 || Buffer.from(prefix, 'utf8').length > 155) {
    throw new Error(`path does not fit USTAR name/prefix fields: ${relativePath}`);
  }
  return { name, prefix };
}

function writeField(header, offset, length, value) {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length > length) throw new Error(`USTAR field overflow: ${value}`);
  encoded.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const text = value.toString(8).padStart(length - 1, '0') + '\0';
  if (text.length !== length) throw new Error(`USTAR octal overflow: ${value}`);
  Buffer.from(text, 'ascii').copy(header, offset);
}

function tarHeader(relativePath, size, mtime) {
  const { name, prefix } = splitTarPath(relativePath);
  const header = Buffer.alloc(512, 0);
  writeField(header, 0, 100, name);
  writeOctal(header, 100, 8, TAR_MODE_FILE);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, mtime);
  header[156] = 0x30;
  writeField(header, 157, 100, '');
  writeField(header, 257, 6, 'ustar\0');
  writeField(header, 263, 2, '00');
  writeField(header, 265, 32, '');
  writeField(header, 297, 32, '');
  writeField(header, 329, 8, '');
  writeField(header, 337, 8, '');
  writeField(header, 345, 155, prefix);
  let checksum = 0;
  for (let index = 0; index < 512; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header[index];
  }
  writeField(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return header;
}

/**
 * Pack entries into a deterministic USTAR archive: entries sorted by path,
 * fixed mtime/uid/gid/mode, no extended headers. Packing the same entries
 * twice yields identical bytes.
 *
 * @param {{path: string, bytes: Buffer}[]} entries
 */
export function createArchive(entries, { mtime = TAR_MTIME_DEFAULT } = {}) {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const seen = new Set();
  const parts = [];
  for (const { path, bytes } of sorted) {
    if (seen.has(path)) throw new Error(`duplicate archive path: ${path}`);
    seen.add(path);
    parts.push(tarHeader(path, bytes.length, mtime));
    parts.push(bytes);
    const padding = (512 - (bytes.length % 512)) % 512;
    if (padding) parts.push(Buffer.alloc(padding, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function readField(header, offset, length) {
  const end = header.indexOf(0, offset);
  const stop = end === -1 || end > offset + length ? offset + length : end;
  return header.toString('utf8', offset, stop);
}

function readOctal(header, offset, length) {
  const text = readField(header, offset, length).replace(/\0| /gu, '');
  if (!/^[0-7]*$/u.test(text)) throw new Error('malformed USTAR octal field');
  return text === '' ? 0 : Number.parseInt(text, 8);
}

/**
 * Parse a USTAR archive produced by {@link createArchive} (or any
 * spec-conformant writer) into `{path, bytes}` entries in archive order.
 * Rejects absolute paths, `..` segments, and truncated archives instead
 * of writing outside the destination.
 */
export function parseArchive(buffer) {
  const entries = [];
  let offset = 0;
  for (;;) {
    if (offset + 512 > buffer.length) throw new Error('truncated USTAR archive');
    const header = buffer.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      if (offset + 512 > buffer.length) throw new Error('truncated USTAR archive end marker');
      const second = buffer.subarray(offset, offset + 512);
      if (!second.every((byte) => byte === 0)) throw new Error('expected USTAR end-of-archive marker');
      return entries;
    }
    if (readField(header, 257, 6) !== 'ustar') throw new Error('not a USTAR archive');
    const name = readField(header, 0, 100);
    const prefix = readField(header, 345, 155);
    const relativePath = prefix ? `${prefix}/${name}` : name;
    if (!relativePath || relativePath.startsWith('/') || relativePath.split('/').includes('..')) {
      throw new Error(`unsafe archive path: ${relativePath}`);
    }
    const size = readOctal(header, 124, 12);
    if (offset + size > buffer.length) throw new Error(`truncated USTAR entry: ${relativePath}`);
    entries.push({ path: relativePath, bytes: Buffer.from(buffer.subarray(offset, offset + size)) });
    offset += size + ((512 - (size % 512)) % 512);
  }
}

/**
 * Build manifest entries for inventory files. `readBytes` returns the file
 * bytes plus the concrete path they came from, or null when unavailable.
 * Every entry is re-hashed from the bytes actually read: a source file
 * whose content disagrees with the inventory hash fails closed instead of
 * entering the bundle.
 */
export function buildManifestEntries(inventoryFiles, readBytes) {
  const entries = [];
  const missing = [];
  for (const file of inventoryFiles) {
    const found = readBytes(file.relative_path, file.sha256);
    if (!found) {
      missing.push(file.relative_path);
      continue;
    }
    const { bytes, sourcePath } = found;
    const actualSha = sha256Bytes(bytes);
    if (actualSha !== file.sha256.toLowerCase()) {
      throw new Error(`source bytes disagree with inventory hash for ${file.relative_path}`);
    }
    if (bytes.length !== file.size_bytes) {
      throw new Error(`source size disagrees with inventory for ${file.relative_path}: ${bytes.length} != ${file.size_bytes}`);
    }
    entries.push({
      path: file.relative_path,
      size_bytes: bytes.length,
      sha256: actualSha,
      source_path: sourcePath,
    });
  }
  if (missing.length) {
    throw new Error(`no source for ${missing.length} inventoried file(s), first: ${missing[0]}`);
  }
  return entries;
}

export function buildManifest(entries, { inventorySha256 = null, archiveSha256 = null, archiveMtime = TAR_MTIME_DEFAULT } = {}) {
  return {
    schema: BUNDLE_SCHEMA,
    inventory_sha256: inventorySha256,
    entry_count: entries.length,
    total_bytes: entries.reduce((sum, entry) => sum + entry.size_bytes, 0),
    archive_sha256: archiveSha256,
    archive_mtime: archiveMtime,
    entries: [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
  };
}

/**
 * Verify a restored tree byte for byte against the manifest. `readRestored`
 * returns file bytes or null; `listRestored` returns every file path under
 * the restored root. Missing, mismatched, and unexpected files all fail.
 */
export function verifyRestored(manifest, readRestored, listRestored) {
  const failures = [];
  const expected = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  for (const entry of manifest.entries) {
    const bytes = readRestored(entry.path);
    if (!bytes) {
      failures.push({ path: entry.path, reason: 'missing' });
      continue;
    }
    if (bytes.length !== entry.size_bytes || sha256Bytes(bytes) !== entry.sha256) {
      failures.push({ path: entry.path, reason: 'mismatch' });
    }
  }
  const restored = new Set(listRestored());
  const unexpected = [...restored].filter((path) => !expected.has(path)).sort();
  for (const path of unexpected) failures.push({ path, reason: 'unexpected' });
  return { status: failures.length ? 'fail' : 'pass', checked: manifest.entries.length, failures };
}
