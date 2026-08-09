import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  materializeCorpusRowAttachments,
  readCorpusAttachmentBytes,
  rerenderDirectCorpusAttachmentPages,
} from '../src/corpus-import-attachments.mjs';

function attachmentFixture(bytes = Buffer.from('fixture attachment')) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wikijump-corpus-attachment-'));
  const filePath = path.join(directory, 'fixture.txt');
  fs.writeFileSync(filePath, bytes);
  return {
    cleanup() {
      fs.rmSync(directory, { recursive: true, force: true });
    },
    row: { fullname: 'scp-173' },
    attachment: {
      filename: 'fixture.txt',
      file_path: filePath,
      size: bytes.byteLength,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

test('readCorpusAttachmentBytes verifies file bytes against corpus metadata', () => {
  const fixture = attachmentFixture();
  try {
    assert.deepEqual(readCorpusAttachmentBytes(fixture.row, fixture.attachment), Buffer.from('fixture attachment'));
    assert.throws(
      () => readCorpusAttachmentBytes(fixture.row, { ...fixture.attachment, size: 1 }),
      /attachment size mismatch/,
    );
  } finally {
    fixture.cleanup();
  }
});

test('materializeCorpusRowAttachments defers skipped attachments without RPC work', async () => {
  const result = await materializeCorpusRowAttachments({
    args: { skipAttachments: true },
    row: { fullname: 'scp-173', attachments: [{ filename: 'fixture.txt' }] },
    pageId: 173,
    getFile: async () => assert.fail('getFile must not run for deferred attachments'),
    rpc: async () => assert.fail('rpc must not run for deferred attachments'),
  });

  assert.deepEqual(result, {
    attachments_requested: 1,
    attachments_uploaded: 0,
    attachments_skipped_existing: 0,
    attachments_deferred: 1,
  });
});

test('materializeCorpusRowAttachments binds pending uploads to the trusted page context', async (t) => {
  const fixture = attachmentFixture();
  t.after(() => fixture.cleanup());

  let uploaded = Buffer.alloc(0);
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      uploaded = Buffer.concat(chunks);
      response.writeHead(200).end();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const calls = [];
  const rpc = async (_args, method, params, requestContext) => {
    calls.push({ method, params, requestContext });
    if (method === 'blob_upload') {
      return {
        pending_blob_id: 'issue-1062-pending',
        presign_url: `http://127.0.0.1:${address.port}/pending`,
      };
    }
    if (method === 'file_create') return { file_id: 1062 };
    assert.fail(`unexpected RPC method ${method}`);
  };

  const result = await materializeCorpusRowAttachments({
    args: {
      sessionToken: 'issue-1062-session',
      siteId: 17,
      userId: 29,
      ipAddress: '192.0.2.62',
      rpcTimeoutMs: 1_000,
    },
    row: { ...fixture.row, attachments: [fixture.attachment] },
    pageId: 23,
    getFile: async () => null,
    rpc,
  });

  assert.deepEqual(result, {
    attachments_requested: 1,
    attachments_uploaded: 1,
    attachments_skipped_existing: 0,
  });
  assert.deepEqual(uploaded, Buffer.from('fixture attachment'));
  assert.deepEqual(calls[0], {
    method: 'blob_upload',
    params: { user_id: 29, blob_size: 18, scope: 'page' },
    requestContext: { siteId: 17, pageRef: 23 },
  });
  assert.equal(calls[1].method, 'file_create');
  assert.deepEqual(calls[1].requestContext, { siteId: 17, pageRef: 23 });
});

test('materializeCorpusRowAttachments cancels once after a presigned PUT failure', async (t) => {
  const fixture = attachmentFixture();
  t.after(() => fixture.cleanup());

  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => response.writeHead(503).end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const calls = [];
  const rpc = async (_args, method, params, requestContext) => {
    calls.push({ method, params, requestContext });
    if (method === 'blob_upload') {
      return {
        pending_blob_id: 'issue-1062-put-failure',
        presign_url: `http://127.0.0.1:${address.port}/pending`,
      };
    }
    if (method === 'blob_cancel') return null;
    assert.fail(`unexpected RPC method ${method}`);
  };

  await assert.rejects(
    materializeCorpusRowAttachments({
      args: {
        sessionToken: 'issue-1062-session',
        siteId: 17,
        userId: 29,
        ipAddress: '192.0.2.62',
        rpcTimeoutMs: 1_000,
      },
      row: { ...fixture.row, attachments: [fixture.attachment] },
      pageId: 23,
      getFile: async () => null,
      rpc,
    }),
    /presigned PUT failed with status 503/,
  );

  assert.deepEqual(calls, [
    {
      method: 'blob_upload',
      params: { user_id: 29, blob_size: 18, scope: 'page' },
      requestContext: { siteId: 17, pageRef: 23 },
    },
    {
      method: 'blob_cancel',
      params: { user_id: 29, pending_blob_id: 'issue-1062-put-failure' },
      requestContext: { siteId: 17, pageRef: 23 },
    },
  ]);
});

test('materializeCorpusRowAttachments preserves file_create failure when cleanup fails', async (t) => {
  const fixture = attachmentFixture();
  t.after(() => fixture.cleanup());

  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => response.writeHead(200).end());
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const address = server.address();
  assert.equal(typeof address, 'object');

  const commitError = new Error('file_create commit sentinel');
  const cancelError = new Error('blob_cancel cleanup sentinel');
  const calls = [];
  let cancelCount = 0;
  const rpc = async (_args, method, params, requestContext) => {
    calls.push({ method, params, requestContext });
    if (method === 'blob_upload') {
      return {
        pending_blob_id: 'issue-1062-commit-failure',
        presign_url: `http://127.0.0.1:${address.port}/pending`,
      };
    }
    if (method === 'file_create') throw commitError;
    if (method === 'blob_cancel') {
      cancelCount += 1;
      throw cancelError;
    }
    assert.fail(`unexpected RPC method ${method}`);
  };

  await assert.rejects(
    materializeCorpusRowAttachments({
      args: {
        sessionToken: 'issue-1062-session',
        siteId: 17,
        userId: 29,
        ipAddress: '192.0.2.62',
        rpcTimeoutMs: 1_000,
      },
      row: { ...fixture.row, attachments: [fixture.attachment] },
      pageId: 23,
      getFile: async () => null,
      rpc,
    }),
    (error) => error === commitError,
  );

  assert.equal(cancelCount, 1);
  assert.deepEqual(
    calls.map(({ method }) => method),
    ['blob_upload', 'file_create', 'blob_cancel'],
  );
  assert.deepEqual(calls[2], {
    method: 'blob_cancel',
    params: { user_id: 29, pending_blob_id: 'issue-1062-commit-failure' },
    requestContext: { siteId: 17, pageRef: 23 },
  });
});

test('rerenderDirectCorpusAttachmentPages refreshes each page whose saved file rows changed', async () => {
  const pages = new Map([
    ['scp-173', { page_id: 173, page_category_id: 17 }],
    ['scp-174', { page_id: 174, page_category_id: 17 }],
  ]);
  const rerendered = [];
  const result = await rerenderDirectCorpusAttachmentPages({
    skipRerender: false,
    stagingRows: [
      { action: 'insert', fullname: 'scp-173', page_id: 173 },
      { action: 'insert', fullname: 'scp-173', page_id: 173 },
      { action: 'backfill_descriptor', fullname: 'scp-174', page_id: 174 },
      { action: 'replace_descriptor', fullname: 'scp-174', page_id: 174 },
      { action: 'skip_existing', fullname: 'scp-175', page_id: 175 },
    ],
    getPage: async (fullname) => pages.get(fullname) ?? null,
    rerenderPage: async (pageId, categoryId) => rerendered.push({ pageId, categoryId }),
  });

  assert.deepEqual(result, { attachment_direct_pages_rerendered: 2 });
  assert.deepEqual(rerendered, [
    { pageId: 173, categoryId: 17 },
    { pageId: 174, categoryId: 17 },
  ]);

  await assert.rejects(
    rerenderDirectCorpusAttachmentPages({
      skipRerender: false,
      stagingRows: [{ action: 'insert', fullname: 'scp-173', page_id: 999 }],
      getPage: async () => pages.get('scp-173'),
      rerenderPage: async () => assert.fail('mismatched page must not rerender'),
    }),
    /page identity mismatch/,
  );
});
