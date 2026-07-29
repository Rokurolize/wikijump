import { fixtureState, hasExactKeys, requestContextHeaders } from "./context.js"
import { pages, toArticleViewResult } from "./data.js"

const LISTPAGES_NAVIGATION_EXTRA = /^p\/[1-9][0-9]*$/u
const NEW_PAGE_EDIT_EXTRA = /^edit\/true(?:\/.*)?$/u
const DATA_FORM_CREATE_SLUG = "data-form-create-flow:example"
const DATA_FORM_EDIT_SLUG = "data-form-edit-flow:example"
const DATA_FORM_DEFINITION = {
  default_layout: true,
  fields: [
    {
      name: "name",
      label: "Name",
      hint: "",
      field_type: "text",
      values: [],
      default_value: null
    },
    {
      name: "choice",
      label: "Choice",
      hint: "",
      field_type: "select",
      values: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" }
      ],
      default_value: "b"
    }
  ]
}

/** @param {{ slug: string; extra: string }} route */
const pageForArticleRoute = (route) => {
  const page = pages[route.slug]
  if (!page) return null
  if (route.slug === "listpages-navigation") {
    if (route.extra !== "" && !LISTPAGES_NAVIGATION_EXTRA.test(route.extra)) {
      return null
    }
    return {
      ...page,
      compiled_body_html: [
        `<span id="listpages-route">${route.extra || "root"}</span>`,
        '<div class="pager">',
        '<span class="target"><a id="listpages-page-one" href="/listpages-navigation/p/1">1</a></span>',
        '<span class="target"><a id="listpages-page-two" href="/listpages-navigation/p/2">2</a></span>',
        "</div>"
      ].join("")
    }
  }
  if (route.slug === DATA_FORM_EDIT_SLUG && route.extra === "edit") return page
  return route.extra === "" ? page : null
}

const siteView = {
  site: {
    site_id: 6000005,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: null,
    deleted_at: null,
    from_wikidot: false,
    slug: "scp-wiki",
    name: "SCP Foundation",
    tagline: "Secure, Contain, Protect",
    description: "Fixture site",
    locale: "en",
    default_page: "main",
    top_bar_page: null,
    side_bar_page: null,
    preferred_domain: null,
    layout: "wikidot",
    license: "cc-by-sa-3.0"
  },
  site_file_domain: "scp-wiki.wjfiles.localhost",
  license_name: "CC BY-SA 3.0",
  license_url: "https://creativecommons.org/licenses/by-sa/3.0/",
  license_kind: "standard",
  license_html: null,
  user_session: null
}

/** @param {{ slug: string; extra: string }} route */
const missingPageArticleViewResult = (route) => ({
  ...siteView,
  article_page_cache_key: null,
  public_content_cache_fence: null,
  anonymous_permission_cache_fence: null,
  page: {
    type: "missing",
    data: {
      options: {
        edit: NEW_PAGE_EDIT_EXTRA.test(route.extra),
        title: null,
        parent: null,
        tags: null,
        no_redirect: false,
        no_render: false,
        debug: false,
        renderer: false,
        comments: false,
        history: false,
        offset: null,
        data: ""
      },
      redirect_page: null,
      wikitext: "",
      compiled_body_html: "",
      compiled_body_styles: [],
      compiled_top_bar_html: null,
      compiled_side_bar_html: null,
      new_page_wikitext: null,
      page_templates: [],
      selected_template_page_id: null,
      data_form:
        route.slug === DATA_FORM_CREATE_SLUG
          ? { definition: DATA_FORM_DEFINITION, values: {} }
          : null
    }
  }
})

/**
 * @param {{
 *   rpcRequest: any
 *   request: import("node:http").IncomingMessage
 * }} input
 */
export const handleArticleRpc = ({ rpcRequest, request }) => {
  const { articleReadRequests, pageReadRequests } = fixtureState
  let result

  if (
    rpcRequest.method === "article_view" &&
    ((hasExactKeys(rpcRequest.params, ["locales", "route", "site_id"]) &&
      rpcRequest.params.session_token === undefined) ||
      (hasExactKeys(rpcRequest.params, [
        "locales",
        "route",
        "session_token",
        "site_id"
      ]) &&
        rpcRequest.params.session_token === "fixture-session-token")) &&
    rpcRequest.params.site_id === 6000005 &&
    Array.isArray(rpcRequest.params.locales) &&
    hasExactKeys(rpcRequest.params.route, ["extra", "slug"]) &&
    typeof rpcRequest.params.route.slug === "string" &&
    (pageForArticleRoute(rpcRequest.params.route) ||
      (rpcRequest.params.route.slug === DATA_FORM_CREATE_SLUG &&
        rpcRequest.params.route.extra === "") ||
      NEW_PAGE_EDIT_EXTRA.test(rpcRequest.params.route.extra))
  ) {
    articleReadRequests.articleView.push(rpcRequest.params)
    const page = pageForArticleRoute(rpcRequest.params.route)
    if (page) {
      result = toArticleViewResult(page)
      if (
        rpcRequest.params.route.slug === DATA_FORM_EDIT_SLUG &&
        rpcRequest.params.route.extra === "edit"
      ) {
        result.page.data.options.edit = true
        result.page.data.data_form = {
          definition: DATA_FORM_DEFINITION,
          values: { name: "Probe Name", choice: "a" }
        }
      }
    } else {
      result = missingPageArticleViewResult(rpcRequest.params.route)
    }
  } else if (
    rpcRequest.method === "article_view_cache_metadata" &&
    hasExactKeys(rpcRequest.params, ["locales", "route", "session_token", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    rpcRequest.params.session_token === null &&
    Array.isArray(rpcRequest.params.locales) &&
    hasExactKeys(rpcRequest.params.route, ["extra", "slug"]) &&
    typeof rpcRequest.params.route.slug === "string" &&
    pageForArticleRoute(rpcRequest.params.route)
  ) {
    articleReadRequests.articleViewCacheMetadata.push(rpcRequest.params)
    const page = pageForArticleRoute(rpcRequest.params.route)
    if (!page) return undefined
    result = {
      article_page_cache_key: `deepwell:article-view:page:v1:site=6000005:page=${page.page_id}:rev=${page.revision_id}:updated=0:permission=site=0,user=0:body=fixture`,
      public_content_cache_fence: "0",
      anonymous_permission_cache_fence: "site=0,user=0"
    }
  } else if (
    rpcRequest.method === "page_view" &&
    hasExactKeys(rpcRequest.params, ["locales", "route", "session_token", "site_id"]) &&
    rpcRequest.params.site_id === 6000005 &&
    Array.isArray(rpcRequest.params.locales) &&
    rpcRequest.params.session_token === "fixture-session-token" &&
    request.headers["x-deepwell-session-token"] === "fixture-session-token" &&
    request.headers["x-deepwell-site-id"] === "6000005" &&
    hasExactKeys(rpcRequest.params.route, ["extra", "slug"]) &&
    typeof rpcRequest.params.route.slug === "string" &&
    rpcRequest.params.route.extra === ""
  ) {
    pageReadRequests.pageView.push({
      headers: requestContextHeaders(request),
      params: rpcRequest.params
    })
    const page = pages[rpcRequest.params.route.slug]
    result = page
      ? page.slug === "private-page"
        ? { type: "forbidden", data: {} }
        : { type: "found", data: { page: { slug: page.slug } } }
      : { type: "missing", data: {} }
  } else {
    return undefined
  }

  return { result }
}
