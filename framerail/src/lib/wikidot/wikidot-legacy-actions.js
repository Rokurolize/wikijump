/**
 * @typedef {{ type: "edit" | "history" | "source" | "print" }
 *   | { type: "set-tags"; index: number; fingerprint: string }} LegacyBrowserAction
 */
/**
 * @typedef {LegacyBrowserAction
 *   | { type: "rate"; value: -1 | 1 | 2 | 3 | 4 | 5 }
 *   | { type: "rate-cancel" }} BoundAction
 */
/**
 * @typedef {{
 *   edit?: () => unknown
 *   history?: () => unknown
 *   source?: () => unknown
 *   print?: () => unknown
 *   setTags?: (index: number, fingerprint: string) => unknown
 *   rate?: (value: number, element: HTMLElement) => unknown
 *   cancelRate?: (element: HTMLElement) => unknown
 *   error?: (error: unknown) => unknown
 * }} LegacyActionRuntime
 */
/**
 * @typedef {{
 *   actions: LegacyBrowserAction[]
 *   runtime: LegacyActionRuntime
 * }} LegacyActionParameters
 */
/**
 * @typedef {{
 *   parentElement: ActionControl | null
 *   removeAttribute(name: string): void
 *   setAttribute(name: string, value: string): void
 * }} ActionControl
 */

/** @type {WeakMap<ActionControl, BoundAction>} */
const boundActions = new WeakMap()
/** @type {WeakSet<ActionControl>} */
const busyActions = new WeakSet()

/**
 * @param {ActionControl} element
 * @param {BoundAction} action
 * @param {LegacyActionRuntime} runtime
 */
const operationFor = (element, action, runtime) => {
  switch (action.type) {
    case "edit":
      return runtime.edit
    case "history":
      return runtime.history
    case "source":
      return runtime.source
    case "print":
      return runtime.print
    case "set-tags":
      return Number.isSafeInteger(action.index) &&
        action.index >= 0 &&
        /^[0-9a-f]{32}$/u.test(action.fingerprint) &&
        runtime.setTags
        ? () => runtime.setTags?.(action.index, action.fingerprint)
        : undefined
    case "rate":
      return runtime.rate
        ? () => runtime.rate?.(action.value, /** @type {HTMLElement} */ (element))
        : undefined
    case "rate-cancel":
      return runtime.cancelRate
        ? () => runtime.cancelRate?.(/** @type {HTMLElement} */ (element))
        : undefined
    default:
      return undefined
  }
}

/**
 * Execute one server-issued Wikidot action descriptor. The closed switch
 * is the browser authority boundary: authored attributes never select a
 * function, URL, vote value, or tag mutation payload.
 *
 * @param {ActionControl} element
 * @param {BoundAction} action
 * @param {LegacyActionRuntime} runtime
 * @returns {Promise<boolean>}
 */
export const performWikidotLegacyAction = async (element, action, runtime) => {
  if (busyActions.has(element)) return false

  const operation = operationFor(element, action, runtime)
  if (!operation) return false

  busyActions.add(element)
  element.setAttribute("aria-busy", "true")
  try {
    await operation()
    return true
  } catch (error) {
    runtime.error?.(error)
    return false
  } finally {
    busyActions.delete(element)
    element.removeAttribute("aria-busy")
  }
}

const STAR_TITLES = ["Poor", "Fair", "Good", "Very Good", "Excellent"]

/** @param {number} rating @param {number} index */
const starAsset = (rating, index) => {
  const threshold = index + 1
  const file =
    rating >= threshold
      ? "star-on.png"
      : rating >= threshold - 0.5
        ? "star-half.png"
        : "star-off.png"
  return `/common--images/jquery-raty/${file}`
}

/**
 * @param {Set<ActionControl>} elements
 * @param {ActionControl | null | undefined} element
 * @param {BoundAction} action
 */
const bind = (elements, element, action) => {
  if (!element) return
  boundActions.set(element, action)
  elements.add(element)
}

/**
 * @param {HTMLElement} root
 * @param {LegacyBrowserAction[]} actions
 * @param {Set<ActionControl>} elements
 */
const bindStandaloneActions = (root, actions, elements) => {
  const candidates = [
    ...root.querySelectorAll('a.wiki-standalone-button[href="javascript:;"]')
  ]
  for (const [element, action] of planWikidotStandaloneActionBindings(
    /** @type {ActionControl[]} */ (candidates),
    actions
  )) {
    bind(elements, element, action)
  }
}

/**
 * Match exact legacy anchors to the out-of-band typed sidecar. Any extra,
 * missing, or unknown entry disables the whole standalone-action surface.
 *
 * @param {ActionControl[]} candidates
 * @param {LegacyBrowserAction[]} actions
 * @returns {[ActionControl, LegacyBrowserAction][]}
 */
export const planWikidotStandaloneActionBindings = (candidates, actions) => {
  if (candidates.length !== actions.length) return []
  if (
    actions.some(
      (action) =>
        !["edit", "history", "source", "print", "set-tags"].includes(action.type) ||
        (action.type === "set-tags" &&
          (!Number.isSafeInteger(action.index) ||
            action.index < 0 ||
            !/^[0-9a-f]{32}$/u.test(action.fingerprint)))
    )
  ) {
    return []
  }
  return actions.map((action, index) => [candidates[index], action])
}

/** @param {HTMLElement} root @param {Set<ActionControl>} elements */
const interceptRateControls = (root, elements) => {
  for (const element of root.querySelectorAll(
    '.page-rate-widget-box > .rateup > a[href="javascript:;"]'
  )) {
    elements.add(element)
  }
  for (const element of root.querySelectorAll(
    '.page-rate-widget-box > .ratedown > a[href="javascript:;"]'
  )) {
    elements.add(element)
  }
  for (const element of root.querySelectorAll(
    '.page-rate-widget-box > .cancel > a[href="javascript:;"]'
  )) {
    elements.add(element)
  }
}

/**
 * Initialize the browser-only children present in live five-star widgets.
 *
 * @param {HTMLElement} root
 * @param {Set<ActionControl>} elements
 */
const initializeWikidotRateWidgets = (root, elements) => {
  for (const widget of /** @type {NodeListOf<HTMLElement>} */ (
    root.querySelectorAll(".page-rate-widget-start")
  )) {
    if (widget.querySelector("img")) continue
    const rating = Number.parseFloat(widget.dataset.rating ?? "0") || 0
    widget.style.cursor = "pointer"
    widget.style.width = "100px"
    for (let index = 0; index < STAR_TITLES.length; index += 1) {
      const image = widget.ownerDocument.createElement("img")
      image.alt = `${index + 1}`
      image.title = STAR_TITLES[index]
      image.src = starAsset(rating, index)
      elements.add(image)
      widget.append(image)
      if (index < STAR_TITLES.length - 1) widget.append("\u00a0")
    }
    const score = widget.ownerDocument.createElement("input")
    score.name = "score"
    score.type = "hidden"
    widget.append(score)
  }
}

/**
 * Apply only the score returned by Deepwell after a vote mutation.
 *
 * @param {HTMLElement} element
 * @param {unknown} score
 */
export const updateWikidotRateWidget = (element, score) => {
  const widget = element.closest(".page-rate-widget-box, .page-rate-widget")
  const numericScore = Number(score)
  if (!widget || !Number.isFinite(numericScore)) return
  const points = widget.querySelector(".rate-points .number")
  if (points) {
    points.textContent = numericScore > 0 ? `+${numericScore}` : `${numericScore}`
  }
  const stars = /** @type {HTMLElement | null} */ (
    widget.querySelector(".page-rate-widget-start")
  )
  if (!stars) return
  stars.dataset.rating = `${numericScore}`
  for (const [index, image] of [
    .../** @type {NodeListOf<HTMLImageElement>} */ (stars.querySelectorAll("img"))
  ].entries()) {
    image.src = starAsset(numericScore, index)
  }
}

/**
 * Install delegated browser behavior for the fixed legacy action registry.
 * Dynamic rendered HTML remains inert unless the out-of-band Deepwell
 * sidecar matches its exact legacy control count.
 *
 * @param {HTMLElement} root
 * @param {LegacyActionParameters} parameters
 */
export const wikidotLegacyActions = (root, parameters) => {
  /** @type {Set<ActionControl>} */
  const elements = new Set()
  let runtime = parameters.runtime

  /** @param {LegacyBrowserAction[]} actions */
  const refresh = (actions) => {
    for (const element of elements) boundActions.delete(element)
    elements.clear()
    bindStandaloneActions(root, actions, elements)
    interceptRateControls(root, elements)
    initializeWikidotRateWidgets(root, elements)
  }
  refresh(parameters.actions)

  /** @param {Event} event */
  const actionElement = (event) => {
    let element = /** @type {ActionControl | null} */ (event.target)
    while (element && element !== root) {
      if (elements.has(element)) return element
      element = element.parentElement
    }
    return undefined
  }
  /** @param {Event} event */
  const activate = (event) => {
    const element = actionElement(event)
    if (!element) return undefined
    const action = boundActions.get(element)
    event.preventDefault()
    event.stopPropagation()
    if (!action) return undefined
    return performWikidotLegacyAction(element, action, runtime)
  }
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (event.key !== " ") return undefined
    return activate(event)
  }

  root.addEventListener("click", activate, true)
  root.addEventListener("keydown", keydown, true)
  return {
    destroy() {
      for (const element of elements) boundActions.delete(element)
      root.removeEventListener("click", activate, true)
      root.removeEventListener("keydown", keydown, true)
    },
    /** @param {LegacyActionParameters} nextParameters */
    update(nextParameters) {
      runtime = nextParameters.runtime
      refresh(nextParameters.actions)
    }
  }
}
