// Native WIKIDOT.page.fixers.fixFoldableMenus and _foldableMenuToggle:
// the container owns listeners, while its nearest LI owns fold state. A
// control-only container can therefore toggle a surrounding authored list.
export function wikidotFoldableLists(node) {
  const controller = new AbortController()
  const containers = new WeakSet()
  const originalDisplays = new WeakMap()
  const initialize = () => {
    for (const container of node.querySelectorAll("div.foldable-list-container")) {
      for (const list of container.querySelectorAll("ul")) {
        if (originalDisplays.has(list)) continue
        let parent = list.parentElement
        while (parent && !parent.classList.contains("foldable-list-container")) {
          if (parent.tagName === "LI") break
          parent = parent.parentElement
        }
        if (parent?.tagName !== "LI") continue
        originalDisplays.set(list, list.style.display)
        list.style.display = "none"
        parent.classList.add("folded")
        const first = parent.firstChild
        if (first && !(first instanceof HTMLAnchorElement)) {
          const link = document.createElement("a")
          link.href = "javascript:;"
          parent.insertBefore(link, first)
          link.append(first)
        }
      }
      for (const link of container.querySelectorAll("a")) {
        const target = link.href.replace(/^[a-z]*:\/\/[^/]+\/([^/]+).*/, "/$1")
        if (target !== window.location.pathname) continue
        let parent = link.parentElement
        while (parent && !parent.classList.contains("foldable-list-container")) {
          if (parent.tagName === "LI" && parent.classList.contains("folded")) {
            parent.classList.replace("folded", "unfolded")
            const list = parent.querySelector("ul")
            if (list) list.style.display = originalDisplays.get(list) ?? ""
          }
          parent = parent.parentElement
        }
      }
      if (containers.has(container)) continue
      containers.add(container)
      container.addEventListener("click", event => {
        let target = event.target instanceof Element ? event.target : event.target?.parentElement
        if (!target || target.tagName === "A" && target.href !== "#" && target.href !== "javascript:;") return
        while (target && target.tagName !== "LI") target = target.parentElement
        if (!target || !target.classList.contains("folded") && !target.classList.contains("unfolded")) return
        const list = target.querySelector("ul")
        if (!list) return
        const folded = target.classList.contains("folded")
        target.classList.replace(folded ? "folded" : "unfolded", folded ? "unfolded" : "folded")
        list.style.display = folded ? originalDisplays.get(list) ?? "" : "none"
        event.preventDefault()
      }, {signal: controller.signal})
    }
  }
  initialize()
  const observer = new MutationObserver(initialize)
  observer.observe(node, {childList: true, subtree: true})
  return {destroy() {observer.disconnect(); controller.abort()}}
}
