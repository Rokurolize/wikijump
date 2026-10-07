import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

export const DEEPWELL_RUNTIME_HEADERS = Object.freeze({
  sourceSha256: 'x-theme-lab-backend-source-sha',
  ftmlGitRevision: 'x-theme-lab-backend-ftml-git-revision',
  containerId: 'x-theme-lab-backend-container-id',
  imageId: 'x-theme-lab-backend-image-id',
  binarySha256: 'x-theme-lab-backend-binary-sha',
  configSha256: 'x-theme-lab-backend-config-sha',
  identitySha256: 'x-theme-lab-backend-identity-sha',
});

const HASH = /^[a-f0-9]{64}$/u;
const GIT_REVISION = /^[a-f0-9]{40}$/u;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/u;
const SOURCE_ENTRIES = [
  'deepwell/src',
  'deepwell/relation-impl-derive',
  'deepwell/migrations',
  'deepwell/seeder',
  'deepwell/Cargo.toml',
  'deepwell/Cargo.lock',
  'deepwell/build.rs',
  'deepwell/askama.toml',
  '.cargo/config.toml',
  'locales',
  'install/local/deepwell/Dockerfile',
  'install/local/deepwell/config.toml',
  'install/local/deepwell/deepwell-start',
  'install/common/deepwell/health-check.sh',
];

const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function filesBelow(entry) {
  const stat = fs.lstatSync(entry);
  if (stat.isSymbolicLink()) throw new Error(`Deepwell fingerprint input cannot be a symlink: ${entry}`);
  if (stat.isFile()) return [entry];
  if (!stat.isDirectory()) throw new Error(`Deepwell fingerprint input is not a regular file or directory: ${entry}`);
  const files = [];
  for (const item of fs.readdirSync(entry, {withFileTypes: true})) {
    const child = path.join(entry, item.name);
    if (item.isSymbolicLink()) throw new Error(`Deepwell fingerprint input cannot be a symlink: ${child}`);
    if (item.isDirectory()) files.push(...filesBelow(child));
    else if (item.isFile()) files.push(child);
  }
  return files;
}

export function deepwellRuntimeSourceIdentity(repoRoot) {
  const root = path.resolve(repoRoot);
  const files = [];
  for (const relative of SOURCE_ENTRIES) {
    const absolute = path.join(root, relative);
    try { files.push(...filesBelow(absolute)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  files.sort();
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file));
    hash.update('\0');
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  const cargoLock = fs.readFileSync(path.join(root, 'deepwell/Cargo.lock'), 'utf8');
  const ftml = cargoLock.match(/name = "ftml"[\s\S]*?source = "git\+[^"#]+#([a-f0-9]{40})"/u);
  if (!ftml) throw new Error('Deepwell Cargo.lock does not pin an FTML git revision');
  return {source_sha256: hash.digest('hex'), ftml_git_revision: ftml[1], inputs: files.length};
}

export function readRunningDeepwellRuntimeIdentity(repoRoot, {containerName = 'wikijump-local-development-deepwell-1'} = {}) {
  const root = path.resolve(repoRoot);
  const inspect = JSON.parse(execFileSync('docker', ['inspect', containerName, '--format', '{{json .}}'], {encoding: 'utf8'}).trim());
  if (inspect.Config?.Labels?.['com.docker.compose.project'] !== 'wikijump-local-development' ||
      inspect.Config?.Labels?.['com.docker.compose.service'] !== 'deepwell')
    throw new Error('running backend is not the expected local-development Deepwell service');
  const expectedMounts = new Map([
    ['/src/deepwell/src', path.join(root, 'deepwell/src')],
    ['/src/deepwell/build.rs', path.join(root, 'deepwell/build.rs')],
    ['/src/deepwell/Cargo.toml', path.join(root, 'deepwell/Cargo.toml')],
    ['/src/deepwell/Cargo.lock', path.join(root, 'deepwell/Cargo.lock')],
    ['/src/deepwell/askama.toml', path.join(root, 'deepwell/askama.toml')],
    ['/src/deepwell/migrations', path.join(root, 'deepwell/migrations')],
    ['/src/deepwell/seeder', path.join(root, 'deepwell/seeder')],
    ['/src/.cargo/config.toml', path.join(root, '.cargo/config.toml')],
    ['/src/install', path.join(root, 'install')],
    ['/opt/locales', path.join(root, 'locales')],
  ]);
  const mounts = new Map((inspect.Mounts ?? []).map(mount => [mount.Destination, path.resolve(mount.Source)]));
  for (const [destination, expected] of expectedMounts)
    if (mounts.get(destination) !== expected) throw new Error(`Deepwell source mount is not from the current checkout: ${destination}`);
  const binaryScript = "set -eu; for comm in /proc/[0-9]*/comm; do IFS= read -r name < \"$comm\" || continue; if [ \"$name\" = deepwell ]; then pid=${comm#/proc/}; pid=${pid%/comm}; sha256sum \"/proc/$pid/exe\" | cut -d' ' -f1; exit 0; fi; done; exit 44";
  const binarySha = execFileSync('docker', ['exec', containerName, 'sh', '-ec', binaryScript], {encoding: 'utf8'}).trim();
  const configSha = execFileSync('docker', ['exec', containerName, 'sha256sum', '/etc/deepwell.toml'], {encoding: 'utf8'}).trim().split(/\s+/u)[0];
  const source = deepwellRuntimeSourceIdentity(root);
  const network = Object.entries(inspect.NetworkSettings?.Networks ?? []).find(([, value]) => (value.Aliases ?? []).includes('deepwell'));
  if (!network) throw new Error('current Deepwell container does not own the expected deepwell Docker alias');
  return {
    identity: createDeepwellRuntimeIdentity({source_sha256: source.source_sha256, ftml_git_revision: source.ftml_git_revision,
      container_id: inspect.Id, image_id: inspect.Image, binary_sha256: binarySha, config_sha256: configSha}),
    network: network[0],
    ip: network[1].IPAddress,
    container: inspect,
    source_inputs: source.inputs,
  };
}

function identityContent({source_sha256, ftml_git_revision, container_id, image_id, binary_sha256, config_sha256}) {
  return {
    schema: 'wikijump_deepwell_runtime_identity.v1',
    source_sha256,
    ftml_git_revision,
    container_id,
    image_id,
    binary_sha256,
    config_sha256,
  };
}

export function createDeepwellRuntimeIdentity(values) {
  const content = identityContent(values);
  if (!HASH.test(content.source_sha256 ?? '')) throw new Error('Deepwell source fingerprint is invalid');
  if (!GIT_REVISION.test(content.ftml_git_revision ?? '')) throw new Error('Deepwell FTML revision is invalid');
  if (!/^[a-f0-9]{64}$/u.test(content.container_id ?? '')) throw new Error('Deepwell container id is invalid');
  if (!IMAGE_ID.test(content.image_id ?? '')) throw new Error('Deepwell image id is invalid');
  if (!HASH.test(content.binary_sha256 ?? '')) throw new Error('Deepwell running binary SHA-256 is invalid');
  if (!HASH.test(content.config_sha256 ?? '')) throw new Error('Deepwell active config SHA-256 is invalid');
  return {...content, identity_sha256: sha(JSON.stringify(content))};
}

export function requireDeepwellRuntimeIdentity(value, label = 'run contract') {
  let calculated;
  try { calculated = createDeepwellRuntimeIdentity(value ?? {}); }
  catch (error) { throw new Error(`${label} needs a complete current expected_backend_runtime_identity: ${error.message}`); }
  if (value?.schema !== calculated.schema || value?.identity_sha256 !== calculated.identity_sha256)
    throw new Error(`${label} expected_backend_runtime_identity SHA-256 is invalid`);
  return value;
}

export function assertDeepwellRuntimeIdentity(expectedValue, actualValue, context = 'runtime response') {
  const expected = requireDeepwellRuntimeIdentity(expectedValue, 'run contract');
  let actual;
  try { actual = requireDeepwellRuntimeIdentity(actualValue, context); }
  catch (error) { throw new Error(`${context} ${error.message}`); }
  if (actual.identity_sha256 !== expected.identity_sha256)
    throw new Error(`${context} Deepwell runtime identity ${actual.identity_sha256} does not match run contract ${expected.identity_sha256}`);
  return actual;
}

export function deepwellRuntimeIdentityFromHeaders(headers) {
  const get = name => {
    const key = DEEPWELL_RUNTIME_HEADERS[name];
    if (typeof headers?.get === 'function') return headers.get(key)?.trim().toLowerCase() ?? null;
    for (const [header, value] of Object.entries(headers ?? {}))
      if (header.toLowerCase() === key && typeof value === 'string') return value.trim().toLowerCase();
    return null;
  };
  const values = {
    source_sha256: get('sourceSha256'),
    ftml_git_revision: get('ftmlGitRevision'),
    container_id: get('containerId'),
    image_id: get('imageId'),
    binary_sha256: get('binarySha256'),
    config_sha256: get('configSha256'),
  };
  const identitySha = get('identitySha256');
  if (Object.values(values).some(value => value === null) || identitySha === null) return null;
  const actual = createDeepwellRuntimeIdentity(values);
  return actual.identity_sha256 === identitySha ? actual : {...actual, identity_sha256: identitySha};
}

export function parseCurlDeepwellRuntimeHeaders(rawHeaders) {
  const blocks = [];
  let current = null;
  for (const line of String(rawHeaders).split(/\r?\n/u)) {
    const status = line.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/iu);
    if (status) {
      current = {status: Number(status[1]), headers: {}};
      blocks.push(current);
      continue;
    }
    const header = line.match(/^([^:]+):\s*(.*?)\s*$/u);
    if (current && header) current.headers[header[1].trim().toLowerCase()] = header[2].trim();
  }
  const response = blocks.at(-1);
  if (!response || response.status < 200 || response.status >= 300)
    throw new Error(`backend runtime fixture probe returned HTTP ${response?.status ?? 'without a status'}`);
  return {status: response.status, backendRuntimeIdentity: deepwellRuntimeIdentityFromHeaders(response.headers)};
}

export function deepwellRuntimeIdentityMatchesContract(row, runContract) {
  try {
    const expected = requireDeepwellRuntimeIdentity(runContract?.expected_backend_runtime_identity, 'run contract');
    const actual = requireDeepwellRuntimeIdentity(row?.backend_runtime_identity, 'browser record');
    return actual.identity_sha256 === expected.identity_sha256;
  } catch { return false; }
}
