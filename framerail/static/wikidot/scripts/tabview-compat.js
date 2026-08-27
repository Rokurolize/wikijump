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
    if (tabView.classList.contains("yui-navset-top")) {
      const generatedStyles = [
        ...document.querySelectorAll("style[data-wikidot-generated-css]")
      ]
      if (
        generatedStyles.length > 0 &&
        !document.querySelector("style[data-wikidot-tabview-generated-css]")
      ) {
        const style = document.createElement("style")
        style.dataset.wikidotTabviewGeneratedCss = "true"
        style.textContent = generatedStyles
          .map((node) => node.textContent ?? "")
          .join("\n")
        document.head.append(style)
      }
    }
    tabView.classList.add("yui-navset-top")
    tabView
      .querySelector(":scope > .yui-nav > li.selected")
      ?.setAttribute("title", "active")
  }

  const activateWhenWikidotReady = () => {
    if (document.body && document.getElementById("dummy-ondomready-block")) {
      activate()
      return
    }
    setTimeout(activateWhenWikidotReady, 200)
  }

  if (direct && !generatedRow) activateWhenWikidotReady()
  else activate()
})()
