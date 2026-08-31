/**
 * Minimal Wikidot Gallery lightbox compatibility.
 *
 * Wikidot keeps `a.with-lb` in the static Gallery DOM even when the viewer
 * is disabled. Keep activation scoped by the corresponding Gallery source
 * flag so custom links and viewer-disabled galleries retain normal
 * navigation.
 */

/**
 * @typedef {{
 *   index: number
 *   anchors: HTMLAnchorElement[]
 *   overlay: HTMLDivElement
 *   lightbox: HTMLDivElement
 *   image: HTMLImageElement
 *   imageBox: HTMLDivElement
 *   loading: HTMLDivElement
 *   nav: HTMLDivElement
 *   previous: HTMLAnchorElement
 *   next: HTMLAnchorElement
 *   dataBox: HTMLDivElement
 *   caption: HTMLSpanElement
 *   currentNumber: HTMLSpanElement
 *   loadSequence: number
 * }} GalleryLightboxState
 */

const element = (document, tag, id) => {
  const value = document.createElement(tag)
  value.id = id
  return value
}

const galleryAnchors = (anchor) => {
  const gallery = anchor.closest(".gallery-box")
  if (!gallery) return []
  return Array.from(gallery.querySelectorAll("a.with-lb")).filter(
    (candidate) => candidate instanceof HTMLAnchorElement
  )
}

const documentHeight = (document) =>
  Math.max(
    document.body?.scrollHeight ?? 0,
    document.documentElement?.scrollHeight ?? 0,
    document.body?.offsetHeight ?? 0,
    document.documentElement?.offsetHeight ?? 0
  )

const galleryViewerFlags = (wikitext) => {
  if (typeof wikitext !== "string" || wikitext === "") return []
  const flags = []
  const opening = /^[\t ]*\[\[gallery(?:[\t ]+([^\]\r\n]*))?\]\][\t ]*$/gimu
  for (const match of wikitext.matchAll(opening)) {
    const argumentsText = match[1] ?? ""
    const viewerValues = [
      ...argumentsText.matchAll(/\bviewer[\t ]*=[\t ]*"([^"]*)"/giu)
    ].map((entry) => entry[1].toLowerCase())
    const viewer = viewerValues.at(-1)
    flags.push(viewer === undefined || viewer === "yes" || viewer === "true")
  }
  return flags
}

const galleryRequirementIndex = (gallery) => {
  const match = /^gallery-box-(\d+)$/u.exec(gallery.id)
  if (!match) return null
  const index = Number(match[1]) - 1
  return Number.isSafeInteger(index) && index >= 0 ? index : null
}

/**
 * Page-scoped Svelte action for Wikidot Gallery LightBox behavior.
 *
 * Deepwell numbers `gallery-box-N` by FTML Gallery requirement order. The
 * matching source order is therefore sufficient to distinguish the live
 * `viewer="false"` boundary without changing the public rendered DOM:
 * Wikidot retains `a.with-lb` in that state but omits the LightBox
 * initializer.
 *
 * @param {HTMLElement} root
 * @param {string | null | undefined} initialWikitext
 */
export const wikidotGalleryLightbox = (root, initialWikitext) => {
  const document = root.ownerDocument
  const window = document.defaultView
  if (!window) return {}
  let viewerFlags = galleryViewerFlags(initialWikitext)

  /** @type {GalleryLightboxState | null} */
  let state = null

  const close = () => {
    if (!state) return
    state.loadSequence += 1
    state.overlay.remove()
    state.lightbox.remove()
    state = null
  }

  const preload = (href) => {
    if (!href) return
    const image = new window.Image()
    image.src = href
  }

  const showIndex = (index) => {
    if (!state || index < 0 || index >= state.anchors.length) return
    state.index = index
    const sequence = ++state.loadSequence
    const anchor = state.anchors[index]

    state.loading.style.display = "block"
    state.image.style.display = "none"
    state.nav.style.display = "none"
    state.previous.style.display = "none"
    state.next.style.display = "none"
    state.dataBox.style.display = "none"
    state.currentNumber.style.display = "none"

    const loader = new window.Image()
    loader.addEventListener("load", () => {
      if (sequence !== state?.loadSequence) return
      const width = loader.naturalWidth || loader.width
      const height = loader.naturalHeight || loader.height
      state.image.src = anchor.href
      state.image.alt = anchor.querySelector("img")?.getAttribute("alt") ?? ""
      state.imageBox.style.width = `${width + 20}px`
      state.imageBox.style.height = `${height + 20}px`
      state.dataBox.style.width = `${width}px`
      state.loading.style.display = "none"
      state.image.style.display = "block"
      state.nav.style.display = "block"
      state.previous.style.display = index > 0 ? "block" : "none"
      state.next.style.display = index + 1 < state.anchors.length ? "block" : "none"
      state.caption.textContent = anchor.title || ""
      if (state.anchors.length > 1) {
        state.currentNumber.textContent = `image ${index + 1} of ${state.anchors.length}`
        state.currentNumber.style.display = "block"
      }
      state.dataBox.style.display = "block"

      preload(state.anchors[index - 1]?.href)
      preload(state.anchors[index + 1]?.href)
    })
    // Wikidot's lightbox has no image-error recovery callback.  Intentionally
    // leave the loading boundary visible when the selected image fails.
    loader.src = anchor.href
  }

  /** @param {HTMLAnchorElement} anchor */
  const open = (anchor) => {
    const anchors = galleryAnchors(anchor)
    const index = anchors.indexOf(anchor)
    if (index < 0 || anchors.length === 0) return
    close()

    const overlay = /** @type {HTMLDivElement} */ (
      element(document, "div", "jquery-overlay")
    )
    overlay.style.display = "block"
    overlay.style.backgroundColor = "#000"
    overlay.style.opacity = "0.8"
    overlay.style.height = `${documentHeight(document)}px`

    const lightbox = /** @type {HTMLDivElement} */ (
      element(document, "div", "jquery-lightbox")
    )
    lightbox.style.display = "block"
    lightbox.style.top = `${window.scrollY + 10}px`

    const imageBox = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-container-image-box")
    )
    const imageContainer = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-container-image")
    )
    const image = /** @type {HTMLImageElement} */ (
      element(document, "img", "lightbox-image")
    )
    image.style.display = "none"

    const loading = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-loading")
    )
    const loadingLink = /** @type {HTMLAnchorElement} */ (
      element(document, "a", "lightbox-loading-link")
    )
    loadingLink.href = "#"
    loading.append(loadingLink)

    const nav = /** @type {HTMLDivElement} */ (element(document, "div", "lightbox-nav"))
    nav.style.display = "none"
    const previous = /** @type {HTMLAnchorElement} */ (
      element(document, "a", "lightbox-nav-btnPrev")
    )
    previous.href = "#"
    previous.setAttribute("aria-label", "previous image")
    const next = /** @type {HTMLAnchorElement} */ (
      element(document, "a", "lightbox-nav-btnNext")
    )
    next.href = "#"
    next.setAttribute("aria-label", "next image")
    nav.append(previous, next)
    imageContainer.append(image, loading, nav)
    imageBox.append(imageContainer)

    const dataBox = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-container-image-data-box")
    )
    dataBox.style.display = "none"
    const data = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-container-image-data")
    )
    const details = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-image-details")
    )
    const caption = /** @type {HTMLSpanElement} */ (
      element(document, "span", "lightbox-image-details-caption")
    )
    const currentNumber = /** @type {HTMLSpanElement} */ (
      element(document, "span", "lightbox-image-details-currentNumber")
    )
    const secureNavigation = /** @type {HTMLDivElement} */ (
      element(document, "div", "lightbox-secNav")
    )
    const closeButton = /** @type {HTMLAnchorElement} */ (
      element(document, "a", "lightbox-secNav-btnClose")
    )
    closeButton.href = "#"
    closeButton.setAttribute("aria-label", "close image viewer")
    details.append(caption, currentNumber)
    secureNavigation.append(closeButton)
    data.append(details, secureNavigation)
    dataBox.append(data)
    lightbox.append(imageBox, dataBox)
    document.body.append(overlay, lightbox)

    state = {
      index,
      anchors,
      overlay,
      lightbox,
      image,
      imageBox,
      loading,
      nav,
      previous,
      next,
      dataBox,
      caption,
      currentNumber,
      loadSequence: 0
    }

    const navigation = (delta) => (event) => {
      event.preventDefault()
      if (state) showIndex(state.index + delta)
    }
    previous.addEventListener("click", navigation(-1))
    next.addEventListener("click", navigation(1))
    closeButton.addEventListener("click", (event) => {
      event.preventDefault()
      close()
    })
    loadingLink.addEventListener("click", (event) => {
      event.preventDefault()
      close()
    })
    overlay.addEventListener("click", close)
    showIndex(index)
  }

  const click = (event) => {
    const target =
      event.target instanceof Element ? event.target.closest("a.with-lb") : null
    if (!(target instanceof HTMLAnchorElement) || !root.contains(target)) return
    const gallery = target.closest(".gallery-box")
    if (!(gallery instanceof HTMLElement)) return
    const requirementIndex = galleryRequirementIndex(gallery)
    if (requirementIndex === null || viewerFlags[requirementIndex] !== true) return
    event.preventDefault()
    event.stopPropagation()
    open(target)
  }

  const keydown = (event) => {
    if (!state) return
    const key = event.key.toLowerCase()
    if (["escape", "c", "x"].includes(key)) {
      close()
      return
    }
    if (["arrowleft", "p"].includes(key) && state.index > 0) {
      showIndex(state.index - 1)
      return
    }
    if (["arrowright", "n"].includes(key) && state.index + 1 < state.anchors.length) {
      showIndex(state.index + 1)
    }
  }

  root.addEventListener("click", click)
  document.addEventListener("keydown", keydown)
  return {
    update(wikitext) {
      viewerFlags = galleryViewerFlags(wikitext)
      close()
    },
    destroy() {
      root.removeEventListener("click", click)
      document.removeEventListener("keydown", keydown)
      close()
    }
  }
}
