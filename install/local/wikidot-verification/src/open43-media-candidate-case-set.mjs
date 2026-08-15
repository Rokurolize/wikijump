import { createHash } from "node:crypto";

import { CandidateHttpSession } from "./candidate-case-http.mjs";
import { verifyOpen43MediaCase } from "./open43-media-candidate-contract.mjs";
import { sha256Value } from "./standing-browser-parity-util.mjs";

export const OPEN43_MEDIA_CASE_IDS = Object.freeze([
  "M1039_MUTATION_TO_NEXT_READ",
  "M1043_RESIZED_BLOB_IDENTITY",
  "M1062_SERIALIZABLE_ACTION_RESPONSE",
  "M1062_UPLOAD_TRANSACTION_ORDER",
]);

const SITE_SLUG = "scpaiueouiuiuiui";
const PAGE_SLUG_PREFIX = "open43-media-runtime";
const FILE_NAMES = Object.freeze({
  action_upload: "action-upload.png",
  renamed: "renamed.png",
  rejected_upload: "rejected-upload.png",
});
const INITIAL_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAACAQMAAABFZu8gAAAAA1BMVEX/AAAZ4gk3AAAADElEQVQI12NgYGAAAAAEAAEnNCcKAAAAAElFTkSuQmCC",
  "base64",
);
const REVISION_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAAEAQMAAACeIXx6AAAAA1BMVEUAAP+KeNJXAAAAC0lEQVQI12NggAAAAAgAAS8g3TEAAAAASUVORK5CYII=",
  "base64",
);
const RESIZED_VARIANT = "medium";
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const INPUTS = Object.freeze({
  initial: { mime: "image/png", inventoryMime: "image/png; charset=binary", width: 4, height: 2, sha256: sha256(INITIAL_BYTES), bytes: INITIAL_BYTES },
  revision: { mime: "image/png", inventoryMime: "image/png; charset=binary", width: 2, height: 4, sha256: sha256(REVISION_BYTES), bytes: REVISION_BYTES },
});

function runPageSlug(runId) {
  return `${PAGE_SLUG_PREFIX}-${runId.slice("candidate-case-".length)}`;
}

function requireCandidateSite(candidateIdentity) {
  const expectedHost = `${SITE_SLUG}.wikijump.localhost`;
  if (candidateIdentity.candidate.endpoint.host !== expectedHost) {
    throw new Error(
      `Open43 media cases require a separately sealed ${expectedHost} candidate`,
    );
  }
}

function publicInput(input) {
  return { mime: input.mime, inventory_mime: input.inventoryMime, width: input.width, height: input.height, size: input.bytes.length, sha256: input.sha256 };
}

function publicFileRow(row) {
  const { file_id, revision_id, revision_user_id, name, mime, size, s3_hash } = row;
  return { file_id, revision_id, revision_user_id, name, mime, size, s3_hash };
}

function encodePath(...parts) {
  return parts.map((part) => encodeURIComponent(part)).join("/");
}

function originalPath(pageSlug, fileName) {
  return `/-/file/${encodePath(pageSlug, fileName)}`;
}

function resizedPath(pageSlug, fileName) {
  return `/local--resized-images/${encodePath(
    pageSlug,
    fileName,
    `${RESIZED_VARIANT}.jpg`,
  )}`;
}

function matchingRows(inventory, name) {
  return inventory.filter((row) => row.name === name);
}

function localEvents(events, start) {
  return events.slice(start).map((event, index) => ({
    ...event,
    sequence: index + 1,
  }));
}

class Open43MediaRun {
  #session;
  #resources;
  #pageSlug;
  #ownershipMarker;
  #siteId = null;
  #ownedPage = null;
  #pageResource = null;
  #pending = new Map();

  constructor({ session, resources, pageSlug }) {
    this.#session = session;
    this.#resources = resources;
    this.#pageSlug = pageSlug;
    this.#ownershipMarker = `candidate-case-owner:${pageSlug}`;
  }

  async #rpc(method, params = {}, { actor = "editor", cleanup = false } = {}) {
    return await this.#session.rpc(method, params, {
      actor,
      siteId: this.#siteId ?? undefined,
      page: this.#pageSlug,
      cleanup,
    });
  }

  async #getPage({ cleanup = false, wikitext = false } = {}) {
    return await this.#rpc(
      "page_get",
      {
        site_id: this.#siteId,
        page: this.#pageSlug,
        details: { wikitext, compiled: false },
      },
      { cleanup },
    );
  }

  async #getInventory(pageId, { cleanup = false } = {}) {
    const rows = await this.#rpc(
      "page_get_files",
      { site_id: this.#siteId, page_id: pageId, deleted: false },
      { cleanup },
    );
    if (!Array.isArray(rows)) {
      throw new Error("page_get_files returned a non-array at the public seam");
    }
    return rows
      .map(publicFileRow)
      .sort((left, right) => left.file_id - right.file_id);
  }

  async #observeRoute(pathname, operationPrefix, { cleanup = false } = {}) {
    const get = await this.#session.filesRequest(pathname, {
      method: "GET",
      cleanup,
      operation: `${operationPrefix}-get`,
    });
    const head = await this.#session.filesRequest(pathname, {
      method: "HEAD",
      cleanup,
      operation: `${operationPrefix}-head`,
    });
    return {
      status: get.status,
      content_type: get.content_type,
      etag: get.etag,
      content_length: get.content_length,
      body_size: get.body_size,
      body_sha256: get.body_sha256,
      body_base64: get.body_base64,
      head: {
        status: head.status,
        etag: head.etag,
        content_length: head.content_length,
        body_size: head.body_size,
      },
    };
  }

  async #observeOriginal(fileName, operation, options) {
    return await this.#observeRoute(
      originalPath(this.#pageSlug, fileName),
      operation,
      options,
    );
  }

  async #observeResized(fileName, operation, options) {
    return await this.#observeRoute(
      resizedPath(this.#pageSlug, fileName),
      operation,
      options,
    );
  }

  async #observeFile(fileName, operation, options) {
    return {
      original: await this.#observeOriginal(fileName, `${operation}-original`, options),
      resized: await this.#observeResized(fileName, `${operation}-resized`, options),
    };
  }

  async #deleteFile(pageId, row, { cleanup = false } = {}) {
    await this.#rpc(
      "file_delete",
      {
        site_id: this.#siteId,
        page_id: pageId,
        file: row.file_id,
        user_id: this.#session.editorUserId,
        last_revision_id: row.revision_id,
        revision_comments: "Open43 candidate cleanup",
      },
      { cleanup },
    );
  }

  async #beginPendingBlob(bytes) {
    const permission = await this.#rpc("page_edit_permission");
    if (permission?.can_edit !== true) {
      throw new Error("editor cannot edit the run-owned media page");
    }
    const pending = await this.#rpc("blob_upload", {
      user_id: this.#session.editorUserId,
      blob_size: bytes.length,
      scope: "page",
    });
    if (
      typeof pending?.pending_blob_id !== "string" ||
      pending.pending_blob_id.length === 0 ||
      typeof pending.presign_url !== "string"
    ) {
      throw new Error("blob_upload did not return a pending blob and presigned URL");
    }
    const state = { token: null, pending };
    this.#pending.set(pending.pending_blob_id, state);
    state.token = this.#resources.register("pending-blob", {
      pending_blob_id: pending.pending_blob_id,
      site_slug: SITE_SLUG,
      page_slug: this.#pageSlug,
      byte_sha256: sha256(bytes),
    });
    await this.#session.presignedPut(pending.presign_url, bytes);
    return state;
  }

  async #consumePendingBlob(state, publicProof) {
    this.#resources.release(state.token, publicProof);
    this.#pending.delete(state.pending.pending_blob_id);
  }

  async execute() {
    const site = await this.#session.rpc("site_get", { site: SITE_SLUG });
    if (!Number.isSafeInteger(site?.site_id)) {
      throw new Error(`editable candidate site ${SITE_SLUG} is missing`);
    }
    this.#siteId = site.site_id;
    const existingPage = await this.#getPage();
    if (existingPage !== null) {
      throw new Error("run-owned media page namespace already exists");
    }
    const beforeOriginal = await this.#observeOriginal(
      FILE_NAMES.action_upload,
      "pre-action-original",
    );
    const page = await this.#rpc("page_create", {
      site_id: this.#siteId,
      slug: this.#pageSlug,
      title: this.#ownershipMarker,
      alt_title: null,
      wikitext: this.#ownershipMarker,
      layout: "wikidot",
      user_id: this.#session.editorUserId,
      ip_address: "127.0.0.1",
      tags: [],
      revision_comments: "Open43 media candidate fixture",
    });
    if (!Number.isSafeInteger(page?.page_id) || !Number.isSafeInteger(page.revision_id) || page.slug !== this.#pageSlug) {
      throw new Error("page_create did not return a public page identity");
    }
    this.#ownedPage = {
      page_id: page.page_id,
      revision_id: page.revision_id,
      slug: page.slug,
      marker: this.#ownershipMarker,
    };
    this.#pageResource = this.#resources.register("page", this.#ownedPage);
    const created = await this.#getPage({ wikitext: true });
    if (!this.#matchesOwnedPage(created)) throw new Error("created page does not match its public ownership proof");

    const inventoryBeforeAction = await this.#getInventory(page.page_id);
    const actionEventStart = this.#session.events.length;
    const successfulAction = await this.#session.multipartFileAction(
      this.#pageSlug,
      {
        siteId: this.#siteId,
        pageId: page.page_id,
        lastRevisionId: page.revision_id,
        name: FILE_NAMES.action_upload,
        comments: "Open43 candidate upload",
      },
      {
        name: FILE_NAMES.action_upload,
        mime: INPUTS.initial.mime,
        bytes: INPUTS.initial.bytes,
      },
    );
    const inventoryAfterAction = await this.#getInventory(page.page_id);
    const initialRoutes = await this.#observeFile(FILE_NAMES.action_upload, "action");
    const actionEvents = localEvents(this.#session.events, actionEventStart);
    const initialRows = matchingRows(inventoryAfterAction, FILE_NAMES.action_upload);
    if (initialRows.length !== 1) {
      throw new Error("multipart action did not create exactly one public file row");
    }

    const inventoryBeforeFailedAction = await this.#getInventory(page.page_id);
    const failedAction = await this.#session.multipartFileAction(
      this.#pageSlug,
      {
        siteId: this.#siteId,
        pageId: page.page_id,
        lastRevisionId: page.revision_id,
        name: FILE_NAMES.rejected_upload,
        comments: "Open43 rejected candidate upload",
      },
      {
        name: FILE_NAMES.rejected_upload,
        mime: INPUTS.revision.mime,
        bytes: INPUTS.revision.bytes,
      },
      { actor: "anonymous" },
    );
    const inventoryAfterFailedAction = await this.#getInventory(page.page_id);
    const failedRoute = await this.#observeOriginal(
      FILE_NAMES.rejected_upload,
      "rejected-original",
    );

    const first = initialRows[0];
    const renameResult = await this.#rpc("file_edit", {
      site_id: this.#siteId,
      page_id: page.page_id,
      file_id: first.file_id,
      user_id: this.#session.editorUserId,
      last_revision_id: first.revision_id,
      revision_comments: "Open43 candidate rename",
      name: FILE_NAMES.renamed,
      bypass_filter: false,
      ip_address: "127.0.0.1",
    });
    const inventoryAfterRename = await this.#getInventory(page.page_id);
    const renamedRows = matchingRows(inventoryAfterRename, FILE_NAMES.renamed);
    if (renamedRows.length !== 1) {
      throw new Error("file_edit rename did not produce one public row");
    }
    const renamed = renamedRows[0];
    if (renameResult?.file_revision_id !== renamed.revision_id) throw new Error("file_edit rename result does not bind the next public inventory");
    const oldRoutesAfterRename = await this.#observeFile(FILE_NAMES.action_upload, "renamed-old");
    const newRoutesAfterRename = await this.#observeFile(FILE_NAMES.renamed, "renamed-new");

    const pendingRevision = await this.#beginPendingBlob(INPUTS.revision.bytes);
    const replacementResult = await this.#rpc("file_edit", {
      site_id: this.#siteId,
      page_id: page.page_id,
      file_id: renamed.file_id,
      user_id: this.#session.editorUserId,
      last_revision_id: renamed.revision_id,
      revision_comments: "Open43 candidate replacement",
      uploaded_blob_id: pendingRevision.pending.pending_blob_id,
      bypass_filter: false,
      ip_address: "127.0.0.1",
    });
    if (!Number.isSafeInteger(replacementResult?.file_revision_id) || !Number.isSafeInteger(replacementResult.file_revision_number) || typeof replacementResult.blob_created !== "boolean") {
      throw new Error("file_edit replacement did not return a public revision identity");
    }
    const inventoryAfterRevision = await this.#getInventory(page.page_id);
    const revisedRows = matchingRows(inventoryAfterRevision, FILE_NAMES.renamed);
    if (revisedRows.length !== 1) {
      throw new Error("file_edit replacement did not produce one public row");
    }
    const revised = revisedRows[0];
    if (revised.revision_id !== replacementResult.file_revision_id || revised.s3_hash === renamed.s3_hash) throw new Error("file_edit replacement result does not bind the next public blob identity");
    await this.#consumePendingBlob(pendingRevision, {
      state: "consumed-by-file-revision",
      file_revision_id: replacementResult.file_revision_id,
      file_revision_number: replacementResult.file_revision_number,
      blob_created: replacementResult.blob_created,
    });
    const revisedRoutes = await this.#observeFile(FILE_NAMES.renamed, "replacement");
    await this.#deleteFile(page.page_id, revised);
    const inventoryAfterDelete = await this.#getInventory(page.page_id);
    const deletedRoutes = await this.#observeFile(FILE_NAMES.renamed, "deleted");

    return [
      {
        case_id: "M1039_MUTATION_TO_NEXT_READ",
        observations: {
          after_upload: {
            inventory: initialRows,
            original: initialRoutes.original,
          },
          after_rename: {
            inventory: renamedRows,
            old_original: oldRoutesAfterRename.original,
            new_original: newRoutesAfterRename.original,
          },
          after_revision: {
            inventory: revisedRows,
            original: revisedRoutes.original,
          },
          after_delete: {
            inventory: inventoryAfterDelete,
            original: deletedRoutes.original,
            resized: deletedRoutes.resized,
          },
        },
      },
      {
        case_id: "M1043_RESIZED_BLOB_IDENTITY",
        observations: {
          initial: {
            file: first,
            original: initialRoutes.original,
            resized: initialRoutes.resized,
          },
          after_rename: {
            file: renamed,
            old_original: oldRoutesAfterRename.original,
            old_resized: oldRoutesAfterRename.resized,
            new_original: newRoutesAfterRename.original,
            new_resized: newRoutesAfterRename.resized,
          },
          after_revision: {
            file: revised,
            original: revisedRoutes.original,
            resized: revisedRoutes.resized,
          },
          after_delete: {
            original: deletedRoutes.original,
            resized: deletedRoutes.resized,
          },
        },
      },
      {
        case_id: "M1062_SERIALIZABLE_ACTION_RESPONSE",
        observations: {
          successful_action: successfulAction,
          failed_action: failedAction,
          inventory_before_failed_action: inventoryBeforeFailedAction,
          inventory_after_failed_action: inventoryAfterFailedAction,
          failed_route: failedRoute,
        },
      },
      {
        case_id: "M1062_UPLOAD_TRANSACTION_ORDER",
        observations: {
          event_scope: "adapter-issued-external-requests-only",
          before_action: {
            inventory: inventoryBeforeAction,
            original: beforeOriginal,
          },
          action: successfulAction,
          after_action: {
            inventory: initialRows,
            original: initialRoutes.original,
            resized: initialRoutes.resized,
          },
          adapter_events: actionEvents,
        },
      },
    ];
  }

  async cleanup() {
    const failures = [];
    for (const [pendingBlobId, state] of this.#pending) {
      try {
        await this.#rpc("blob_cancel", {
          user_id: this.#session.editorUserId,
          pending_blob_id: pendingBlobId,
        }, { cleanup: true });
        this.#resources.release(state.token, {
          state: "cancelled",
          pending_blob_id: pendingBlobId,
          public_rpc_result: null,
        });
        this.#pending.delete(pendingBlobId);
      } catch (error) {
        failures.push(error);
      }
    }

    let page = null;
    try {
      if (this.#siteId !== null) page = await this.#getPage({ cleanup: true, wikitext: true });
      if (this.#matchesOwnedPage(page)) {
        const inventory = await this.#getInventory(page.page_id, { cleanup: true });
        for (const row of inventory) await this.#deleteFile(page.page_id, row, { cleanup: true });
        const latest = await this.#getPage({ cleanup: true, wikitext: true });
        if (!this.#matchesOwnedPage(latest)) throw new Error("run-owned page identity drifted during cleanup");
        await this.#rpc("page_delete", {
          site_id: this.#siteId,
          page: latest.page_id,
          last_revision_id: latest.revision_id,
          revision_comments: "Open43 candidate cleanup",
          user_id: this.#session.editorUserId,
          ip_address: "127.0.0.1",
        }, { cleanup: true });
      }
    } catch (error) {
      failures.push(error);
    }

    let pageAfter;
    try {
      pageAfter = this.#siteId === null ? null : await this.#getPage({ cleanup: true });
    } catch (error) {
      failures.push(error);
    }
    const routeAbsence = {};
    for (const [name, fileName] of Object.entries(FILE_NAMES)) {
      try {
        const routes = await this.#observeFile(fileName, `cleanup-${name}`, { cleanup: true });
        routeAbsence[`${name}_original`] = routes.original;
        routeAbsence[`${name}_resized`] = routes.resized;
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.#pageResource !== null && pageAfter === null) {
      this.#resources.release(this.#pageResource, {
        page_get: null,
        public_routes_sha256: sha256Value(routeAbsence),
      });
    }
    if (failures.length > 0) throw new AggregateError(failures, "media public cleanup failed");
    return {
      page_get: pageAfter,
      public_routes: routeAbsence,
      outstanding_pending_blob_ids: [...this.#pending.keys()],
    };
  }

  #matchesOwnedPage(page) {
    return this.#ownedPage !== null && page?.page_id === this.#ownedPage.page_id && page.revision_id === this.#ownedPage.revision_id && page.slug === this.#ownedPage.slug && page.title === this.#ownedPage.marker && page.wikitext === this.#ownedPage.marker;
  }
}

function verifyCleanup(proof, resources) {
  if (proof === null || typeof proof !== "object" || proof.page_get !== null) {
    throw new Error("media cleanup did not prove public page absence");
  }
  if (
    !Array.isArray(proof.outstanding_pending_blob_ids) ||
    proof.outstanding_pending_blob_ids.length !== 0
  ) {
    throw new Error("media cleanup left an outstanding pending blob");
  }
  const routes = Object.values(proof.public_routes ?? {});
  if (routes.length !== Object.keys(FILE_NAMES).length * 2) {
    throw new Error("media cleanup route denominator is incomplete");
  }
  for (const route of routes) {
    if (
      route?.status !== 404 ||
      route?.head?.status !== 404 ||
      route?.head?.body_size !== 0
    ) {
      throw new Error("media cleanup did not prove public file route absence");
    }
  }
  if (
    !Array.isArray(resources) ||
    resources.some((resource) => resource.released !== true)
  ) {
    throw new Error("media cleanup did not release every recorded resource");
  }
  return {
    public_absence_verified: true,
    page_absent: true,
    route_count: routes.length,
    resource_count: resources.length,
  };
}

export function createOpen43MediaCandidateCaseSet({
  sessionFactory = (options) => new CandidateHttpSession(options),
} = {}) {
  const plan = Object.freeze({
    site_slug: SITE_SLUG,
    file_names: FILE_NAMES,
    inputs: INPUTS,
    resized_variant: RESIZED_VARIANT,
    editor_user_id: -1,
  });
  const sourceFiles = Object.freeze([
    "install/local/wikidot-verification/scripts/run-candidate-cases.mjs",
    "install/local/wikidot-verification/src/atomic-no-replace.mjs",
    "install/local/wikidot-verification/src/candidate-source-execution-identity.mjs",
    "install/local/wikidot-verification/src/candidate-case-runner.mjs",
    "install/local/wikidot-verification/src/candidate-case-command.mjs",
    "install/local/wikidot-verification/src/candidate-case-http.mjs",
    "install/local/wikidot-verification/src/deepwell-rpc-auth.mjs",
    "install/local/wikidot-verification/src/open43-media-candidate-case-set.mjs",
    "install/local/wikidot-verification/src/open43-media-candidate-contract.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-receipt.mjs",
    "install/local/wikidot-verification/src/standing-browser-parity-util.mjs",
    "install/local/wikidot-verification/src/standing-browser-runtime-identity.mjs",
    "install/local/wikidot-verification/package.json",
    "install/local/wikidot-verification/pnpm-lock.yaml",
  ]);
  return Object.freeze({
    id: "open43-media-files",
    caseIds: OPEN43_MEDIA_CASE_IDS,
    prepareRun({ runId, candidateIdentity, privateInput, signal, resources }) {
      requireCandidateSite(candidateIdentity);
      const session = sessionFactory({ candidateIdentity, privateInput, signal });
      if (session?.editorUserId !== plan.editor_user_id) throw new Error("candidate session does not bind the fixed media editor");
      const execution = new Open43MediaRun({ session, resources, pageSlug: runPageSlug(runId) });
      return Object.freeze({
        sourceFiles,
        runtimeBindings: session.requiredServiceBindings,
        privateInputIdentity: session.privateInputIdentity,
        plan: {
          schema: "wikijump.open43_media_candidate_plan.v1",
          site_slug: SITE_SLUG,
          page_slug: runPageSlug(runId),
          file_names: FILE_NAMES,
          fixed_inputs: { initial: publicInput(INPUTS.initial), revision: publicInput(INPUTS.revision) },
          resized_variant: RESIZED_VARIANT,
          source_owned_internal_upload_order: ["page_edit_permission", "blob_upload", "presigned_put", "file_create"],
          candidate_observation_scope: "adapter-issued-external-requests-only",
        },
        execute: () => execution.execute(),
        cleanup: () => execution.cleanup(),
        verifyCase: (caseId, observations) => verifyOpen43MediaCase(caseId, observations, plan),
        verifyCleanup,
      });
    },
  });
}
