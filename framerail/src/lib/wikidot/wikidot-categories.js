/**
 * @typedef {{
 *   status?: string
 *   body?: string
 *   categoryId?: number
 * }} CategoriesPageListResponse
 *
 *
 * @typedef {{
 *   listeners: {
 *     toggleListPages?: (
 *       event: Event | undefined,
 *       categoryId: number
 *     ) => false
 *   }
 *   callbacks: { listPages?: (data: CategoriesPageListResponse) => void }
 * }} WikiCategoriesModule
 *
 *
 * @typedef {Window &
 *   typeof globalThis & {
 *     WIKIDOT?: {
 *       modules?: { WikiCategoriesModule?: WikiCategoriesModule }
 *     }
 *   }} WikidotCategoriesRoot
 */

const CATEGORIES_PAGE_LIST_MODULE = "list/WikiCategoriesPageListModule"

/** @param {WikidotCategoriesRoot} root */
const ensureWikidotNamespace = (root) => {
  const wikidot = (root.WIKIDOT ??= {})
  const modules = (wikidot.modules ??= {})
  return (modules.WikiCategoriesModule ??= { listeners: {}, callbacks: {} })
}

/**
 * @param {WikidotCategoriesRoot} root
 * @param {number} categoryId
 */
const categoryElements = (root, categoryId) => ({
  list: root.document?.getElementById(`category-pages-${categoryId}`) ?? null,
  toggler: root.document?.getElementById(`category-pages-toggler-${categoryId}`) ?? null
})

/** @param {WikidotCategoriesRoot} [root] */
export const installWikidotCategories = (
  root = /** @type {WikidotCategoriesRoot} */ (globalThis)
) => {
  const module = ensureWikidotNamespace(root)
  module.listeners ??= {}
  module.callbacks ??= {}

  module.callbacks.listPages = (data) => {
    const categoryId = Number(data?.categoryId)
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0 || data?.status !== "ok") {
      return
    }
    const { list } = categoryElements(root, categoryId)
    if (list) list.innerHTML = data.body ?? ""
  }

  module.listeners.toggleListPages = (event, categoryId) => {
    event?.preventDefault()
    event?.stopPropagation()
    if (!Number.isSafeInteger(categoryId) || categoryId <= 0) return false

    const { list, toggler } = categoryElements(root, categoryId)
    if (!list || !toggler) return false

    if (list.style.display === "block") {
      list.style.display = "none"
      toggler.textContent = "+ list pages"
      return false
    }

    if (list.innerHTML === "") {
      list.style.display = "block"
      list.innerHTML = '<div class="wait-block">loading page list...</div>'
      const body = new URLSearchParams({
        moduleName: CATEGORIES_PAGE_LIST_MODULE,
        category_id: String(categoryId)
      })
      void root
        .fetch("/ajax-module-connector.php", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
          credentials: "same-origin"
        })
        .then((response) => response.json())
        .then((data) => module.callbacks.listPages?.(data))
        .catch(() => {})
    } else {
      list.style.display = "block"
    }
    toggler.textContent = "- hide pages"
    return false
  }

  return module
}
