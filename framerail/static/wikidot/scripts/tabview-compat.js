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

  const activate = () => {
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

  if (direct) activateWhenWikidotReady()
  else activate()
})()
