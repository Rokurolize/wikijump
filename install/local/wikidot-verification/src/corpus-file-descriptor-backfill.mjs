import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const SHA256_RE = /^[0-9a-f]{64}$/u;
const SHA512_RE = /^[0-9a-f]{128}$/u;

function sqlBigint(value, label) {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
  return `${value}::bigint`;
}

function sqlText(value) {
  if (typeof value !== 'string' || /\0/u.test(value)) throw new Error('SQL text value is invalid');
  return `'${value.replaceAll("'", "''")}'::text`;
}

function siteIdentityGuardSql(siteId, siteSlug) {
  const siteIdSql = sqlBigint(siteId, 'siteId');
  const siteSlugSql = sqlText(siteSlug);
  return `DO $site_identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM site
    WHERE site_id = ${siteIdSql}
      AND slug = ${siteSlugSql}
      AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'target site identity mismatch: expected site_id % and slug %', ${siteIdSql}, ${siteSlugSql};
  END IF;
END
$site_identity$;`;
}

function descriptorFromDescription(description, source) {
  const label = typeof description === 'string'
    ? description.split(',', 1)[0].trim()
    : '';
  if (!label || !description || /[\r\n\0]/u.test(description)) {
    throw new Error(`${source}: corpus mime_description must be a non-empty single-line string`);
  }
  return { label, description };
}

function corpusFileStorageName(filename) {
  const digest = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 20);
  const leaf = filename.replaceAll('\\', '/').split('/').at(-1);
  const suffix = leaf.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^[._]+|[._]+$/gu, '') || 'file';
  return `${digest}-${suffix.slice(0, 80)}`;
}

function addSafeInteger(left, right, label) {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw new Error(`${label} exceeds the safe integer range`);
  return sum;
}

function sortedDirectories(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
}

function corpusCandidateKey(fullname, filename, size) {
  return `${fullname}\0${filename}\0${size}`;
}

export function inspectCorpusFileDescriptorSnapshots({ corpusRoot, branch }) {
  const branchRoot = path.resolve(corpusRoot, branch);
  const byUuidRoot = path.join(branchRoot, 'by-uuid');
  const snapshotSetHash = crypto.createHash('sha256');
  const candidateIdentities = new Map();
  let snapshotsTotal = 0;
  let snapshotsWithDescriptor = 0;
  let descriptorBytes = 0;

  for (const entity of sortedDirectories(byUuidRoot)) {
    const filesRoot = path.join(byUuidRoot, entity.name, 'files');
    for (const fileDirectory of sortedDirectories(filesRoot)) {
      const snapshotsRoot = path.join(filesRoot, fileDirectory.name, 'snapshots');
      if (!fs.existsSync(snapshotsRoot)) continue;
      const snapshots = fs.readdirSync(snapshotsRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && path.extname(entry.name) === '.json')
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const snapshot of snapshots) {
        const snapshotPath = path.join(snapshotsRoot, snapshot.name);
        const raw = fs.readFileSync(snapshotPath);
        const relativePath = path.relative(branchRoot, snapshotPath).split(path.sep).join('/');
        snapshotSetHash.update(relativePath);
        snapshotSetHash.update('\0');
        snapshotSetHash.update(crypto.createHash('sha256').update(raw).digest('hex'));
        snapshotSetHash.update('\n');
        snapshotsTotal += 1;

        const record = JSON.parse(raw.toString('utf8'));
        const description = record?.metadata?.mime_description;
        if (description === null || description === undefined) continue;
        const descriptor = descriptorFromDescription(description, snapshotPath);
        const fullname = record?.page;
        const filename = record?.filename;
        const size = record?.metadata?.size;
        const bytesSha256 = typeof record?.bytes_sha256 === 'string'
          ? record.bytes_sha256.replace(/^sha256:/u, '').toLowerCase()
          : '';
        if (typeof fullname !== 'string' || fullname.length === 0 || /\0/u.test(fullname)) {
          throw new Error(`${snapshotPath}: corpus attachment page must be a non-empty string`);
        }
        if (typeof filename !== 'string' || filename.length === 0 || /\0/u.test(filename)) {
          throw new Error(`${snapshotPath}: corpus attachment filename must be a non-empty string`);
        }
        if (!Number.isSafeInteger(size) || size < 0) {
          throw new Error(`${snapshotPath}: corpus attachment size must be a non-negative safe integer`);
        }
        if (!SHA256_RE.test(bytesSha256)) {
          throw new Error(`${snapshotPath}: corpus attachment bytes_sha256 is invalid`);
        }
        snapshotsWithDescriptor += 1;
        descriptorBytes = addSafeInteger(descriptorBytes, size, 'corpus descriptor bytes');
        const key = corpusCandidateKey(fullname, filename, size);
        const identities = candidateIdentities.get(key) ?? new Set();
        identities.add(`${bytesSha256}\0${descriptor.label}\0${descriptor.description}`);
        candidateIdentities.set(key, identities);
      }
    }
  }

  const candidates = new Map();
  let unambiguousCandidates = 0;
  for (const [key, identities] of candidateIdentities) {
    const unambiguous = identities.size === 1;
    candidates.set(key, unambiguous);
    if (unambiguous) unambiguousCandidates += 1;
  }
  return {
    denominator: {
      snapshots_total: snapshotsTotal,
      snapshots_with_descriptor: snapshotsWithDescriptor,
      descriptor_bytes: descriptorBytes,
      unambiguous_descriptor_candidates: unambiguousCandidates,
      snapshot_file_set_sha256: snapshotSetHash.digest('hex'),
    },
    candidates,
  };
}

export function buildFileDescriptorInventorySql({ siteId, siteSlug, cursor = null, limit }) {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive safe integer');
  }
  const cursorSql = cursor === null
    ? ''
    : `
  AND (p.slug, f.file_id, latest.revision_id) > (${sqlText(cursor.fullname)}, ${sqlBigint(cursor.file_id, 'cursor.file_id')}, ${sqlBigint(cursor.revision_id, 'cursor.revision_id')})`;
  return `${siteIdentityGuardSql(siteId, siteSlug)}
SELECT json_build_object(
  'page_id', p.page_id,
  'page_category_id', p.page_category_id,
  'fullname', p.slug,
  'file_id', f.file_id,
  'revision_id', latest.revision_id,
  'filename', f.name,
  'size', latest.size,
  's3_key_hex', encode(latest.s3_hash, 'hex')
)::text
FROM file f
JOIN page p
  ON p.page_id = f.page_id
 AND p.site_id = f.site_id
 AND p.deleted_at IS NULL
JOIN LATERAL (
  SELECT fr.revision_id, fr.size, fr.s3_hash
  FROM file_revision fr
  WHERE fr.site_id = f.site_id
    AND fr.page_id = f.page_id
    AND fr.file_id = f.file_id
  ORDER BY fr.revision_number DESC, fr.revision_id DESC
  LIMIT 1
) latest ON TRUE
WHERE f.site_id = ${sqlBigint(siteId, 'siteId')}
  AND f.deleted_at IS NULL
  ${cursorSql}
ORDER BY p.slug, f.file_id, latest.revision_id
LIMIT ${limit};`;
}

export function buildFileDescriptorCompletionSql(siteId, siteSlug) {
  return `${siteIdentityGuardSql(siteId, siteSlug)}
WITH active_files AS (
  SELECT f.file_id, latest.revision_id,
    latest.content_type_label, latest.content_type_description
  FROM file f
  JOIN page p
    ON p.page_id = f.page_id
   AND p.site_id = f.site_id
   AND p.deleted_at IS NULL
  LEFT JOIN LATERAL (
    SELECT fr.revision_id, fr.content_type_label, fr.content_type_description
    FROM file_revision fr
    WHERE fr.site_id = f.site_id
      AND fr.page_id = f.page_id
      AND fr.file_id = f.file_id
    ORDER BY fr.revision_number DESC, fr.revision_id DESC
    LIMIT 1
  ) latest ON TRUE
  WHERE f.site_id = ${sqlBigint(siteId, 'siteId')}
    AND f.deleted_at IS NULL
)
SELECT json_build_object(
  'active_files', count(*),
  'missing_latest_revision', count(*) FILTER (WHERE revision_id IS NULL),
  'missing_descriptor', count(*) FILTER (
    WHERE revision_id IS NOT NULL
      AND content_type_label IS NULL
      AND content_type_description IS NULL
  ),
  'invalid_descriptor', count(*) FILTER (
    WHERE revision_id IS NOT NULL
      AND (
        (content_type_label IS NULL) <> (content_type_description IS NULL)
        OR (
          content_type_label IS NOT NULL
          AND content_type_description IS NOT NULL
          AND NOT (
            length(content_type_label) > 0
            AND length(content_type_description) > 0
            AND strpos(content_type_label, E'\\n') = 0
            AND strpos(content_type_label, E'\\r') = 0
            AND strpos(content_type_description, E'\\n') = 0
            AND strpos(content_type_description, E'\\r') = 0
          )
        )
      )
  ),
  'pending_blobs', (SELECT count(*) FROM blob_pending),
  'unmoved_pending_blobs', (SELECT count(*) FROM blob_pending WHERE s3_hash IS NULL),
  'moved_pending_blobs', (SELECT count(*) FROM blob_pending WHERE s3_hash IS NOT NULL),
  'moved_pending_missing_descriptor', (SELECT count(*) FROM blob_pending
    WHERE s3_hash IS NOT NULL
      AND (
        content_type_label IS NULL
        OR content_type_description IS NULL
      ))
)::text
FROM active_files;`;
}

export function parseFileDescriptorCompletion(output) {
  let value;
  try {
    value = JSON.parse(output.trim());
  } catch (error) {
    throw new Error(`invalid file descriptor completion JSON: ${error.message}`);
  }
  const completion = {};
  for (const field of ['active_files', 'missing_latest_revision', 'missing_descriptor', 'invalid_descriptor', 'pending_blobs', 'unmoved_pending_blobs', 'moved_pending_blobs', 'moved_pending_missing_descriptor']) {
    if (!Number.isSafeInteger(value[field]) || value[field] < 0) {
      throw new Error(`file descriptor completion ${field} must be a non-negative safe integer`);
    }
    completion[field] = value[field];
  }
  return completion;
}

function requireSafeInteger(value, field, lineNumber) {
  if (!Number.isSafeInteger(value)) {
    throw new Error(`line ${lineNumber}: ${field} must be a safe integer`);
  }
  return value;
}

export function parseFileDescriptorInventory(output) {
  const rows = [];
  for (const [index, line] of output.split(/\r?\n/u).map((value) => value.trim()).filter(Boolean).entries()) {
    const lineNumber = index + 1;
    let row;
    try {
      row = JSON.parse(line);
    } catch (error) {
      throw new Error(`line ${lineNumber}: invalid descriptor inventory JSON: ${error.message}`);
    }
    for (const field of ['page_id', 'page_category_id', 'file_id', 'revision_id', 'size']) {
      requireSafeInteger(row[field], field, lineNumber);
    }
    for (const field of ['fullname', 'filename']) {
      if (typeof row[field] !== 'string' || row[field].length === 0 || /\0/u.test(row[field])) {
        throw new Error(`line ${lineNumber}: ${field} must be a non-empty string`);
      }
    }
    if (row.size < 0) throw new Error(`line ${lineNumber}: size must be non-negative`);
    if (typeof row.s3_key_hex !== 'string' || !SHA512_RE.test(row.s3_key_hex)) {
      throw new Error(`line ${lineNumber}: s3_key_hex must be lowercase sha512 hex`);
    }
    rows.push(row);
  }
  return rows;
}

export function hashFileDescriptorInventory(inventory) {
  if (!Array.isArray(inventory)) throw new Error('inventory must be an array');
  const hash = crypto.createHash('sha256');
  for (const row of inventory) {
    hash.update(`${JSON.stringify([
      row.page_id,
      row.page_category_id,
      row.fullname,
      row.file_id,
      row.revision_id,
      row.filename,
      row.size,
      row.s3_key_hex,
    ])}\n`);
  }
  return hash.digest('hex');
}

function provenanceKey(fullname, filename, sha256) {
  return `${fullname}\0${filename}\0${sha256}`;
}

export function readCorpusFileDescriptorProvenance({ corpusRoot, branch, requestedFiles }) {
  const branchRoot = path.resolve(corpusRoot, branch);
  if (!Array.isArray(requestedFiles)) throw new Error('requestedFiles must be an array');
  const fullnames = new Set();
  const requestedKeys = new Set();
  for (const [index, requested] of requestedFiles.entries()) {
    if (requested === null || typeof requested !== 'object' || Array.isArray(requested)) {
      throw new Error(`requestedFiles[${index}] must be an object`);
    }
    for (const field of ['fullname', 'filename']) {
      if (typeof requested[field] !== 'string' || requested[field].length === 0 || /\0/u.test(requested[field])) {
        throw new Error(`requestedFiles[${index}].${field} must be a non-empty string`);
      }
    }
    if (path.basename(requested.fullname) !== requested.fullname || ['.', '..'].includes(requested.fullname)) {
      throw new Error(`requestedFiles[${index}].fullname is not a safe corpus page directory`);
    }
    if (typeof requested.sha256 !== 'string' || !SHA256_RE.test(requested.sha256)) {
      throw new Error(`requestedFiles[${index}].sha256 must be lowercase sha256 hex`);
    }
    const key = provenanceKey(requested.fullname, requested.filename, requested.sha256);
    if (requestedKeys.has(key)) throw new Error(`duplicate requested corpus descriptor ${requested.fullname}/${requested.filename}`);
    requestedKeys.add(key);
    fullnames.add(requested.fullname);
  }

  const entityByFullname = new Map();
  for (const fullname of fullnames) {
    const entityIdPath = path.join(branchRoot, 'pages', fullname, 'entity_id.txt');
    if (!fs.existsSync(entityIdPath)) continue;
    const entityId = fs.readFileSync(entityIdPath, 'utf8').trim();
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(entityId)) {
      throw new Error(`${entityIdPath}: corpus page entity ID is invalid`);
    }
    entityByFullname.set(fullname, entityId);
  }

  const provenance = new Map();
  for (const requested of requestedFiles) {
    const { fullname, filename, sha256 } = requested;
    const entityId = entityByFullname.get(fullname);
    if (entityId === undefined) continue;
    const snapshotsRoot = path.join(
      branchRoot,
      'by-uuid',
      entityId,
      'files',
      corpusFileStorageName(filename),
      'snapshots',
    );
    if (!fs.existsSync(snapshotsRoot)) continue;
    for (const snapshot of fs.readdirSync(snapshotsRoot, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!snapshot.isFile() || path.extname(snapshot.name) !== '.json') continue;
      const snapshotPath = path.join(snapshotsRoot, snapshot.name);
      const record = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
      const recordSha256 = typeof record?.bytes_sha256 === 'string'
        ? record.bytes_sha256.replace(/^sha256:/u, '').toLowerCase()
        : '';
      if (record?.filename !== filename || recordSha256 !== sha256) continue;
      const size = record?.metadata?.size;
      const mime = record?.metadata?.mime_type;
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new Error(`${snapshotPath}: corpus attachment size must be a non-negative safe integer`);
      }
      const description = record?.metadata?.mime_description;
      if (description === null || description === undefined) continue;
      const descriptor = descriptorFromDescription(description, snapshotPath);
      const key = provenanceKey(fullname, filename, sha256);
      const value = { ...descriptor, mime: typeof mime === 'string' && mime.length > 0 ? mime : null, size };
      const existing = provenance.get(key);
      if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(value)) {
        throw new Error(`${snapshotPath}: conflicting byte-matched descriptor provenance for ${fullname}/${filename}`);
      }
      provenance.set(key, value);
    }
  }
  return provenance;
}

function asBuffer(value, key) {
  if (value === null) throw new Error(`stored attachment object ${key} is missing`);
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new Error(`stored attachment object ${key} did not return bytes`);
}

export function preflightCorpusFileDescriptorMetadataBatch({ inventory, candidates }) {
  if (!Array.isArray(inventory)) throw new Error('inventory must be an array');
  if (!(candidates instanceof Map)) throw new Error('candidates must be a Map');
  let bytes = 0;
  let provenanceMatched = 0;
  let provenanceMissing = 0;
  for (const row of inventory) {
    bytes = addSafeInteger(bytes, row.size, 'descriptor preflight bytes');
    if (candidates.get(corpusCandidateKey(row.fullname, row.filename, row.size)) === true) {
      provenanceMatched += 1;
    } else {
      provenanceMissing += 1;
    }
  }
  return {
    rows: inventory.length,
    bytes,
    provenance_matched: provenanceMatched,
    provenance_missing: provenanceMissing,
  };
}

async function resolveCorpusFileDescriptorBatch({
  inventory,
  loadProvenance,
  getObject,
  concurrency = 16,
}) {
  if (!Array.isArray(inventory)) throw new Error('inventory must be an array');
  if (typeof loadProvenance !== 'function') throw new Error('loadProvenance must be a function');
  if (typeof getObject !== 'function') throw new Error('getObject must be a function');
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0) {
    throw new Error('concurrency must be a positive safe integer');
  }

  const objects = new Map();
  for (const row of inventory) {
    const existing = objects.get(row.s3_key_hex);
    if (existing !== undefined && existing.size !== row.size) {
      throw new Error(`${row.fullname}/${row.filename}: one stored object has conflicting sizes`);
    }
    if (existing === undefined) {
      objects.set(row.s3_key_hex, { size: row.size, rows: [row] });
    } else {
      existing.rows.push(row);
    }
  }
  const objectEntries = [...objects.entries()];
  async function runObjectWorkers(entries, callback) {
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < entries.length) {
        const index = nextIndex;
        nextIndex += 1;
        await callback(entries[index]);
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, entries.length) },
      () => worker(),
    ));
  }
  await runObjectWorkers(objectEntries, async ([key, object]) => {
      const bytes = asBuffer(await getObject(key), key);
      if (bytes.byteLength !== object.size) {
        throw new Error(`stored attachment object ${key} size mismatch: expected ${object.size}, got ${bytes.byteLength}`);
      }
      const actualKey = crypto.createHash('sha512').update(bytes).digest('hex');
      if (actualKey !== key) {
        throw new Error(`stored attachment object ${key} failed sha512 verification`);
      }
      object.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  });

  const requestedFiles = inventory.map((row) => ({
    fullname: row.fullname,
    filename: row.filename,
    sha256: objects.get(row.s3_key_hex).sha256,
  }));
  const provenance = await loadProvenance(requestedFiles);
  if (!(provenance instanceof Map)) throw new Error('loadProvenance must return a Map');

  const resolutions = inventory.map((row) => {
    const object = objects.get(row.s3_key_hex);
    const descriptor = provenance.get(provenanceKey(row.fullname, row.filename, object.sha256));
    return {
      row,
      object,
      descriptor,
      matched: descriptor !== undefined && descriptor.size === row.size,
    };
  });
  return { objects, resolutions };
}

export async function preflightCorpusFileDescriptorBatch(input) {
  const { resolutions } = await resolveCorpusFileDescriptorBatch(input);
  let bytes = 0;
  let provenanceMatched = 0;
  let provenanceMissing = 0;
  for (const resolution of resolutions) {
    bytes = addSafeInteger(bytes, resolution.row.size, 'descriptor byte preflight bytes');
    if (resolution.matched) provenanceMatched += 1;
    else provenanceMissing += 1;
  }
  return {
    rows: resolutions.length,
    bytes,
    provenance_matched: provenanceMatched,
    provenance_missing: provenanceMissing,
  };
}

export async function planCorpusFileDescriptorBackfill(input) {
  const { objects, resolutions } = await resolveCorpusFileDescriptorBatch(input);

  const provenanceBlockers = resolutions.filter((resolution) => !resolution.matched);
  if (provenanceBlockers.length > 0) {
    const sample = provenanceBlockers
      .slice(0, 5)
      .map(({ row }) => `${row.fullname}/${row.filename}`)
      .join(', ');
    const error = new Error(`${provenanceBlockers.length} active standing mirror file rows have no exact byte-matched corpus descriptor provenance; host libmagic fallback is disabled; sample: ${sample}`);
    error.fileDescriptorProvenanceBlockers = provenanceBlockers.length;
    throw error;
  }

  const attachments = [];
  const pages = new Map();
  const authority = { corpus_provenance: 0 };
  for (const { row, object, descriptor } of resolutions) {
    const sha256 = object.sha256;
    authority.corpus_provenance += 1;
    attachments.push({
      fullname: row.fullname,
      filename: row.filename,
      sha256,
      size: row.size,
      s3_key_hex: row.s3_key_hex,
      mime: descriptor.mime,
      content_type_label: descriptor.label,
      content_type_description: descriptor.description,
      replace_existing_descriptor: true,
    });
    const existingPage = pages.get(row.page_id);
    if (existingPage !== undefined && (
      existingPage.fullname !== row.fullname
      || existingPage.page_category_id !== row.page_category_id
    )) {
      throw new Error(`page ID ${row.page_id} has conflicting descriptor inventory identity`);
    }
    pages.set(row.page_id, {
      page_id: row.page_id,
      page_category_id: row.page_category_id,
      fullname: row.fullname,
    });
  }

  return {
    attachments,
    pages: [...pages.values()],
    unique_objects: objects.size,
    authority,
  };
}
