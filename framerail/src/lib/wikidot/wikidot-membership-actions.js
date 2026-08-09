/** @typedef {{ type: "join" }} MembershipBrowserAction */
/**
 * @typedef {{
 *   join?: () => unknown
 *   reload?: () => unknown
 *   error?: (error: unknown) => unknown
 * }} MembershipActionRuntime
 */

const JOIN_SELECTOR = `div > a[href="javascript:;"][onclick="WIKIDOT.page.listeners.join(event, 'unified')"]`

/** @type {WeakMap<HTMLElement, MembershipBrowserAction>} */
const boundActions = new WeakMap()
/** @type {WeakSet<HTMLElement>} */
const busyActions = new WeakSet()

/**
 * Zip exact renderer-owned Join controls to the closed sidecar. Any count,
 * descriptor, or DOM mismatch disables the complete surface.
 *
 * @param {HTMLElement[]} candidates
 * @param {MembershipBrowserAction[]} actions
 * @returns {[HTMLElement, MembershipBrowserAction][]}
 */
export const planWikidotJoinActionBindings = (candidates, actions) => {
  if (
    candidates.length !== actions.length ||
    actions.some((action) => action.type !== "join") ||
    candidates.some((candidate) => !candidate.matches(JOIN_SELECTOR))
  ) {
    return []
  }
  return actions.map((action, index) => [candidates[index], action])
}

/**
 * Execute a fixed membership action once and keep its visible busy state
 * until the server transition settles.
 *
 * @param {HTMLElement} element
 * @param {MembershipBrowserAction} action
 * @param {MembershipActionRuntime} runtime
 */
export const performWikidotMembershipAction = async (element, action, runtime) => {
  if (busyActions.has(element) || action.type !== "join" || !runtime.join) return false

  busyActions.add(element)
  element.setAttribute("aria-busy", "true")
  try {
    await runtime.join()
    runtime.reload?.()
    return true
  } catch (error) {
    runtime.error?.(error)
    return false
  } finally {
    busyActions.delete(element)
    element.removeAttribute("aria-busy")
  }
}

/**
 * Install capture-phase behavior so the trusted legacy `onclick` remains
 * in served DOM for parity but is never evaluated by the browser.
 *
 * @param {HTMLElement} root
 * @param {{
 *   actions: MembershipBrowserAction[]
 *   runtime: MembershipActionRuntime
 * }} parameters
 */
export const wikidotMembershipActions = (root, parameters) => {
  /** @type {Set<HTMLElement>} */
  const elements = new Set()
  let runtime = parameters.runtime

  /** @param {MembershipBrowserAction[]} actions */
  const refresh = (actions) => {
    for (const element of elements) boundActions.delete(element)
    elements.clear()
    const candidates = /** @type {HTMLElement[]} */ ([
      ...root.querySelectorAll(JOIN_SELECTOR)
    ])
    for (const element of candidates) elements.add(element)
    for (const [element, action] of planWikidotJoinActionBindings(candidates, actions)) {
      boundActions.set(element, action)
    }
  }
  refresh(parameters.actions)

  /** @param {Event} event */
  const actionElement = (event) => {
    let element = /** @type {HTMLElement | null} */ (event.target)
    while (element && element !== root) {
      if (elements.has(element)) return element
      element = element.parentElement
    }
    return undefined
  }
  /** @param {Event} event */
  const activate = (event) => {
    const element = actionElement(event)
    if (!element) return
    const action = boundActions.get(element)
    event.preventDefault()
    event.stopPropagation()
    if (!action) return
    void performWikidotMembershipAction(element, action, runtime)
  }
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (event.key === " " || event.key === "Enter") activate(event)
  }

  root.addEventListener("click", activate, true)
  root.addEventListener("keydown", keydown, true)
  return {
    destroy() {
      for (const element of elements) boundActions.delete(element)
      root.removeEventListener("click", activate, true)
      root.removeEventListener("keydown", keydown, true)
    },
    /**
     * @param {{
     *   actions: MembershipBrowserAction[]
     *   runtime: MembershipActionRuntime
     * }} next
     */
    update(next) {
      runtime = next.runtime
      refresh(next.actions)
    }
  }
}
