const JAVASCRIPT_URL_ANCHOR = 'a[href="javascript:;"]'

/**
 * Wikidot keeps `href="javascript:;"` on its inert control anchors.
 * Clicking one makes the browser try to execute the `javascript:` URL,
 * which the strict script-src CSP blocks and reports as a violation on
 * every click. The control's behavior comes from its own handler or from
 * the delegated legacy actions, so the only thing this guard cancels is
 * the default navigation to the URL.
 *
 * The `href` itself stays unchanged to preserve the Wikidot DOM contract.
 *
 * @param {Pick<
 *   EventTarget,
 *   "addEventListener" | "removeEventListener"
 * >} root
 * @returns {() => void} Uninstall function
 */
export function installJavascriptAnchorGuard(root) {
  const guard = (event) => {
    if (event.defaultPrevented) return
    const target = event.target
    if (typeof target?.closest !== "function") return
    if (target.closest(JAVASCRIPT_URL_ANCHOR)) event.preventDefault()
  }

  root.addEventListener("click", guard)
  return () => root.removeEventListener("click", guard)
}
