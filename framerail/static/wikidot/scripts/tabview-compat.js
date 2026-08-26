;(() => {
  const current = document.currentScript
  const tabView = current?.previousElementSibling
  if (!(tabView instanceof HTMLElement) || !tabView.classList.contains("yui-navset")) {
    return
  }

  const activate = () => {
    tabView.classList.add("yui-navset-top")
    tabView
      .querySelector(":scope > .yui-nav > li.selected")
      ?.setAttribute("title", "active")
  }

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", activate, { once: true })
  } else {
    activate()
  }
})()
