import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TEST_RUNTIME_IDENTITY = Object.freeze({
  schema: 'wikijump_syntax_differential.wikijump_runtime_identity.v1',
  wikijump_sha: '1'.repeat(40),
  ftml_sha: '2'.repeat(40),
  dependency_lock_sha256: '3'.repeat(64),
  executable_sha256: '4'.repeat(64),
  runtime_config_sha256: '5'.repeat(64),
});

export function requiredArgs(extra = [], { runtimeIdentity = '/srv/runtime-identity.json' } = {}) {
  return [
    '--corpus-root', '/srv/corpus',
    ...(runtimeIdentity === null ? [] : ['--runtime-identity', runtimeIdentity]),
    '--attachment-s3-endpoint', 'http://127.0.0.1:9000',
    '--attachment-s3-bucket', 'wikijump-files',
    '--attachment-s3-access-key-id', 'local-access',
    ...extra,
  ];
}

export function runtimeInspections({
  databaseContainer = 'fake-database',
  deepwellContainer = 'fake-deepwell',
  filesContainer = 'fake-files',
  deepwellImage = `sha256:${TEST_RUNTIME_IDENTITY.executable_sha256}`,
  deepwellHostPort = 12747,
  filesHostPort = 19000,
} = {}) {
  const labels = (role) => ({
    'com.docker.compose.project': 'wikijump-standing',
    'com.rokurolize.wikijump.role': role,
    'com.rokurolize.wikijump.sha': TEST_RUNTIME_IDENTITY.wikijump_sha,
    'com.rokurolize.wikijump.ftml_sha': TEST_RUNTIME_IDENTITY.ftml_sha,
  });
  const inspection = ({ name, role, id, image, port, hostPort, mounts = [] }) => ({
    Id: id.repeat(64),
    Image: image,
    Name: `/${name}`,
    Path: `/usr/local/bin/${role}`,
    Args: [],
    Config: {
      Image: `fixture/${role}:sealed`,
      Entrypoint: null,
      Cmd: null,
      Env: [`FIXTURE_ROLE=${role}`, 'RUNTIME_SECRET=must-not-leak'],
      WorkingDir: '/',
      User: '',
      Hostname: name,
      Healthcheck: {},
      ExposedPorts: { [port]: {} },
      Labels: labels(role),
    },
    HostConfig: {
      Binds: null,
      Mounts: null,
      NetworkMode: 'wikijump-standing_default',
      PortBindings: { [port]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }] },
    },
    NetworkSettings: {
      Ports: { [port]: [{ HostIp: '127.0.0.1', HostPort: String(hostPort) }] },
      Networks: {},
    },
    State: { Running: true, Status: 'running', Health: { Status: 'healthy' } },
    Mounts: mounts,
  });
  return {
    [databaseContainer]: inspection({
      name: databaseContainer,
      role: 'database',
      id: 'a',
      image: `sha256:${'6'.repeat(64)}`,
      port: '5432/tcp',
      hostPort: 15432,
      mounts: [{
        Type: 'volume',
        Name: 'runtime50x-postgres-data',
        Destination: '/var/lib/postgresql/data',
        RW: true,
      }],
    }),
    [deepwellContainer]: inspection({
      name: deepwellContainer,
      role: 'deepwell',
      id: 'b',
      image: deepwellImage,
      port: '2747/tcp',
      hostPort: deepwellHostPort,
      mounts: [{ Type: 'bind', Destination: '/etc/deepwell.toml', RW: false }],
    }),
    [filesContainer]: inspection({
      name: filesContainer,
      role: 'files',
      id: 'c',
      image: `sha256:${'7'.repeat(64)}`,
      port: '9000/tcp',
      hostPort: filesHostPort,
      mounts: [{ Type: 'volume', Name: 'runtime50x-files-data', Destination: '/data', RW: true }],
    }),
  };
}

export function runtimeArgs(identityPath, { deepwellHostPort = 12747, filesHostPort = 19000 } = {}) {
  return [
    '--runtime-identity', identityPath,
    '--deepwell-container', 'fake-deepwell',
    '--files-container', 'fake-files',
    '--api-url', `http://127.0.0.1:${deepwellHostPort}/jsonrpc`,
    '--attachment-s3-endpoint', `http://127.0.0.1:${filesHostPort}`,
  ];
}

function corpusStorageName(filename) {
  const digest = crypto.createHash('sha256').update(filename).digest('hex').slice(0, 20);
  const suffix = filename.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^[._]+|[._]+$/gu, '') || 'file';
  return `${digest}-${suffix.slice(0, 80)}`;
}

export function writeCompleteCorpus(root, bytes) {
  const fullname = 'scp-049';
  const filename = 'fixture.bin';
  const entityId = '11111111-1111-4111-8111-111111111111';
  const branchRoot = path.join(root, 'corpus', 'en');
  const pageRoot = path.join(branchRoot, 'pages', fullname);
  const snapshotRoot = path.join(
    branchRoot,
    'by-uuid',
    entityId,
    'files',
    corpusStorageName(filename),
    'snapshots',
  );
  fs.mkdirSync(pageRoot, { recursive: true });
  fs.mkdirSync(snapshotRoot, { recursive: true });
  fs.writeFileSync(path.join(branchRoot, 'index.json'), '{}\n');
  fs.writeFileSync(path.join(pageRoot, 'entity_id.txt'), `${entityId}\n`);
  fs.writeFileSync(path.join(snapshotRoot, 'snapshot.json'), JSON.stringify({
    bytes_sha256: `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`,
    filename,
    metadata: {
      mime_description: 'ASCII text, with no line terminators',
      mime_type: 'text/plain',
      size: bytes.byteLength,
    },
    page: fullname,
  }));
  return { branchRoot, filename, fullname };
}

export function startFakeRuntimeServer(root, bytes) {
  const serverPath = path.join(root, 'fake-runtime-server.cjs');
  fs.writeFileSync(serverPath, `
const http = require('node:http');
const bytes = Buffer.from(process.env.FAKE_OBJECT_BASE64, 'base64');
const objectServer = http.createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  response.writeHead(200, {'content-length': String(bytes.byteLength)});
  response.end(bytes);
});
const rpcServer = http.createServer((request, response) => {
  request.resume();
  request.on('end', () => {
    const body = JSON.stringify({jsonrpc: '2.0', id: 1, result: {}});
    response.writeHead(200, {'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body))});
    response.end(body);
  });
});
Promise.all([
  new Promise((resolve) => objectServer.listen(0, '127.0.0.1', resolve)),
  new Promise((resolve) => rpcServer.listen(0, '127.0.0.1', resolve)),
]).then(() => {
  process.stdout.write(JSON.stringify({
    files: objectServer.address().port,
    deepwell: rpcServer.address().port,
  }) + '\\n');
});
process.on('SIGTERM', () => {
  objectServer.close();
  rpcServer.close(() => process.exit(0));
});
`);
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, FAKE_OBJECT_BASE64: bytes.toString('base64') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const newline = stdout.indexOf('\n');
      if (newline === -1) return;
      resolve({ child, ports: JSON.parse(stdout.slice(0, newline)) });
    });
    child.once('exit', (code) => reject(new Error(`fake runtime server exited ${code}: ${stderr}`)));
  });
}

export function fakeDockerSource(sqlBody = '') {
  return `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'inspect') {
  let inspections = JSON.parse(process.env.FAKE_DOCKER_INSPECTIONS);
  if (process.env.FAKE_DOCKER_INSPECT_COUNT) {
    const countPath = process.env.FAKE_DOCKER_INSPECT_COUNT;
    fs.appendFileSync(countPath, 'x');
    const count = fs.statSync(countPath).size;
    if (count > 3 && process.env.FAKE_DOCKER_INSPECTIONS_AFTER) {
      inspections = JSON.parse(process.env.FAKE_DOCKER_INSPECTIONS_AFTER);
    }
  }
  const inspection = inspections[args.at(-1)];
  if (!inspection) throw new Error('unexpected docker inspect target: ' + args.at(-1));
  process.stdout.write(JSON.stringify([inspection]) + '\\n');
  process.exit(0);
}
const sql = fs.readFileSync(0, 'utf8');
${sqlBody}
`;
}
