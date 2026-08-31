import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { validateRuntimeIdentity } from './saved-page-runtime-differential.mjs';
import { sha256Value } from './standing-browser-parity-util.mjs';
import { effectiveRuntimeServicesSha256 } from './standing-browser-runtime-identity.mjs';

const execFileAsync = promisify(execFile);
const CONTAINER_ID = /^[0-9a-f]{64}$/u;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/u;
const PROJECT_NAME = 'wikijump-standing';
const RUNTIME_BINDING_SCHEMA = 'wikijump.corpus_file_descriptor_backfill_runtime_binding.v1';
const RUNTIME_IDENTITY_FIELDS = Object.freeze([
  'schema',
  'wikijump_sha',
  'ftml_sha',
  'dependency_lock_sha256',
  'executable_sha256',
  'runtime_config_sha256',
]);
const RUNTIME_LABELS = Object.freeze({
  project: 'com.docker.compose.project',
  role: 'com.rokurolize.wikijump.role',
  wikijumpSha: 'com.rokurolize.wikijump.sha',
  ftmlSha: 'com.rokurolize.wikijump.ftml_sha',
});

function requireObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be a JSON object`);
  }
  return value;
}

function normalizedIdentity(value) {
  const identity = validateRuntimeIdentity(requireObject(value, 'runtime identity'));
  const fields = Object.keys(identity).sort();
  if (JSON.stringify(fields) !== JSON.stringify([...RUNTIME_IDENTITY_FIELDS].sort())) {
    throw new Error('runtime identity must contain only the supported sealed fields');
  }
  return Object.freeze(Object.fromEntries(
    RUNTIME_IDENTITY_FIELDS.map((field) => [field, identity[field]]),
  ));
}

export function readFileDescriptorRuntimeIdentity(identityPath) {
  const absolutePath = path.resolve(identityPath);
  const bytes = fs.readFileSync(absolutePath);
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${absolutePath}: invalid runtime identity JSON: ${error.message}`);
  }
  return Object.freeze({
    path: absolutePath,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    identity: normalizedIdentity(value),
  });
}

async function dockerInspectContainer(container) {
  const { stdout } = await execFileAsync(
    'docker',
    ['inspect', '--type', 'container', '--', container],
    { encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const value = JSON.parse(stdout);
  if (!Array.isArray(value) || value.length !== 1) {
    throw new Error(`docker inspect did not return exactly one container for ${container}`);
  }
  return requireObject(value[0], `Docker inspection for ${container}`);
}

function requireContainer(inspect, selector, role, identity) {
  const containerId = inspect.Id;
  const imageId = inspect.Image;
  const name = typeof inspect.Name === 'string' ? inspect.Name.replace(/^\//u, '') : '';
  if (!CONTAINER_ID.test(containerId ?? '')) {
    throw new Error(`${role} container ID is not an immutable Docker ID`);
  }
  if (!IMAGE_ID.test(imageId ?? '')) {
    throw new Error(`${role} image is not an immutable Docker image ID`);
  }
  if (selector !== containerId && selector !== name) {
    throw new Error(`${role} Docker inspection does not match the requested container`);
  }
  if (inspect.State?.Running !== true || inspect.State?.Health?.Status !== 'healthy') {
    throw new Error(`${role} container is not running and healthy`);
  }
  const labels = requireObject(inspect.Config?.Labels, `${role} container labels`);
  for (const [label, expected] of [
    [RUNTIME_LABELS.project, PROJECT_NAME],
    [RUNTIME_LABELS.role, role],
    [RUNTIME_LABELS.wikijumpSha, identity.wikijump_sha],
    [RUNTIME_LABELS.ftmlSha, identity.ftml_sha],
  ]) {
    if (labels[label] !== expected) {
      throw new Error(`${role} container label ${label} does not match the sealed runtime identity`);
    }
  }
  return { container_id: containerId, container_name: name, image_id: imageId };
}

function loopbackUrl(value, name, expectedPath) {
  const url = new URL(value);
  if (
    url.protocol !== 'http:'
    || url.username
    || url.password
    || url.search
    || url.hash
    || !['127.0.0.1', 'localhost', '::1'].includes(url.hostname)
    || url.pathname !== expectedPath
  ) {
    throw new Error(`${name} must be an unauthenticated loopback HTTP URL with path ${expectedPath}`);
  }
  const port = Number(url.port || 80);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} port is invalid`);
  }
  return { url: url.href, hostname: url.hostname, port };
}

function exactPublishedBinding(inspect, role, containerPort, expectedUrl = null) {
  const ports = requireObject(inspect.NetworkSettings?.Ports, `${role} published ports`);
  const bindings = ports[containerPort];
  if (!Array.isArray(bindings) || bindings.length !== 1) {
    throw new Error(`${role} must have exactly one ${containerPort} publication`);
  }
  const binding = requireObject(bindings[0], `${role} ${containerPort} publication`);
  const hostPort = Number(binding.HostPort);
  if (
    !['127.0.0.1', '::1'].includes(binding.HostIp)
    || !Number.isSafeInteger(hostPort)
    || hostPort < 1
    || hostPort > 65_535
  ) {
    throw new Error(`${role} ${containerPort} must publish exactly one loopback port`);
  }
  if (expectedUrl !== null) {
    const expectedHost = expectedUrl.hostname === 'localhost' ? '127.0.0.1' : expectedUrl.hostname;
    if (binding.HostIp !== expectedHost || hostPort !== expectedUrl.port) {
      throw new Error(`${role} ${containerPort} does not own ${expectedUrl.url}`);
    }
  }
  return Object.freeze({
    container_port: containerPort,
    host_address: binding.HostIp,
    host_port: hostPort,
  });
}

function exactMount(inspect, role, expected) {
  const mounts = Array.isArray(inspect.Mounts) ? inspect.Mounts : [];
  const matching = mounts.filter((mount) => mount?.Destination === expected.destination);
  if (
    matching.length !== 1
    || matching[0].Type !== expected.type
    || matching[0].RW !== expected.rw
    || (expected.name !== undefined && matching[0].Name !== expected.name)
  ) {
    throw new Error(`${role} mount at ${expected.destination} does not match the standing runtime contract`);
  }
  return Object.freeze({
    type: expected.type,
    ...(expected.name === undefined ? {} : { name: expected.name }),
    destination: expected.destination,
    read_only: !expected.rw,
  });
}

export async function observeFileDescriptorRuntimeBinding({
  runtimeIdentity,
  databaseContainer,
  deepwellContainer,
  filesContainer,
  apiUrl,
  s3Endpoint,
  inspectContainer = dockerInspectContainer,
}) {
  const identity = normalizedIdentity(runtimeIdentity);
  const rpcEndpoint = loopbackUrl(apiUrl, 'Deepwell API URL', '/jsonrpc');
  const objectEndpoint = loopbackUrl(s3Endpoint, 'attachment S3 endpoint', '/');
  const [databaseInspect, deepwellInspect, filesInspect] = await Promise.all([
    inspectContainer(databaseContainer),
    inspectContainer(deepwellContainer),
    inspectContainer(filesContainer),
  ]);
  const database = requireContainer(databaseInspect, databaseContainer, 'database', identity);
  const deepwell = requireContainer(deepwellInspect, deepwellContainer, 'deepwell', identity);
  const files = requireContainer(filesInspect, filesContainer, 'files', identity);
  if (deepwell.image_id !== `sha256:${identity.executable_sha256}`) {
    throw new Error('Deepwell image does not match the sealed runtime identity');
  }
  const effectiveServicesConfigSha256 = effectiveRuntimeServicesSha256([
    databaseInspect,
    deepwellInspect,
    filesInspect,
  ]);
  if (effectiveServicesConfigSha256 !== identity.runtime_config_sha256) {
    throw new Error('Runtime service configuration does not match the sealed runtime identity');
  }
  const binding = Object.freeze({
    schema: RUNTIME_BINDING_SCHEMA,
    project_name: PROJECT_NAME,
    runtime_config_sha256: identity.runtime_config_sha256,
    effective_services_config_sha256: effectiveServicesConfigSha256,
    services: {
      database: {
        ...database,
        published_binding: exactPublishedBinding(databaseInspect, 'database', '5432/tcp'),
        volume: exactMount(databaseInspect, 'database', {
          type: 'volume',
          name: 'runtime50x-postgres-data',
          destination: '/var/lib/postgresql/data',
          rw: true,
        }),
      },
      deepwell: {
        ...deepwell,
        api_url: rpcEndpoint.url,
        published_binding: exactPublishedBinding(deepwellInspect, 'deepwell', '2747/tcp', rpcEndpoint),
        config_mount: exactMount(deepwellInspect, 'deepwell', {
          type: 'bind',
          destination: '/etc/deepwell.toml',
          rw: false,
        }),
      },
      files: {
        ...files,
        endpoint: objectEndpoint.url,
        published_binding: exactPublishedBinding(filesInspect, 'files', '9000/tcp', objectEndpoint),
        volume: exactMount(filesInspect, 'files', {
          type: 'volume',
          name: 'runtime50x-files-data',
          destination: '/data',
          rw: true,
        }),
      },
    },
  });
  return Object.freeze({ ...binding, binding_sha256: sha256Value(binding) });
}

export function assertFileDescriptorRuntimeBinding(expected, observed) {
  if (sha256Value(expected) !== sha256Value(observed)) {
    throw new Error('standing runtime binding changed after the backfill receipt was sealed');
  }
  return observed;
}
