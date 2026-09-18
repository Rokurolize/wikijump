const AJAX_MODULE_CONNECTOR_HEADERS = {
  "cache-control": "no-store",
  "content-type": "text/plain; charset=UTF-8"
}

const isValidAjaxModuleStatus = (status) =>
  typeof status === "string" && status.length > 0

/**
 * @param {Record<string, unknown>} body
 * @param {number} [status]
 * @param {HeadersInit} [extraHeaders]
 */
export const jsonResponse = (body, status = 200, extraHeaders = {}) =>
  new Response(
    JSON.stringify(
      isValidAjaxModuleStatus(body.status) ? body : { ...body, status: "not_ok" }
    ),
    {
      status,
      headers: { ...AJAX_MODULE_CONNECTOR_HEADERS, ...extraHeaders }
    }
  )
