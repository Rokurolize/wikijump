function directChildWithClass(parent: Element, className: string): HTMLElement | null {
  const child = Array.from(parent.children).find((element) =>
    element.classList.contains(className)
  )
  return child instanceof HTMLElement ? child : null
}

function activateCollapsible(link: HTMLAnchorElement): boolean {
  const root = link.closest<HTMLElement>("div.collapsible-block")
  if (!root) return false

  const folded = directChildWithClass(root, "collapsible-block-folded")
  const unfolded = directChildWithClass(root, "collapsible-block-unfolded")
  if (!folded || !unfolded) return false

  if (folded.contains(link)) {
    folded.style.display = "none"
    unfolded.style.display = "block"
    return true
  }

  const hideControl = link.closest<HTMLElement>(".collapsible-block-unfolded-link")
  if (!hideControl || !unfolded.contains(hideControl)) return false

  folded.style.display = "block"
  unfolded.style.display = "none"
  return true
}

function accordionControl(node: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return null

  const link = target.closest<HTMLAnchorElement>(
    'a.accordion-toggle[data-toggle="collapse"]'
  )
  if (!link || !node.contains(link)) return null

  const href = link.getAttribute("href")
  if (!href?.startsWith("#")) return null

  try {
    const panel = node.querySelector(href)
    return panel instanceof HTMLElement ? { link, panel } : null
  } catch {
    return null
  }
}

function activateAccordion(control: {
  link: HTMLAnchorElement
  panel: HTMLElement
}): boolean {
  const expanded = control.panel.classList.toggle("in")
  control.link.setAttribute("aria-expanded", String(expanded))
  return true
}

function collapsibleLink(node: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return null

  const link = target.closest<HTMLAnchorElement>("a.collapsible-block-link")
  return link && node.contains(link) ? link : null
}

export function wikidotCollapsibles(node: HTMLElement) {
  const controller = new AbortController()

  node.addEventListener(
    "click",
    (event) => {
      const accordion = accordionControl(node, event.target)
      if (accordion && activateAccordion(accordion)) {
        event.preventDefault()
        return
      }

      const link = collapsibleLink(node, event.target)
      if (!link || !activateCollapsible(link)) return

      event.preventDefault()
    },
    { signal: controller.signal }
  )

  node.addEventListener(
    "keydown",
    (event) => {
      const accordion = accordionControl(node, event.target)
      if (
        accordion &&
        (event.key === " " || event.key === "Spacebar" || event.key === "Enter")
      ) {
        if (activateAccordion(accordion)) event.preventDefault()
        return
      }

      if (event.key !== " " && event.key !== "Spacebar") return

      const link = collapsibleLink(node, event.target)
      if (!link || !activateCollapsible(link)) return

      event.preventDefault()
    },
    { signal: controller.signal }
  )

  return {
    destroy() {
      controller.abort()
    }
  }
}
