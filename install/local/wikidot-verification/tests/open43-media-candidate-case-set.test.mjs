import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CandidateHttpSession,
  requestCandidateCaseHttp,
} from "../src/candidate-case-http.mjs";
import { runCandidateCaseSet } from "../src/candidate-case-runner.mjs";
import {
  OPEN43_MEDIA_CASE_IDS,
  createOpen43MediaCandidateCaseSet,
} from "../src/open43-media-candidate-case-set.mjs";
import { sha256Value } from "../src/standing-browser-parity-util.mjs";

const hash = (character) => character.repeat(64);
const git = (character) => character.repeat(40);
const INITIAL_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC",
  "base64",
);
function candidateIdentity() {
  return {
    schema: "wikijump.standing_candidate_parity_identity.v1",
    status: "sealed",
    artifact_key: hash("a"),
    build: {
      seal_sha256: hash("b"),
      verdict_sha256: hash("c"),
      final_images_sha256: hash("d"),
    },
    candidate: {
      owner: "open43-media-fixture",
      expires_at: "2099-08-10T00:00:00.000Z",
      compose_project: "wikijump-open43-media-fixture",
      port_443_published: false,
      wikijump_commit: git("1"),
      wikijump_tree: git("2"),
      ftml_sha: git("3"),
      profile: "production-build",
      source_clean: true,
      images: {
        caddy: `sha256:${hash("4")}`,
        deepwell: `sha256:${hash("5")}`,
        files: `sha256:${hash("6")}`,
      },
      config: {
        isolated_overlay_sha256: hash("7"),
        promotion_base_manifest_sha256: hash("8"),
        effective_runtime_services_sha256: hash("9"),
      },
      endpoint: {
        scheme: "https",
        host: "scpaiueouiuiuiui.wikijump.localhost",
        port: 18443,
        resolved_addresses: ["127.0.0.1"],
        allowed_origin_set: [
          "https://scpaiueouiuiuiui.wikijump.localhost:18443",
          "https://scpaiueouiuiuiui.wjfiles.localhost:18443",
        ],
        local_connect_address: "127.0.0.1",
      },
    },
    evidence: {
      status: "sealed",
      manifest_sha256: hash("a"),
      seal_sha256: hash("b"),
    },
  };
}

function sha512(bytes) {
  return createHash("sha512").update(bytes).digest("hex");
}

function actionResult(type, status) {
  return JSON.stringify({ type, status, data: '[{"form":1},{}]' });
}

async function requestForm(request) {
  const webRequest = new Request(`http://fixture.invalid${request.url}`, {
    method: request.method,
    headers: request.headers,
    body: request,
    duplex: "half",
  });
  return await webRequest.formData();
}

async function createFakeCandidate({
  staleRevisionBytes = false,
  prematureVisibility = false,
  failPresignedPut = false,
  ambiguousPageCreate = false,
  ambiguousReplacement = false,
} = {}) {
  const state = {
    page: null,
    pending: new Map(),
    files: new Map(),
    nextFileId: 40,
    nextRevisionId: 50,
    cancelled: [],
    presignedPutFailed: false,
  };

  function row(file) {
    return {
      file_id: file.file_id,
      file_created_at: "2026-08-10T00:00:00Z",
      file_updated_at: null,
      file_deleted_at: null,
      page_id: 11,
      revision_id: file.revision_id,
      revision_type: "regular",
      revision_created_at: "2026-08-10T00:00:00Z",
      revision_number: file.revision_id - 49,
      revision_user_id: -1,
      name: file.name,
      data: null,
      mime: "image/png; charset=binary",
      size: file.bytes.length,
      s3_hash: sha512(file.bytes),
      revision_comments: "fixture",
      hidden_fields: [],
    };
  }

  function jsonRpc(response, id, result) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
  }

  function rpcError(response, id, message) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message },
      }),
    );
  }

  function isEditor(request) {
    return request.headers["x-deepwell-session-token"] === "editor-session";
  }

  async function handleRpc(request, response) {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks));
    const { id, method, params = {} } = payload;
    if (method === "site_get") return jsonRpc(response, id, { site_id: 7 });
    if (method === "page_get") {
      return jsonRpc(
        response,
        id,
        state.page?.slug === params.page ? state.page : null,
      );
    }
    if (method === "page_create") {
      if (!isEditor(request)) return rpcError(response, id, "denied");
      state.page = {
        page_id: 11,
        revision_id: 21,
        slug: params.slug,
        title: params.title,
        wikitext: params.wikitext,
      };
      if (prematureVisibility) {
        const file = {
          file_id: ++state.nextFileId,
          revision_id: ++state.nextRevisionId,
          name: "action-upload.png",
          bytes: INITIAL_BYTES,
          deleted: false,
        };
        state.files.set(file.file_id, file);
      }
      if (ambiguousPageCreate) {
        request.socket.destroy();
        return;
      }
      return jsonRpc(response, id, state.page);
    }
    if (method === "page_edit_permission") {
      return jsonRpc(response, id, { can_edit: isEditor(request) });
    }
    if (method === "page_get_files") {
      return jsonRpc(
        response,
        id,
        [...state.files.values()].filter((file) => !file.deleted).map(row),
      );
    }
    if (method === "blob_upload") {
      if (!isEditor(request)) return rpcError(response, id, "denied");
      const pendingId = `pending-${randomUUID()}`;
      state.pending.set(pendingId, { bytes: null });
      return jsonRpc(response, id, {
        pending_blob_id: pendingId,
        presign_url: `${origin}/presign/${pendingId}`,
        expires_at: "2099-08-10T00:00:00Z",
      });
    }
    if (method === "blob_cancel") {
      if (!state.pending.has(params.pending_blob_id)) return rpcError(response, id, "missing pending blob");
      state.pending.delete(params.pending_blob_id);
      state.cancelled.push(params.pending_blob_id);
      return jsonRpc(response, id, null);
    }
    if (method === "file_edit") {
      const file = state.files.get(params.file_id);
      if (!file || file.deleted) return rpcError(response, id, "missing file");
      if (params.name !== undefined) file.name = params.name;
      if (params.uploaded_blob_id !== undefined) {
        const pending = state.pending.get(params.uploaded_blob_id);
        if (!pending?.bytes) return rpcError(response, id, "missing upload");
        file.bytes = pending.bytes;
        state.pending.delete(params.uploaded_blob_id);
      }
      file.revision_id = ++state.nextRevisionId;
      if (ambiguousReplacement && params.uploaded_blob_id !== undefined) {
        request.socket.destroy();
        return;
      }
      return jsonRpc(response, id, {
        file_id: file.file_id,
        file_revision_id: file.revision_id,
        file_revision_number: file.revision_id - 49,
        blob_created: params.uploaded_blob_id !== undefined,
      });
    }
    if (method === "file_delete") {
      const file = state.files.get(Number(params.file));
      if (file) file.deleted = true;
      return jsonRpc(response, id, {
        file_id: file?.file_id ?? Number(params.file),
        file_revision_id: ++state.nextRevisionId,
        file_revision_number: 9,
      });
    }
    if (method === "page_delete") {
      state.page = null;
      return jsonRpc(response, id, { page_id: 11, revision_id: 22 });
    }
    return rpcError(response, id, `unexpected ${method}`);
  }

  async function handleAction(request, response) {
    const form = await requestForm(request);
    if (request.headers.cookie !== "wikijump_token=editor-session") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(actionResult("failure", 401));
      return;
    }
    const upload = form.get("file");
    if (prematureVisibility) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(actionResult("success", 200));
      return;
    }
    const file = {
      file_id: ++state.nextFileId,
      revision_id: ++state.nextRevisionId,
      name: String(form.get("name")),
      bytes: Buffer.from(await upload.arrayBuffer()),
      deleted: false,
    };
    state.files.set(file.file_id, file);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(actionResult("success", 200));
  }

  function activeFile(pageSlug, fileName) {
    if (state.page?.slug !== pageSlug) return null;
    return (
      [...state.files.values()].find(
        (file) => !file.deleted && file.name === fileName,
      ) ?? null
    );
  }

  function serveFile(request, response, match, resized) {
    const file = activeFile(
      decodeURIComponent(match[1]),
      decodeURIComponent(match[2]),
    );
    if (file === null) {
      response.writeHead(404, { "content-type": "text/html" });
      response.end("missing");
      return;
    }
    const servedOriginal =
      staleRevisionBytes && file.name === "renamed.png"
        ? INITIAL_BYTES
        : file.bytes;
    const fileHash = sha512(file.bytes);
    const bytes = resized
      ? Buffer.from([
          0xff,
          0xd8,
          0xff,
          Number.parseInt(fileHash.slice(0, 2), 16),
          0xff,
          0xd9,
        ])
      : servedOriginal;
    const etag = resized
      ? `"wikijump-jpeg-v1-${file.revision_id}-${fileHash}-medium"`
      : `"${fileHash}"`;
    response.writeHead(200, {
      "content-type": resized ? "image/jpeg" : "image/png",
      "content-length": String(bytes.length),
      etag,
    });
    if (request.method === "HEAD") response.end();
    else response.end(bytes);
  }

  let origin;
  const server = http.createServer(async (request, response) => {
    try {
      if (request.url === "/jsonrpc" && request.method === "POST") {
        await handleRpc(request, response);
        return;
      }
      if (request.url?.startsWith("/presign/") && request.method === "PUT") {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const pending = state.pending.get(request.url.slice("/presign/".length));
        if (!pending) {
          response.writeHead(404).end();
          return;
        }
        if (failPresignedPut && !state.presignedPutFailed) {
          state.presignedPutFailed = true;
          response.writeHead(503).end();
          return;
        }
        pending.bytes = Buffer.concat(chunks);
        response.writeHead(200).end();
        return;
      }
      if (request.url?.includes("?/fileUpload") && request.method === "POST") {
        await handleAction(request, response);
        return;
      }
      const original = request.url?.match(/^\/-\/file\/([^/]+)\/([^/?]+)$/u);
      if (original) {
        serveFile(request, response, original, false);
        return;
      }
      const resized = request.url?.match(
        /^\/local--resized-images\/([^/]+)\/([^/]+)\/medium\.jpg$/u,
      );
      if (resized) {
        serveFile(request, response, resized, true);
        return;
      }
      response.writeHead(404, { "content-type": "text/html" });
      response.end("missing");
    } catch {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end("internal test server error");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
  return {
    origin,
    state,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function privateInput(candidate) {
  return {
    deepwell_rpc_url: `${candidate.origin}/jsonrpc`,
    deepwell_rpc_token: "0".repeat(64),
    object_store_origin: candidate.origin,
    presigned_origin: candidate.origin,
    tls_ca_pem: "fixture CA without private material",
    actors: {
      editor: { user_id: -1, session_token: "editor-session" },
    },
  };
}

function decorateSession(session, { eventMutation = null, afterRpc = null } = {}) {
  return new Proxy(session, {
    get(target, property) {
      if (property === "events" && eventMutation !== null) {
        return eventMutation(Reflect.get(target, property, target));
      }
      const value = Reflect.get(target, property, target);
      if (property === "rpc" && afterRpc !== null) {
        return async (...args) => {
          const result = await value.apply(target, args);
          afterRpc(args[0]);
          return result;
        };
      }
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function caseSetFor(candidate, sessionOptions = {}) {
  const requestImpl = async (options) => {
    const original = options.url instanceof URL ? options.url : new URL(options.url);
    const url =
      original.protocol === "https:"
        ? new URL(`${original.pathname}${original.search}`, candidate.origin)
        : original;
    return await requestCandidateCaseHttp({
      ...options,
      url,
      connectAddress: null,
      tlsCa: null,
    });
  };
  return createOpen43MediaCandidateCaseSet({
    sessionFactory: (options) =>
      decorateSession(
        new CandidateHttpSession({ ...options, requestImpl }),
        sessionOptions,
      ),
  });
}

async function runFixture(
  t,
  candidate,
  { caseSet = caseSetFor(candidate), signal = null } = {},
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "open43-media-cases-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const identity = candidateIdentity();
  const secretInput = privateInput(candidate);
  return await runCandidateCaseSet({
    candidateIdentity: identity,
    candidateIdentitySha256: sha256Value(identity),
    privateInput: secretInput,
    privateInputSha256: hash("e"),
    outputDir: path.join(root, "evidence"),
    caseSet,
    signal,
    dependencies: {
      collectExecutionIdentity: async () => ({
        schema: "fixture.execution_identity.v1",
        source_clean: true,
        module_manifest_sha256: hash("f"),
      }),
      observeRuntimeIdentity: async ({ requiredServiceBindings }) => ({
        schema: "fixture.runtime_observation.v1",
        identity: "stable",
        required_service_bindings: requiredServiceBindings,
      }),
      assertStableRuntimeIdentity(before, after) {
        assert.deepEqual(after, before);
      },
      runId: () => "candidate-case-0123456789ab",
      now: () => "2026-08-10T00:00:00.000Z",
    },
  });
}

test("the source-owned media CandidateCaseSet fixes the final four-case denominator", () => {
  const caseSet = createOpen43MediaCandidateCaseSet();
  assert.deepEqual(caseSet.caseIds, OPEN43_MEDIA_CASE_IDS);
  assert.deepEqual(OPEN43_MEDIA_CASE_IDS, [
    "M1039_MUTATION_TO_NEXT_READ",
    "M1043_RESIZED_BLOB_IDENTITY",
    "M1062_SERIALIZABLE_ACTION_RESPONSE",
    "M1062_UPLOAD_TRANSACTION_ORDER",
  ]);
});

test("shared runner proves all four media cases through public HTTP and cleans the namespace", async (t) => {
  const candidate = await createFakeCandidate();
  t.after(() => candidate.close());
  const receipt = await runFixture(t, candidate);

  assert.equal(receipt.status, "pass");
  assert.deepEqual(
    receipt.cases.map((entry) => entry.case_id),
    OPEN43_MEDIA_CASE_IDS,
  );
  assert.equal(candidate.state.page, null);
  assert.equal(candidate.state.pending.size, 0);
  assert.ok([...candidate.state.files.values()].every((file) => file.deleted));
  assert.equal(
    JSON.stringify(receipt).includes("editor-session"),
    false,
    "private session values must not enter receipts",
  );
  assert.equal(
    receipt.resources.every((resource) => resource.released),
    true,
  );
});

test("pending release proof binds the replacement result rather than the earlier rename", async (t) => {
  const candidate = await createFakeCandidate();
  t.after(() => candidate.close());
  const receipt = await runFixture(t, candidate);
  const pending = receipt.resources.find((resource) => resource.kind === "pending-blob");
  const revisedFile = [...candidate.state.files.values()].find((file) => file.name === "renamed.png");
  assert.equal(pending.release_proof.file_revision_id, revisedFile.revision_id);
  assert.equal(pending.release_proof.state, "consumed-by-file-revision");
});

test("wrong public replacement bytes fail after the same public cleanup", async (t) => {
  const candidate = await createFakeCandidate({ staleRevisionBytes: true });
  t.after(() => candidate.close());
  await assert.rejects(runFixture(t, candidate), /returned bytes outside the fixed input/u);
  assert.equal(candidate.state.page, null);
  assert.equal(candidate.state.pending.size, 0);
  assert.ok([...candidate.state.files.values()].every((file) => file.deleted));
});

test("wrong adapter order and premature public state are rejected after cleanup", async (t) => {
  const reordered = await createFakeCandidate();
  t.after(() => reordered.close());
  const reorderEvents = (events) => {
    const changed = structuredClone(events);
    const index = changed.findIndex((event) => event.operation === "fileUpload");
    if (index !== -1 && changed[index + 1]?.operation === "page_get_files") {
      [changed[index], changed[index + 1]] = [changed[index + 1], changed[index]];
    }
    return changed;
  };
  await assert.rejects(
    runFixture(t, reordered, {
      caseSet: caseSetFor(reordered, { eventMutation: reorderEvents }),
    }),
    /events are wrong or out of order/u,
  );
  assert.equal(reordered.state.page, null);

  const premature = await createFakeCandidate({ prematureVisibility: true });
  t.after(() => premature.close());
  await assert.rejects(
    runFixture(t, premature),
    /publicly visible before the action/u,
  );
  assert.equal(premature.state.page, null);
  assert.ok([...premature.state.files.values()].every((file) => file.deleted));
});

test("execution error cancels a recorded pending blob and removes public state", async (t) => {
  const candidate = await createFakeCandidate({ failPresignedPut: true });
  t.after(() => candidate.close());
  await assert.rejects(runFixture(t, candidate), /candidate case execution failed/u);
  assert.equal(candidate.state.page, null);
  assert.equal(candidate.state.pending.size, 0);
  assert.equal(candidate.state.cancelled.length, 1);
  assert.ok([...candidate.state.files.values()].every((file) => file.deleted));
});

test("signal abort after page creation still performs public cleanup", async (t) => {
  const candidate = await createFakeCandidate();
  t.after(() => candidate.close());
  const controller = new AbortController();
  const caseSet = caseSetFor(candidate, {
    afterRpc(method) {
      if (method === "page_create" && !controller.signal.aborted) {
        controller.abort(new Error("fixture signal abort"));
      }
    },
  });
  await assert.rejects(
    runFixture(t, candidate, { caseSet, signal: controller.signal }),
    /candidate case execution failed/u,
  );
  assert.equal(candidate.state.page, null);
  assert.equal(candidate.state.pending.size, 0);
});

test("an ambiguous page create never authorizes deletion by slug", async (t) => {
  const candidate = await createFakeCandidate({ ambiguousPageCreate: true });
  t.after(() => candidate.close());
  await assert.rejects(runFixture(t, candidate), /candidate case execution or cleanup failed/u);
  assert.equal(candidate.state.page?.slug, "open43-media-runtime-0123456789ab");
  assert.equal(candidate.state.page?.wikitext, "candidate-case-owner:open43-media-runtime-0123456789ab");
});

test("cleanup continues to public page absence after an ambiguous consumed blob", async (t) => {
  const candidate = await createFakeCandidate({ ambiguousReplacement: true });
  t.after(() => candidate.close());
  await assert.rejects(runFixture(t, candidate), /candidate case execution or cleanup failed/u);
  assert.equal(candidate.state.page, null);
  assert.equal(candidate.state.pending.size, 0);
  assert.ok([...candidate.state.files.values()].every((file) => file.deleted));
});
