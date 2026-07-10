const PRIVATE_PAGE_LOAD_DATA_KEYS = new Set([
  "article_page_cache_key",
  "public_content_cache_fence",
  "anonymous_permission_cache_fence"
])

/**
 * @param {Record<string, unknown>} data
 * @returns {Record<string, unknown>}
 */
const omitPrivatePageLoadData = (data) => {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => !PRIVATE_PAGE_LOAD_DATA_KEYS.has(key))
  )
}

/**
 * @param {Record<string, unknown>} parentData
 * @param {Record<string, unknown>} viewData
 * @param {unknown} forms
 * @returns {Record<string, unknown>}
 */
export const buildPageLoadData = (parentData, viewData, forms) => {
  return {
    ...omitPrivatePageLoadData(parentData),
    ...omitPrivatePageLoadData(viewData),
    forms
  }
}
