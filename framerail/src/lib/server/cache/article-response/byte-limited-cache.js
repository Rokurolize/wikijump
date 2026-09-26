import { ExpiryHeap } from "./expiry-heap.js"

/**
 * @template T
 * @typedef {object} ByteLimitedCacheEntry
 * @property {T} value
 * @property {number} expiresAt
 * @property {number} bytes
 * @property {string} key
 * @property {number} heapIndex
 * @property {ByteLimitedCacheEntry<T> | null} previous
 * @property {ByteLimitedCacheEntry<T> | null} next
 */

/**
 * @template T
 * @param {{
 *   now: () => number
 *   maxEntries: number
 *   maxBytes: number
 *   touchOnRead?: boolean
 * }} options
 */
export const createByteLimitedCache = ({
  now,
  maxEntries,
  maxBytes,
  touchOnRead = false
}) => {
  /** @type {Map<string, ByteLimitedCacheEntry<T>>} */
  const entries = new Map()
  const expirations = new ExpiryHeap()
  /** @type {ByteLimitedCacheEntry<T> | null} */
  let oldest = null
  /** @type {ByteLimitedCacheEntry<T> | null} */
  let newest = null
  let totalBytes = 0

  /** @param {ByteLimitedCacheEntry<T>} entry */
  const unlink = (entry) => {
    if (entry.previous) entry.previous.next = entry.next
    else oldest = entry.next
    if (entry.next) entry.next.previous = entry.previous
    else newest = entry.previous
    entry.previous = null
    entry.next = null
  }

  /** @param {ByteLimitedCacheEntry<T>} entry */
  const append = (entry) => {
    entry.previous = newest
    if (newest) newest.next = entry
    else oldest = entry
    newest = entry
  }

  /** @param {string} key */
  const deleteEntry = (key) => {
    const entry = entries.get(key)
    if (!entry) return
    totalBytes -= entry.bytes
    expirations.remove(entry)
    unlink(entry)
    entries.delete(key)
  }

  /** @param {number} nowMs */
  const pruneExpired = (nowMs) => {
    for (
      let entry = expirations.first();
      entry && entry.expiresAt <= nowMs;
      entry = expirations.first()
    ) {
      deleteEntry(entry.key)
    }
  }

  const pruneOverflow = () => {
    while (entries.size > maxEntries || totalBytes > maxBytes) {
      if (!oldest) return
      deleteEntry(oldest.key)
    }
  }

  /**
   * @param {string} key
   * @returns {T | null}
   */
  const get = (key) => {
    const entry = entries.get(key)
    if (!entry) return null
    if (entry.expiresAt <= now()) {
      deleteEntry(key)
      return null
    }
    if (touchOnRead) {
      unlink(entry)
      append(entry)
    }
    return entry.value
  }

  /**
   * @param {string} key
   * @param {T} value
   * @param {number} bytes
   * @param {number} expiresAt
   */
  const insert = (key, value, bytes, expiresAt) => {
    const nowMs = now()
    pruneExpired(nowMs)
    deleteEntry(key)
    if (expiresAt <= nowMs || bytes > maxBytes) return false

    const entry = {
      key,
      value,
      expiresAt,
      bytes,
      heapIndex: -1,
      previous: null,
      next: null
    }
    entries.set(key, entry)
    append(entry)
    expirations.insert(entry)
    totalBytes += bytes
    pruneOverflow()
    return entries.has(key)
  }

  return {
    get,
    insert,
    delete: deleteEntry,
    size: () => entries.size,
    clear() {
      entries.clear()
      expirations.clear()
      oldest = null
      newest = null
      totalBytes = 0
    }
  }
}
