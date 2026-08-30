;(() => {
  const current = document.currentScript
  const previous = current?.previousElementSibling
  const direct = previous?.classList.contains("yui-navset")
  const tabView = direct
    ? previous
    : (previous?.querySelector(".yui-navset") ??
      [...document.querySelectorAll(".yui-navset")].at(-1))
  if (!(tabView instanceof HTMLElement) || !tabView.classList.contains("yui-navset")) {
    return
  }
  const generatedRow = tabView.parentElement?.classList.contains("list-pages-item")

  const activate = () => {
    const generatedStyles = [
      ...document.querySelectorAll("style[data-wikidot-generated-css]")
    ]
    const needsTrailingGeneratedCss = generatedStyles.some((node) =>
      /\.yui-navset\.yui-navset-top[^{]*\{[^}]*display:\s*grid/u.test(
        node.textContent ?? ""
      )
    )
    if (
      needsTrailingGeneratedCss &&
      !document.querySelector("style[data-wikidot-tabview-generated-css]")
    ) {
      const style = document.createElement("style")
      style.dataset.wikidotTabviewGeneratedCss = "true"
      style.textContent = generatedStyles
        .flatMap(
          (node) =>
            (node.textContent ?? "").match(
              /[^{}]*\b(?:yui-navset|yui-nav|yui-content)\b[^{}]*\{[^{}]*\}/gu
            ) ?? []
        )
        .join("\n")
      document.head.append(style)
    }
    tabView.classList.add("yui-navset-top")
    tabView
      .querySelector(":scope > .yui-nav > li.selected")
      ?.setAttribute("title", "active")
  }

  const activateWhenWikidotReady = () => {
    if (
      document.readyState !== "loading" &&
      document.body &&
      document.getElementById("dummy-ondomready-block")
    ) {
      activate()
      return
    }
    setTimeout(activateWhenWikidotReady, 200)
  }

  if (direct && !generatedRow) activateWhenWikidotReady()
  else {
    activate()
    tabView.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) return
      const link = event.target.closest(".yui-nav > li > a")
      if (!(link instanceof HTMLAnchorElement) || !tabView.contains(link)) return
      const item = link.parentElement
      const tabList = item?.parentElement
      const content = tabView.querySelector(":scope > .yui-content")
      const items =
        tabList?.tagName === "UL"
          ? [...tabList.children].filter((child) => child.tagName === "LI")
          : []
      const panels = content ? [...content.children] : []
      const selectedIndex = items.indexOf(item)
      if (selectedIndex < 0 || selectedIndex >= panels.length) return
      for (const [index, tabItem] of items.entries()) {
        tabItem.classList.toggle("selected", index === selectedIndex)
        if (index === selectedIndex) tabItem.setAttribute("title", "active")
        else tabItem.removeAttribute("title")
      }
      for (const [index, panel] of panels.entries()) {
        if (panel instanceof HTMLElement)
          panel.style.display = index === selectedIndex ? "block" : "none"
      }
      event.preventDefault()
    })
  }
})()
