const LIST_PAGES_BOX_SELECTOR = ".list-pages-box[data-lp-id]"
const LIST_PAGES_PAGER_LINK_SELECTOR = ".pager a[href]"
const LIST_PAGES_SPINNER_CLASS = "list-pages-spinner"
const LIST_PAGES_STATUS_CLASS = "list-pages-status"
const LIST_PAGES_STATUS_HIDDEN_CLASS = "list-pages-status-hidden"
const LIST_PAGES_HISTORY_VERSION = 1
const LIST_PAGES_FETCH_TIMEOUT_MS = 15000
const LIST_PAGES_FETCH_WATCHDOG_MS = 16000

const LIST_PAGES_INJECTED_STYLE =
  ".list-pages-status-hidden{position:absolute!important;width:1px!important;height:1px!important;padding:0!important;margin:-1px!important;overflow:hidden!important;clip:rect(0,0,0,0)!important;clip-path:inset(50%)!important;white-space:nowrap!important;border:0!important;}.pager .list-pages-spinner{position:absolute;display:inline-block;box-sizing:border-box;width:1em;height:1em;margin:.2em 0 0 .5em;padding:0;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;background:transparent;animation:wd-list-pages-spin .7s linear infinite;}@keyframes wd-list-pages-spin{to{transform:rotate(360deg);}}@media(prefers-reduced-motion:reduce){.pager .list-pages-spinner{animation:none;}}"

const LIST_PAGES_PAGE_PATTERN = /\/(?:[^/]+_)?p\/[0-9]+(?=\/|$)/g
const LIST_PAGES_PAGINATOR_VALUE = /^[1-9][0-9]{0,8}$/
const LIST_PAGES_USER_INFO_HANDLER =
  /^WIKIDOT\.page\.listeners\.userInfo\([1-9][0-9]{0,9}\); return false;$/
const LIST_PAGES_EVENT_HANDLER_ATTRIBUTE = /^on[a-z]+$/iu
const LIST_PAGES_FORBIDDEN_CLASS =
  /^(?:footnote(?:s|ref)?(?:[-_].*)?|bib(?:cite|items?)?(?:[-_].*)?|math-equation(?:[-_].*)?|equation-ref(?:[-_].*)?|eref|yui-navset|wikidot-hybrid-module(?:[-_].*)?|foldable-list-container)$/iu
const LIST_PAGES_UNSAFE_CONTENT =
  "script,style,link,iframe,object,embed,form,.list-pages-box .list-pages-box"

type ListPagesRoot = Window & typeof globalThis

const listPagesPathOf = (url: URL): string => `${url.pathname}${url.search}${url.hash}`

const listPagesSameOrigin = (root: ListPagesRoot, href: string): URL | null => {
  let target: URL
  try {
    target = new URL(href, root.location.href)
  } catch {
    return null
  }
  if (target.origin !== root.location.origin) return null
  return target
}

const listPagesCookieValue = (root: ListPagesRoot, name: string): string => {
  for (const part of (root.document?.cookie ?? "").split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=")
    if (rawName === name) return rawValue.join("=")
  }
  return ""
}

const listPagesPaginatorPage = (pathname: string, key: string): string | null => {
  const segments = pathname.split("/")
  let found: string | null = null
  for (let index = 2; index < segments.length; index += 2) {
    if (segments[index] === key) {
      if (found !== null || !LIST_PAGES_PAGINATOR_VALUE.test(segments[index + 1] ?? "")) {
        throw new Error("ambiguous paginator")
      }
      found = segments[index + 1]
    }
  }
  return found
}

const listPagesRewriteUrl = (
  root: ListPagesRoot,
  route: string,
  currentPath: string,
  key: string,
  page: string
): string => {
  const base = listPagesSameOrigin(root, currentPath)
  if (!base) throw new Error("foreign destination")
  if (base.pathname === "/") base.pathname = `/${route}`
  const segments = base.pathname.split("/")
  let replaced = false
  for (let index = 2; index < segments.length; index += 2) {
    if (segments[index] === key) {
      segments[index + 1] = page
      replaced = true
    }
  }
  if (!replaced) segments.push(key, page)
  base.pathname = segments.join("/")
  return listPagesPathOf(base)
}

const listPagesRewritePagerHrefs = (root: ListPagesRoot, currentPath: string): void => {
  const route =
    root.document.querySelector(LIST_PAGES_BOX_SELECTOR)?.getAttribute("data-lp-route") ??
    ""
  const links = root.document.querySelectorAll<HTMLAnchorElement>(
    `${LIST_PAGES_BOX_SELECTOR} .pager[data-lp-key] a[href]`
  )
  for (const anchor of Array.from(links)) {
    let key = anchor.getAttribute("data-lp-link-key")
    let value = anchor.getAttribute("data-lp-link-value")
    if (!key) {
      const pager = anchor.closest(".pager")
      key = pager?.getAttribute("data-lp-key") ?? null
      if (!key) continue
      let parsed: URL | null
      try {
        parsed = listPagesSameOrigin(root, anchor.href)
      } catch {
        continue
      }
      if (!parsed) continue
      try {
        value = listPagesPaginatorPage(parsed.pathname, key)
      } catch {
        continue
      }
      if (!value) continue
      anchor.setAttribute("data-lp-link-key", key)
      anchor.setAttribute("data-lp-link-value", value)
    }
    if (!value) continue
    anchor.setAttribute("href", listPagesRewriteUrl(root, route, currentPath, key, value))
    const pagePatterns = anchor.href.match(LIST_PAGES_PAGE_PATTERN) ?? []
    const relations = (anchor.getAttribute("rel") ?? "")
      .split(/\s+/)
      .filter((token) => token && token !== "nofollow")
    if (pagePatterns.length >= 2) relations.push("nofollow")
    if (relations.length > 0) anchor.setAttribute("rel", relations.join(" "))
    else anchor.removeAttribute("rel")
  }
}

const listPagesContentIsSafe = (box: Element): boolean => {
  if (box.querySelector(LIST_PAGES_UNSAFE_CONTENT)) return false
  const elements = box.querySelectorAll("*")
  for (const element of Array.from(elements)) {
    for (const attribute of Array.from(element.attributes)) {
      if (!LIST_PAGES_EVENT_HANDLER_ATTRIBUTE.test(attribute.name)) continue
      if (
        element.tagName.toLowerCase() === "a" &&
        attribute.name.toLowerCase() === "onclick" &&
        LIST_PAGES_USER_INFO_HANDLER.test(attribute.value)
      ) {
        continue
      }
      return false
    }
    const classes = (element.getAttribute("class") ?? "").split(/\s+/)
    if (classes.some((token) => LIST_PAGES_FORBIDDEN_CLASS.test(token))) return false
  }
  return true
}

export const installListPagesPagination = (root: ListPagesRoot): (() => void) => {
  const noop = (): void => {}
  if (
    !root.history ||
    typeof root.history.pushState !== "function" ||
    typeof root.URL !== "function" ||
    typeof root.Set !== "function" ||
    typeof Object.assign !== "function" ||
    !root.Element?.prototype.matches ||
    !root.document?.addEventListener ||
    !("content" in root.document.createElement("template"))
  ) {
    return noop
  }
  const boxes = (): Element[] =>
    Array.from(root.document.querySelectorAll(LIST_PAGES_BOX_SELECTOR))
  const first = boxes()[0]
  if (!first) return noop

  const style = root.document.createElement("style")
  style.textContent = LIST_PAGES_INJECTED_STYLE
  root.document.head.appendChild(style)

  const pageId = first.getAttribute("data-lp-page")
  const generation = first.getAttribute("data-lp-generation")
  let currentPath = listPagesPathOf(new root.URL(root.location.href))
  const status = root.document.createElement("div")
  status.className = `${LIST_PAGES_STATUS_CLASS} ${LIST_PAGES_STATUS_HIDDEN_CLASS}`
  status.setAttribute("role", "status")
  status.setAttribute("aria-live", "polite")
  status.setAttribute("aria-atomic", "true")
  first.parentNode?.insertBefore(status, first)

  let busy = false
  let sequence = 0
  let pending: AbortController | null = null
  let watchdog: ReturnType<typeof setTimeout> | null = null

  const snapshotHistory = (url: string): Record<string, unknown> => ({
    wdListPages: {
      version: LIST_PAGES_HISTORY_VERSION,
      page: pageId,
      generation,
      url,
      x: root.scrollX,
      y: root.scrollY
    }
  })

  const setBusy = (active: boolean, instance: string | null): void => {
    busy = active
    for (const box of boxes()) {
      if (active) box.setAttribute("aria-busy", "true")
      else box.removeAttribute("aria-busy")
      for (const link of Array.from(box.querySelectorAll(".pager a"))) {
        if (active) link.setAttribute("aria-disabled", "true")
        else link.removeAttribute("aria-disabled")
      }
      for (const spinner of Array.from(
        box.querySelectorAll(`.${LIST_PAGES_SPINNER_CLASS}`)
      )) {
        spinner.parentNode?.removeChild(spinner)
      }
      if (active && box.getAttribute("data-lp-id") === instance) {
        const pager = box.querySelector(".pager")
        if (pager) {
          const spinner = root.document.createElement("span")
          spinner.className = LIST_PAGES_SPINNER_CLASS
          spinner.setAttribute("aria-hidden", "true")
          pager.appendChild(spinner)
        }
      }
    }
  }

  const setStatus = (message: string, hidden: boolean): void => {
    status.className = hidden
      ? `${LIST_PAGES_STATUS_CLASS} ${LIST_PAGES_STATUS_HIDDEN_CLASS}`
      : LIST_PAGES_STATUS_CLASS
    status.textContent = message
  }

  const clearPending = (): void => {
    if (watchdog !== null) {
      clearTimeout(watchdog)
      watchdog = null
    }
    pending?.abort()
    pending = null
    setBusy(false, null)
  }

  const navigateFallback = (target: string): void => {
    const url = listPagesSameOrigin(root, target)
    if (url) root.location.assign(listPagesPathOf(url))
  }

  const showError = (target: string, instance: string | null): void => {
    clearPending()
    setStatus("Could not load this page. ", false)
    const retry = root.document.createElement("button")
    retry.type = "button"
    retry.textContent = "Retry"
    retry.addEventListener("click", () => loadPage(target, instance))
    const open = root.document.createElement("a")
    open.href = target
    open.textContent = "Open page normally"
    status.append(retry, root.document.createTextNode(" "), open)
  }

  const swapBoxes = (response: Document): boolean => {
    const current = boxes()
    const currentIds = current.map((box) => box.getAttribute("data-lp-id"))
    if (new Set(currentIds).size !== currentIds.length) return false
    const incoming = Array.from(response.querySelectorAll(LIST_PAGES_BOX_SELECTOR))
    if (incoming.length !== current.length || incoming.length === 0) return false
    const pairs: [Element, Element][] = []
    for (const responseBox of incoming) {
      const id = responseBox.getAttribute("data-lp-id")
      const matches = current.filter((box) => box.getAttribute("data-lp-id") === id)
      if (matches.length !== 1) return false
      const currentBox = matches[0]
      if (
        responseBox.getAttribute("data-lp-generation") !==
          currentBox.getAttribute("data-lp-generation") ||
        responseBox.getAttribute("data-lp-page") !==
          currentBox.getAttribute("data-lp-page") ||
        responseBox.getAttribute("data-lp-key") !== currentBox.getAttribute("data-lp-key")
      ) {
        return false
      }
      if (!listPagesContentIsSafe(responseBox)) return false
      pairs.push([currentBox, responseBox])
    }
    for (const [currentBox, responseBox] of pairs) {
      currentBox.parentNode?.replaceChild(
        root.document.adoptNode(responseBox),
        currentBox
      )
    }
    return true
  }

  const commitLoad = (target: string, activeSequence: number): void => {
    if (activeSequence !== sequence) return
    try {
      root.history.replaceState(snapshotHistory(currentPath), "", currentPath)
      currentPath = target
      root.history.pushState(snapshotHistory(target), "", target)
      clearPending()
      setStatus("Page loaded.", true)
      listPagesRewritePagerHrefs(root, currentPath)
      const listPagesModule = (
        root as ListPagesRoot & {
          WIKIDOT?: { modules?: { ListPagesModule?: { init?: (box: Element) => void } } }
        }
      ).WIKIDOT?.modules?.ListPagesModule
      for (const box of boxes()) {
        try {
          listPagesModule?.init?.(box)
        } catch {
          break
        }
      }
      const active = root.document.activeElement
      if (active instanceof root.Element && active.closest(".pager")) {
        const current = boxes()[0]?.querySelector(".pager .current")
        if (current instanceof root.HTMLElement) {
          current.setAttribute("tabindex", "-1")
          current.focus({ preventScroll: true })
        }
      }
    } catch {
      clearPending()
      navigateFallback(target)
    }
  }

  const loadPage = (target: string, instance: string | null): void => {
    clearPending()
    setBusy(true, instance)
    setStatus("Loading page…", true)
    sequence += 1
    const activeSequence = sequence
    const controller = new root.AbortController()
    pending = controller
    watchdog = setTimeout(() => {
      if (activeSequence !== sequence) return
      sequence += 1
      pending?.abort()
      pending = null
      showError(target, instance)
    }, LIST_PAGES_FETCH_WATCHDOG_MS)
    const timeout = setTimeout(() => controller.abort(), LIST_PAGES_FETCH_TIMEOUT_MS)
    root
      .fetch(target, { signal: controller.signal, credentials: "same-origin" })
      .then(async (response) => {
        clearTimeout(timeout)
        if (activeSequence !== sequence) return
        let text: string
        try {
          if (!response.ok) throw new Error(`unexpected status ${response.status}`)
          text = await response.text()
        } catch {
          if (activeSequence !== sequence) return
          showError(target, instance)
          return
        }
        if (activeSequence !== sequence) return
        const parsed = new root.DOMParser().parseFromString(text, "text/html")
        if (!swapBoxes(parsed)) {
          clearPending()
          navigateFallback(target)
          return
        }
        commitLoad(target, activeSequence)
      })
      .catch(() => {
        clearTimeout(timeout)
        if (activeSequence !== sequence) return
        showError(target, instance)
      })
  }

  const onClick = (event: Event): void => {
    if (
      event.defaultPrevented ||
      !(event instanceof root.MouseEvent) ||
      event.button !== 0 ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    const target = event.target
    if (!(target instanceof root.Element)) return
    const link = target.closest(LIST_PAGES_PAGER_LINK_SELECTOR)
    if (!(link instanceof root.HTMLAnchorElement)) return
    if (link.hasAttribute("download") || (link.target && link.target !== "_self")) return
    let box: Element | null = null
    let cursor: Node | null = link
    while (cursor && cursor !== root.document) {
      if (cursor instanceof root.Element && cursor.matches(LIST_PAGES_BOX_SELECTOR)) {
        box = cursor
        break
      }
      cursor = cursor.parentNode
    }
    if (!box) return
    if (link.parentNode?.parentNode?.parentNode !== box) return
    const key = box.getAttribute("data-lp-key")
    if (!key) return
    let page: string | null
    try {
      const parsed = listPagesSameOrigin(root, link.href)
      if (!parsed) return
      page = listPagesPaginatorPage(parsed.pathname, key)
      if (!page) return
    } catch {
      return
    }
    if (!listPagesCookieValue(root, "wikidot_token7")) return
    event.preventDefault()
    if (busy) return
    loadPage(
      listPagesRewriteUrl(
        root,
        box.getAttribute("data-lp-route") ?? "",
        currentPath,
        key,
        page
      ),
      box.getAttribute("data-lp-id")
    )
  }

  const onPopState = (): void => {
    sequence += 1
    clearPending()
    navigateFallback(listPagesPathOf(new root.URL(root.location.href)))
  }

  try {
    root.history.replaceState(snapshotHistory(currentPath), "", currentPath)
    listPagesRewritePagerHrefs(root, currentPath)
  } catch {
    return noop
  }
  root.document.addEventListener("click", onClick, true)
  root.addEventListener("popstate", onPopState)
  return () => {
    sequence += 1
    // Stop the in-flight request and its timers; without this the fetch
    // and both timeouts outlive the script that started them.
    clearPending()
    root.document.removeEventListener("click", onClick, true)
    root.removeEventListener("popstate", onPopState)
    style.parentNode?.removeChild(style)
    status.parentNode?.removeChild(status)
  }
}
