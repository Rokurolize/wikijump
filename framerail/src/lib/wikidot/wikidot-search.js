export const wikidotSearchPath = (query) => `/search:site/q/${encodeURIComponent(query)}`

export const submitWikidotTopSearch = (event, windowObject) => {
  const input = event.currentTarget?.elements?.namedItem?.("query")
  if (typeof input?.value !== "string") return false
  event.preventDefault()
  windowObject.location.href = wikidotSearchPath(input.value)
  return true
}

export const wikidotSearchAllPath = (query, area) =>
  `/search:all/a/${area}/q/${encodeURIComponent(query)}`

export const installWikidotSearchAll = (windowObject) => {
  const submit = (event) => {
    const form = event.target
    if (form?.id !== "search-form-all") return
    event.preventDefault()
    const query = form.elements.namedItem("query").value
    const area = form.elements.namedItem("area").value
    windowObject.location.href = wikidotSearchAllPath(query, area)
  }

  // SearchAll's rendered form is part of the legacy page body. Intercept in
  // capture so page-level handlers cannot stop propagation before this route
  // owner gets a chance to cancel the placeholder `dummy` action.
  windowObject.document.addEventListener("submit", submit, true)
  return () => windowObject.document.removeEventListener("submit", submit, true)
}
