import { mount } from "svelte"

import ErrorPage from "../../src/routes/+error.svelte"

mount(ErrorPage, {
  target: document.getElementById("app")!
})
