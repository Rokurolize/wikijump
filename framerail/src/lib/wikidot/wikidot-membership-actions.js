/**
 * @typedef {{
 *   type: "join" | "application" | "password" | "invitation"
 *   page_id: number
 *   revision_id: number
 *   index: number
 *   fingerprint: string
 * }} MembershipBrowserAction
 */
/**
 * @typedef {{
 *   join?: (
 *     pageId: number,
 *     revisionId: number,
 *     index: number,
 *     fingerprint: string
 *   ) => unknown
 *   application?: (
 *     pageId: number,
 *     revisionId: number,
 *     index: number,
 *     fingerprint: string,
 *     comment: string
 *   ) => unknown
 *   password?: (
 *     pageId: number,
 *     revisionId: number,
 *     index: number,
 *     fingerprint: string,
 *     password: string
 *   ) => unknown
 *   invitation?: (
 *     pageId: number,
 *     revisionId: number,
 *     index: number,
 *     fingerprint: string
 *   ) => unknown
 *   reload?: () => unknown
 *   error?: (error: unknown) => unknown
 * }} MembershipActionRuntime
 */

const JOIN_SELECTOR = `div > a[href="javascript:;"][onclick="WIKIDOT.page.listeners.join(event, 'unified')"]`
const APPLICATION_SELECTOR = `#membership-by-apply-form #mba-apply`
const PASSWORD_SELECTOR = `#membership-by-password-form #mbp-apply`
const INVITATION_SELECTOR = `#membership-email-invitation-box a[href="javascript:;"][onclick^="WIKIDOT.modules.MembershipEmailInvitationModule.listeners.accept"]`

/** @type {WeakMap<HTMLElement, MembershipBrowserAction>} */
const boundActions = new WeakMap()
/** @type {WeakSet<HTMLElement>} */
const busyActions = new WeakSet()

/** @param {MembershipBrowserAction} action */
const validMembershipAction = (action) =>
  !!action &&
  ["join", "application", "password", "invitation"].includes(action.type) &&
  Number.isSafeInteger(action.page_id) &&
  action.page_id > 0 &&
  Number.isSafeInteger(action.revision_id) &&
  action.revision_id > 0 &&
  Number.isSafeInteger(action.index) &&
  action.index >= 0 &&
  /^[0-9a-f]{32}$/u.test(action.fingerprint)

const selectorForAction = (type) => {
  if (type === "join") return JOIN_SELECTOR
  if (type === "application") return APPLICATION_SELECTOR
  if (type === "password") return PASSWORD_SELECTOR
  if (type === "invitation") return INVITATION_SELECTOR
  return undefined
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export const membershipEmailInvitationCongratulationsHtml = (siteName, siteSlug) => {
  const name = escapeHtml(siteName)
  const domain = escapeHtml(`${siteSlug}.wikidot.com`)
  return [
    "<h1>Congratulations!</h1>",
    `<p>You now a member of the site "${name}". Please click on the link below to go to this Site.</p>`,
    `<p style="text-align: center; font-weigh: bold; font-size: 140%;"><a href="http://${domain}">${domain}</a></p>`
  ].join("")
}

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
    actions.some((action) => !validMembershipAction(action) || action.type !== "join") ||
    candidates.some((candidate) => !candidate.matches(JOIN_SELECTOR))
  ) {
    return []
  }
  return actions.map((action, index) => [candidates[index], action])
}

const planTypedBindings = (candidates, actions, type) => {
  const selector = selectorForAction(type)
  if (
    !selector ||
    candidates.length !== actions.length ||
    actions.some((action) => !validMembershipAction(action) || action.type !== type) ||
    candidates.some((candidate) => !candidate.matches(selector))
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
  if (busyActions.has(element) || !validMembershipAction(action)) return false

  const handler = runtime[action.type]
  if (!handler) return false

  busyActions.add(element)
  element.setAttribute("aria-busy", "true")
  try {
    let result
    if (action.type === "application") {
      const form = element.closest?.("#membership-by-apply-form")
      const comment = form?.querySelector?.('[name="comment"]')?.value ?? ""
      result = await handler(
        action.page_id,
        action.revision_id,
        action.index,
        action.fingerprint,
        comment
      )
      if (result === "no_text") {
        runtime.error?.(new Error("You should write something in the box..."))
        return true
      }
    } else if (action.type === "password") {
      const form = element.closest?.("#membership-by-password-form")
      const password = form?.querySelector?.('[name="password"]')?.value ?? ""
      result = await handler(
        action.page_id,
        action.revision_id,
        action.index,
        action.fingerprint,
        password
      )
      if (result === "wrong_password") {
        const box = element.closest?.("#membership-by-password-box")
        const error = box?.querySelector?.("#mbp-error")
        if (error?.style) error.style.display = ""
        return true
      }
    } else if (action.type === "invitation") {
      result = await handler(
        action.page_id,
        action.revision_id,
        action.index,
        action.fingerprint
      )
      if (result?.status === "accepted") {
        const box = element.closest?.("#membership-email-invitation-box")
        if (box) {
          box.innerHTML = membershipEmailInvitationCongratulationsHtml(
            result.site_name,
            result.site_slug
          )
        }
        return true
      }
      if (result?.status === "already_member") {
        runtime.error?.(
          new Error(
            "It seems you already are a member of this site! Congratulations anyway ;-)"
          )
        )
        return true
      }
      if (result?.status === "unavailable") {
        runtime.error?.(new Error("Sorry, no invitation can be found."))
        return true
      }
    } else {
      result = await handler(
        action.page_id,
        action.revision_id,
        action.index,
        action.fingerprint
      )
    }
    runtime.reload?.(result)
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
    for (const type of ["join", "application", "password", "invitation"]) {
      const typedActions = actions.filter((action) => action?.type === type)
      if (typedActions.length === 0) continue
      const selector = selectorForAction(type)
      const candidates = /** @type {HTMLElement[]} */ ([
        ...root.querySelectorAll(selector)
      ])
      for (const element of candidates) elements.add(element)
      const bindings =
        type === "join"
          ? planWikidotJoinActionBindings(candidates, typedActions)
          : planTypedBindings(candidates, typedActions, type)
      for (const [element, action] of bindings) {
        boundActions.set(element, action)
      }
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
