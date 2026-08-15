import { pages } from "./data.js"

/** @typedef {Record<string, any>} RpcParams */
/**
 * @typedef {{
 *   content: Buffer
 *   file_created_at: string
 *   file_id: number
 *   file_updated_at: string | null
 *   mime: string
 *   name: string
 *   revision_comments: string
 *   revision_created_at: string
 *   revision_id: number
 *   revision_user_id: number
 *   size: number
 *   size_with_data?: number
 * }} FixtureFile
 */
/**
 * @typedef {{
 *   headers: Record<string, string | string[] | undefined>
 *   params: unknown
 * }} RecordedRpcRequest
 */

export const fixtureState = {
  /** @type {RecordedRpcRequest | null} */
  lastPageTagsSelectRequest: null,
  /** @type {RpcParams | null} */
  lastPageSelectParams: null,
  /** @type {Record<string, unknown[]>} */
  pageReadRequests: {
    forumPostSelect: [],
    forumPostPageSummary: [],
    forumPostGet: [],
    pageGet: [],
    pageGetDirect: [],
    pageLifecycleIdentity: [],
    pageRevisionDiff: [],
    pageRevisionGet: [],
    pageView: [],
    pageViewPermission: [],
    pageSelect: [],
    parentDirectMetadata: [],
    parentRelationshipsGet: [],
    siteGet: [],
    voteList: []
  },
  /** @type {null | ((outcome?: "success" | "failure") => void)} */
  pendingPageRevisionDiffResponse: null,
  /** @type {Record<string, unknown[]>} */
  articleReadRequests: {
    articleView: [],
    articleViewCacheMetadata: []
  },
  /** @type {Record<string, RecordedRpcRequest[]>} */
  pageWriteRequests: {
    login: [],
    pageCreate: [],
    pageEdit: [],
    pageRollback: [],
    pageMove: [],
    parentGetAll: [],
    parentUpdate: [],
    sessionGet: [],
    userGet: [],
    voteSet: []
  },
  /** @type {Record<string, RecordedRpcRequest[]>} */
  fileRequests: {
    blobUpload: [],
    fileCreate: [],
    fileEdit: [],
    fileGet: [],
    fileRestore: [],
    pageGetFiles: []
  },
  /** @type {Record<string, Buffer>} */
  pendingUploads: {},
  /** @type {Record<number, Record<string, FixtureFile>>} */
  filesByPageId: {},
  counters: {
    nextPageId: 4000000,
    nextRevisionId: 9100000,
    nextFileId: 5000000,
    nextPendingBlobId: 1
  }
}

const MIN_I64 = -(1n << 63n)
const MAX_I64 = (1n << 63n) - 1n

/** @type {(value: string) => boolean} */
export const isSignedI64String = (value) => {
  if (!/^-?\d+$/.test(value)) return false
  const parsed = BigInt(value)
  return parsed >= MIN_I64 && parsed <= MAX_I64
}

/**
 * @param {unknown} value
 * @param {string[]} keys
 */
export const hasExactKeys = (value, keys) => {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join("\n") === keys.slice().sort().join("\n")
  )
}

/** @param {number} pageId */
export const pageById = (pageId) =>
  Object.values(pages).find((page) => page.page_id === pageId) ?? null

/** @param {FixtureFile} file */
export const toFileResultWithoutData = (file) => toFileResult(file, false)

/**
 * @param {FixtureFile} file
 * @param {boolean} includeData
 */
export const toFileResult = (file, includeData) => {
  /** @type {Record<string, unknown>} */
  const result = {
    file_id: file.file_id,
    file_created_at: file.file_created_at,
    file_updated_at: file.file_updated_at,
    revision_id: file.revision_id,
    revision_created_at: file.revision_created_at,
    revision_user_id: file.revision_user_id,
    name: file.name,
    mime: file.mime,
    size:
      includeData && file.size_with_data !== undefined ? file.size_with_data : file.size,
    revision_comments: file.revision_comments
  }
  if (includeData) result.data = Array.from(file.content)
  return result
}

/**
 * @param {string} name
 * @param {Buffer} content
 * @param {string} revisionComments
 * @param {number} userId
 * @param {boolean} updated
 * @returns {FixtureFile}
 */
export const createFixtureFile = (name, content, revisionComments, userId, updated) => ({
  file_id: fixtureState.counters.nextFileId++,
  file_created_at: "2026-06-29T00:02:00Z",
  file_updated_at: updated ? "2026-06-29T00:03:00Z" : null,
  revision_id: fixtureState.counters.nextRevisionId++,
  revision_created_at: updated ? "2026-06-29T00:03:00Z" : "2026-06-29T00:02:00Z",
  revision_user_id: userId,
  name,
  content,
  mime: "text/plain",
  size: content.length,
  revision_comments: revisionComments
})

/**
 * @param {FixtureFile} file
 * @param {Buffer} content
 * @param {string} revisionComments
 * @param {number} userId
 */
export const updateFixtureFile = (file, content, revisionComments, userId) => {
  file.content = content
  file.file_updated_at = "2026-06-29T00:03:00Z"
  file.revision_id = fixtureState.counters.nextRevisionId++
  file.revision_created_at = "2026-06-29T00:03:00Z"
  file.revision_user_id = userId
  file.size = content.length
  file.revision_comments = revisionComments
}

fixtureState.filesByPageId[3000173] = {
  "xmlrpc-read-limit-at-cap.txt": {
    file_id: 5_600_000,
    file_created_at: "2026-08-13T00:00:00Z",
    file_updated_at: null,
    revision_id: 9_600_000,
    revision_created_at: "2026-08-13T00:00:00Z",
    revision_user_id: 123,
    name: "xmlrpc-read-limit-at-cap.txt",
    content: Buffer.from("at cap"),
    mime: "text/plain",
    size: 6_000_000,
    revision_comments: "synthetic read-limit boundary metadata"
  },
  "xmlrpc-read-limit-over-cap.txt": {
    file_id: 5_600_001,
    file_created_at: "2026-08-13T00:00:00Z",
    file_updated_at: null,
    revision_id: 9_600_001,
    revision_created_at: "2026-08-13T00:00:00Z",
    revision_user_id: 123,
    name: "xmlrpc-read-limit-over-cap.txt",
    content: Buffer.from("over cap"),
    mime: "text/plain",
    size: 6_000_001,
    revision_comments: "synthetic read-limit boundary metadata"
  },
  "xmlrpc-read-limit-race.txt": {
    file_id: 5_600_002,
    file_created_at: "2026-08-13T00:00:00Z",
    file_updated_at: null,
    revision_id: 9_600_002,
    revision_created_at: "2026-08-13T00:00:00Z",
    revision_user_id: 123,
    name: "xmlrpc-read-limit-race.txt",
    content: Buffer.from("changed after metadata read"),
    mime: "text/plain",
    size: 6_000_000,
    size_with_data: 6_000_001,
    revision_comments: "synthetic read-limit race metadata"
  }
}

/** @param {import("node:http").IncomingMessage} request */
export const requestContextHeaders = (request) => ({
  page: request.headers["x-deepwell-page"],
  sessionToken: request.headers["x-deepwell-session-token"],
  siteId: request.headers["x-deepwell-site-id"]
})

/** @param {Record<string, unknown[]>} requestGroups */
export const resetRequestGroups = (requestGroups) => {
  for (const requests of Object.values(requestGroups)) requests.length = 0
}
