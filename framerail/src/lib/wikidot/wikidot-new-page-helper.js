/**
 * @typedef {{
 *   status?: string
 *   goToUrl?: string
 *   unixName?: string
 *   templateId?: string
 *   pageTitle?: string
 *   tags?: string
 *   parentPage?: string
 *   message?: string
 * }} NewPageHelperResponse
 *
 *
 * @typedef {{
 *   listeners: Record<string, (event: Event) => false>
 *   callbacks: Record<string, (data: NewPageHelperResponse) => void>
 * }} NewPageHelperModule
 *
 *
 * @typedef {Window &
 *   typeof globalThis & {
 *     WIKIDOT?: {
 *       modules?: {
 *         NewPageHelperModule?: NewPageHelperModule
 *       }
 *     }
 *     __wikijumpNewPageHelperSubmitListenerInstalled?: boolean
 *   }} WikidotNewPageRoot
 */

/**
 * @param {WikidotNewPageRoot} root
 * @returns {NewPageHelperModule}
 */
const ensureWikidotNamespace = (root) => {
  const wikidot = (root.WIKIDOT ??= {})
  const modules = (wikidot.modules ??= {})
  return (modules.NewPageHelperModule ??= { listeners: {}, callbacks: {} })
}

/**
 * @param {Event | undefined} event
 * @returns {Element | null}
 */
const eventTarget = (event) =>
  event && "target" in event && event.target instanceof Element ? event.target : null

/**
 * @param {Element | null} target
 * @returns {HTMLFormElement | null}
 */
const containingForm = (target) => {
  let cursor = target
  while (cursor && !(cursor instanceof HTMLFormElement)) {
    cursor = cursor.parentElement
  }
  return cursor instanceof HTMLFormElement ? cursor : null
}

/**
 * @param {WikidotNewPageRoot} root
 * @param {string} name
 */
const cookieValue = (root, name) => {
  const cookie = root.document?.cookie ?? ""
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (rawName === name) return rawValue.join("=")
  }
  return ""
}

/**
 * @param {WikidotNewPageRoot} root
 * @param {HTMLFormElement} form
 */
const formToUrlSearchParams = (root, form) => {
  const params = new URLSearchParams()
  for (const control of Array.from(form.elements)) {
    if (
      !(control instanceof HTMLInputElement) &&
      !(control instanceof HTMLSelectElement) &&
      !(control instanceof HTMLTextAreaElement)
    ) {
      continue
    }
    if (!control.name || control.disabled) continue
    if (
      control instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(control.type) &&
      !control.checked
    ) {
      continue
    }
    params.set(control.name, control.value)
  }
  params.set("action", "misc/NewPageHelperAction")
  params.set("event", "createNewPage")
  params.set("moduleName", "Empty")
  const wikidotToken7 = cookieValue(root, "wikidot_token7")
  if (wikidotToken7) params.set("wikidot_token7", wikidotToken7)
  return params
}

/**
 * @param {WikidotNewPageRoot} root
 * @param {NewPageHelperResponse} data
 */
const redirectFromNewPageResponse = (root, data) => {
  if (data.goToUrl) {
    if (data.goToUrl === ".") {
      root.location.reload()
      return
    }
    root.location.href = `/${data.goToUrl}`
    return
  }

  let path = `/${data.unixName ?? ""}/edit/true`
  if (data.templateId) path += `/t/${data.templateId}`
  if (data.pageTitle) path += `/title/${encodeURIComponent(data.pageTitle)}`
  if (data.tags) path += `/tags/${encodeURIComponent(data.tags)}`
  if (data.parentPage) path += `/parentPage/${encodeURIComponent(data.parentPage)}`
  root.location.href = path
}

/**
 * @param {WikidotNewPageRoot} root
 * @param {NewPageHelperResponse} data
 */
const handleNewPageError = (root, data) => {
  const message = data.message || data.status || "NewPage request failed"
  root.alert(message)
}

/** @param {HTMLFormElement} form */
const isNewPageHelperForm = (form) => {
  return (
    form.getAttribute("onsubmit")?.includes("NewPageHelperModule.listeners.create") ||
    form.closest(".new-page-box") !== null
  )
}

/** @param {WikidotNewPageRoot} [root] */
export const installWikidotNewPageHelper = (
  root = /** @type {WikidotNewPageRoot} */ (globalThis)
) => {
  const helper = ensureWikidotNamespace(root)
  helper.listeners ??= {}
  helper.callbacks ??= {}

  helper.callbacks.create = (data) => {
    if (data?.status !== "ok") {
      handleNewPageError(root, data ?? {})
      return
    }
    redirectFromNewPageResponse(root, data)
  }

  helper.listeners.create = (event) => {
    event?.preventDefault()
    event?.stopPropagation()

    const form = containingForm(eventTarget(event))
    if (!form) return false

    const templateSelect = form.querySelector("select[name='template']")
    if (templateSelect instanceof HTMLSelectElement && templateSelect.value === "") {
      root.alert("Please select a template.")
      return false
    }

    void fetch("/ajax-module-connector.php", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded"
      },
      body: formToUrlSearchParams(root, form),
      credentials: "same-origin"
    })
      .then((response) => response.json())
      .then((data) => helper.callbacks.create(data))
      .catch(() => {
        root.alert("NewPage request failed")
      })

    return false
  }

  if (!root.__wikijumpNewPageHelperSubmitListenerInstalled) {
    root.document?.addEventListener(
      "submit",
      (event) => {
        if (
          event.target instanceof HTMLFormElement &&
          isNewPageHelperForm(event.target)
        ) {
          helper.listeners.create(event)
        }
      },
      true
    )
    root.__wikijumpNewPageHelperSubmitListenerInstalled = true
  }

  return helper
}
