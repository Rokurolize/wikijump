import { fixtureState, pageById, requestContextHeaders } from "./context.ts"
import { pages } from "./data.ts"
import { renderFixtureWikitext } from "./render-fixture.ts"
import { sendRpcError } from "./response.ts"

const rustLines = (text: string): string[] => {
  const lines: string[] = []
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "\n") continue
    lines.push(text.slice(start, text[index - 1] === "\r" ? index - 1 : index))
    start = index + 1
  }
  if (start < text.length) lines.push(text.slice(start))
  return lines
}

const headingLevel = (line: string): number | null => {
  let pluses = 0
  while (pluses < line.length && line[pluses] === "+") pluses += 1
  if (pluses === 0 || pluses > 6) return null
  let rest = line.slice(pluses)
  if (rest.startsWith("*")) rest = rest.slice(1)
  return rest === "" || rest.startsWith(" ") ? pluses : null
}

const spliceSection = (
  wikitext: string,
  sectionIndex: number,
  replacement: string
): string | null => {
  if (sectionIndex < 0) return null
  const trailingNewline = wikitext.endsWith("\n")
  const lines = rustLines(wikitext)
  const headings = lines.flatMap((line, index) => {
    const level = headingLevel(line)
    return level === null ? [] : [{ index, level }]
  })
  const heading = headings[sectionIndex]
  if (!heading) return null
  const end =
    headings.slice(sectionIndex + 1).find((other) => other.level <= heading.level)
      ?.index ?? lines.length
  const spliced = [
    ...lines.slice(0, heading.index),
    ...rustLines(replacement),
    ...lines.slice(end)
  ].join("\n")
  return trailingNewline && spliced !== "" ? `${spliced}\n` : spliced
}

const appendWikitext = (wikitext: string, addition: string): string => {
  if (addition === "") return wikitext
  if (wikitext === "") return addition
  return wikitext.endsWith("\n") ? `${wikitext}${addition}` : `${wikitext}\n${addition}`
}

export const handlePageEditRpc = ({
  rpcRequest,
  request,
  response
}: {
  rpcRequest: any
  request: import("node:http").IncomingMessage
  response: import("node:http").ServerResponse
}) => {
  if (
    rpcRequest.method !== "page_edit" ||
    rpcRequest.params.site_id !== 6000005 ||
    !(
      (typeof rpcRequest.params.page === "string" && pages[rpcRequest.params.page]) ||
      (typeof rpcRequest.params.page === "number" && pageById(rpcRequest.params.page))
    ) ||
    typeof rpcRequest.params.last_revision_id !== "number" ||
    typeof rpcRequest.params.revision_comments !== "string" ||
    typeof rpcRequest.params.user_id !== "number" ||
    typeof rpcRequest.params.ip_address !== "string" ||
    request.headers["x-deepwell-session-token"] !== "fixture-session-token" ||
    request.headers["x-deepwell-site-id"] !== "6000005" ||
    request.headers["x-deepwell-page"] !==
      (typeof rpcRequest.params.page === "string"
        ? rpcRequest.params.page
        : pageById(rpcRequest.params.page)?.slug)
  ) {
    return undefined
  }

  const page =
    typeof rpcRequest.params.page === "string"
      ? pages[rpcRequest.params.page]
      : pageById(rpcRequest.params.page)
  if (!page) return undefined
  const lease = rpcRequest.params.lease
  if (typeof rpcRequest.params.wikitext === "string" && lease) {
    const held = fixtureState.editLocks[page.slug]
    if (
      !held ||
      lease.lock_id !== held.lock_id ||
      lease["lock_secret"] !== held.secret ||
      lease.mode !== held.mode
    ) {
      sendRpcError(
        response,
        rpcRequest.id,
        4304,
        "Fixture page edit requires a matching edit lease"
      )
      return { responded: true }
    }
    delete fixtureState.editLocks[page.slug]
  }

  const { counters, pageWriteRequests } = fixtureState
  pageWriteRequests.pageEdit.push({
    headers: requestContextHeaders(request),
    params: rpcRequest.params
  })
  if (typeof rpcRequest.params.wikitext === "string") {
    let effectiveWikitext = rpcRequest.params.wikitext
    if (lease?.mode === "append") {
      effectiveWikitext = appendWikitext(page.wikitext, rpcRequest.params.wikitext)
    } else if (lease?.mode === "section") {
      const spliced = spliceSection(
        page.wikitext,
        lease.section_index,
        rpcRequest.params.wikitext
      )
      if (spliced === null) {
        sendRpcError(response, rpcRequest.id, 4000, "Fixture section is unavailable")
        return { responded: true }
      }
      effectiveWikitext = spliced
    }
    const effectiveTags = Array.isArray(rpcRequest.params.tags)
      ? rpcRequest.params.tags
      : page.tags
    page.wikitext = effectiveWikitext
    page.compiled_body_html = renderFixtureWikitext(effectiveWikitext, effectiveTags)
  }
  if (typeof rpcRequest.params.title === "string") page.title = rpcRequest.params.title
  if (Array.isArray(rpcRequest.params.tags)) page.tags = rpcRequest.params.tags
  page.page_updated_at = "2026-06-29T00:01:00Z"
  page.revision_created_at = "2026-06-29T00:01:00Z"
  page.revision_user_id = rpcRequest.params.user_id
  page.revision_id = counters.nextRevisionId++
  page.page_revision_count += 1
  return {
    result: {
      revision_id: page.revision_id,
      revision_number: page.page_revision_count - 1
    }
  }
}
