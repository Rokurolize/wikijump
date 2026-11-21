export const page = {
  error: {
    view: "missing",
    options: {},
    forms: {
      pageEditForm: {
        title: "",
        altTitle: "",
        wikitext: "",
        tags: "",
        layout: null,
        comments: ""
      },
      pageRestoreForm: { pageId: 0, lastRevisionId: 0, comments: "" }
    },
    internationalization: new Proxy(
      {},
      { get: (_target, key) => (typeof key === "string" ? key : "") }
    ),
    compiled_body_html: "<p>Page not found</p>",
    site: { site_id: 6000001, default_page: "r8-radio-fixture-page" }
  },
  data: { site: { site_id: 6000001 } },
  params: { slug: "r8-radio-fixture-page" }
}
