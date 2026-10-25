/**
 * Wikidot's page init (retained WIKIDOT.combined.js) runs
 * `WIKIDOT.page.fixers.fixMenuList("top-bar")`, then `fixMenu("top-bar")`
 * and `fixMenu("side-bar")`. Its server HTML leaves a top-bar item's text
 * bare (`<li>About <ul>…`); the script wraps every item's leading text
 * node in a `javascript:;` anchor, which theme CSS such as `#top-bar
 * .top-bar > ul > li > a` targets, and toggles `sfhover` on hovered
 * items.
 */

/**
 * Wrap the first child of each list item in a `javascript:;` anchor when
 * that child is a text node, as fixMenuList does (whitespace-only text
 * included).
 *
 * @param {Element} root
 */
export const wrapWikidotMenuListText = (root) => {
  for (const item of root.getElementsByTagName("li")) {
    const first = item.firstChild
    if (first?.nodeType !== Node.TEXT_NODE) continue
    const link = document.createElement("a")
    item.insertBefore(link, first)
    link.append(first)
    // eslint-disable-next-line no-script-url -- fixMenuList's exact inert href.
    link.href = "javascript:;"
  }
}

/** @param {Event} event */
const addHover = (event) =>
  /** @type {Element} */ (event.currentTarget).classList.add("sfhover")
/** @param {Event} event */
const removeHover = (event) =>
  /** @type {Element} */ (event.currentTarget).classList.remove("sfhover")

/**
 * @param {Element} root
 * @param {WeakSet<Element>} hovered
 */
const addMenuHover = (root, hovered) => {
  for (const item of root.getElementsByTagName("li")) {
    if (hovered.has(item)) continue
    hovered.add(item)
    item.addEventListener("mouseover", addHover)
    item.addEventListener("mouseout", removeHover)
  }
}

/**
 * Apply Wikidot's menu fixers to `#top-bar` (`list: true`) or `#side-bar`,
 * and again whenever the bar's content is replaced.
 *
 * @type {import("svelte/action").Action<
 *   Element,
 *   { list?: boolean } | undefined
 * >}
 */
export const wikidotMenu = (root, options) => {
  const list = options?.list ?? false
  /** @type {WeakSet<Element>} */
  const hovered = new WeakSet()
  const apply = () => {
    if (list) wrapWikidotMenuListText(root)
    addMenuHover(root, hovered)
  }
  apply()

  const observer = new MutationObserver(apply)
  observer.observe(root, { childList: true, subtree: true })

  return {
    destroy() {
      observer.disconnect()
      for (const item of root.getElementsByTagName("li")) {
        item.removeEventListener("mouseover", addHover)
        item.removeEventListener("mouseout", removeHover)
      }
    }
  }
}
