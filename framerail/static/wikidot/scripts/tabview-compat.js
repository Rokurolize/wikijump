;(() => {
  const activate = () => {
    for (const tabView of document.querySelectorAll(".yui-navset")) {
      tabView.classList.add("yui-navset-top")
      tabView
        .querySelector(":scope > .yui-nav > li.selected")
        ?.setAttribute("title", "active")
    }
  }

  const activateWhenWikidotReady = () => {
    if (document.body && document.getElementById("dummy-ondomready-block")) {
      activate()
      return
    }
    setTimeout(activateWhenWikidotReady, 200)
  }

  activateWhenWikidotReady()
})()
