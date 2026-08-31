import { createHash } from "node:crypto"
import fs from "node:fs/promises"

const defaultCasesUrl = new URL("../fixtures/frontforum-custom-body/cases.json", import.meta.url)
const defaultOutputUrl = new URL("../artifacts/frontforum-custom-body-live-20260810.json", import.meta.url)
const sha256 = (value) => createHash("sha256").update(value).digest("hex")
const expectedEndpoint = "http://sandbox-for-codex.wikidot.com/ajax-module-connector.php"

function parseArguments(argv) {
  const options = { cases: defaultCasesUrl, output: defaultOutputUrl }
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index]
    const value = argv[index + 1]
    if (!value || !["--cases", "--output"].includes(flag)) {
      throw new Error("usage: capture-frontforum-custom-body.mjs [--cases PATH] [--output PATH]")
    }
    options[flag.slice(2)] = new URL(`file://${value.startsWith("/") ? "" : `${process.cwd()}/`}${value}`)
  }
  return options
}

async function postPreview(endpoint, caseId, source) {
  const request = {
    moduleName: "edit/PagePreviewModule",
    mode: "page",
    source,
    title: caseId,
  }
  const form = new URLSearchParams({ wikidot_token7: "123456", ...request })
  let response
  let lastError
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          cookie: "wikidot_token7=123456;",
          referer: "https://www.wikidot.com/",
          "user-agent": "WikidotPy",
        },
        body: form,
        signal: AbortSignal.timeout(20_000),
      })
      if (response.url !== endpoint || response.redirected) throw new Error(`${caseId}: Wikidot redirected the preview request`)
      if (response.status !== 503) break
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt))
  }
  if (!response) throw lastError
  const rawResponse = await response.text()
  if (response.status !== 200) throw new Error(`${caseId}: Wikidot returned HTTP ${response.status}`)
  const payload = JSON.parse(rawResponse)
  if (payload.status !== "ok" || typeof payload.body !== "string") {
    throw new Error(`${caseId}: unexpected PagePreviewModule response`)
  }
  return { httpStatus: response.status, payload, rawResponse, request }
}

function validateFixture(fixture) {
  if (fixture.schema !== "wikijump.frontforum_custom_body_cases.v1" || fixture.site !== "sandbox-for-codex" || fixture.actor !== "anonymous" || fixture.mutated !== false) {
    throw new Error("unsupported or mutating FrontForum capture fixture")
  }
  if (fixture.endpoint !== expectedEndpoint || !Array.isArray(fixture.cases) || fixture.cases.length === 0) {
    throw new Error("FrontForum capture fixture endpoint or cases are not sealed")
  }
  const endpoint = new URL(fixture.endpoint)
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "sandbox-for-codex.wikidot.com" || endpoint.port || endpoint.username || endpoint.password || endpoint.pathname !== "/ajax-module-connector.php" || endpoint.search || endpoint.hash) {
    throw new Error("FrontForum capture fixture endpoint is outside the sealed public seam")
  }
  for (const fixtureCase of fixture.cases) {
    if (typeof fixtureCase.case_id !== "string" || typeof fixtureCase.source !== "string" || !fixtureCase.selection || typeof fixtureCase.selection !== "object") {
      throw new Error("FrontForum capture fixture case is malformed")
    }
  }
}

function redactSandboxAuthor(body) {
  const slugs = [...body.matchAll(/www\.wikidot\.com\/user:info\/([^"/]+)/gu)].map((match) => match[1])
  let redacted = body
  for (const slug of new Set(slugs)) redacted = redacted.replaceAll(slug, "[REDACTED_SANDBOX_AUTHOR]")
  redacted = redacted.replace(/alt="[^"]+"/gu, 'alt="[REDACTED_SANDBOX_AUTHOR]"')
  redacted = redacted.replace(/(return false;"[^>]*>)[^<]+(<\/a>)/gu, "$1[REDACTED_SANDBOX_AUTHOR]$2")
  return { body: redacted, applied: redacted === body ? [] : ["sandbox author login ID and display name"] }
}

function threadIds(body) {
  return [...new Set([...body.matchAll(/\/forum\/t-(\d+)\//gu)].map((match) => Number(match[1])))]
}

function variableResults(caseId, body) {
  if (caseId === "frontforum-custom-body-canonical") {
    const checks = {
      title: /fw11-title/u,
      linked_title: /fw11-linked-title[\s\S]*<a href="\/forum\/t-\d+\//u,
      author: /fw11-author[\s\S]*class="printuser avatarhover"/u,
      date: /fw11-date[\s\S]*class="odate time_\d+/u,
      comments: /fw11-comments[\s\S]*>Comments: \d+<\/a>/u,
      category: /fw11-category[\s\S]*href="\/forum\/c-8503559\//u,
      description: /fw11-description/u,
      content: /fw11-content/u,
    }
    for (const [name, pattern] of Object.entries(checks)) {
      if (!pattern.test(body)) throw new Error(`${caseId}: ${name} did not populate`)
    }
    return {
      title: "populated",
      linked_title: "populated_link",
      author: "populated_printuser",
      date: "populated_odate",
      comments: "populated_link",
      category: "populated_link",
      description: "populated",
      content: "populated",
    }
  }
  if (caseId === "frontforum-custom-body-alias-offset-multi") {
    for (const marker of ["title-linked", "link", "short", "summary", "text", "long", "body"]) {
      if (!body.includes(`fw11-${marker}`)) throw new Error(`${caseId}: ${marker} body marker missing`)
    }
    if (threadIds(body).length !== 1) throw new Error(`${caseId}: expected one selected thread`)
    for (const variable of ["title_linked", "link", "short", "summary", "text", "long", "body"]) {
      if (body.includes(`%%${variable}%%`)) throw new Error(`${caseId}: ${variable} remained literal`)
    }
    return {
      title_linked: "populated_link",
      link: "populated_url",
      short: "populated",
      summary: "populated",
      text: "populated",
      long: "populated",
      body: "populated",
    }
  }
  if (caseId === "frontforum-custom-body-unknown") {
    if (!body.includes("%%unknown%%")) throw new Error(`${caseId}: unknown variable did not remain literal`)
    return { unknown: "literal" }
  }
  if (!body.includes('Problem parsing attribute "category"') || body.includes("FW11-OWNER-CONTROL")) {
    throw new Error(`${caseId}: malformed selector did not preserve the typed owner boundary`)
  }
  return { title: "not_evaluated_after_malformed_selector" }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const fixtureBytes = await fs.readFile(options.cases)
  const fixture = JSON.parse(fixtureBytes)
  validateFixture(fixture)

  const cases = []
  for (const fixtureCase of fixture.cases) {
    const capture = await postPreview(fixture.endpoint, fixtureCase.case_id, fixtureCase.source)
    const redacted = redactSandboxAuthor(capture.payload.body)
    const observedThreadIds = threadIds(capture.payload.body)
    cases.push({
      case_id: fixtureCase.case_id,
      control: fixtureCase.control,
      mutated: false,
      selection: fixtureCase.selection,
      variables: fixtureCase.variables,
      variable_results: variableResults(fixtureCase.case_id, capture.payload.body),
      thread_ids: observedThreadIds,
      selection_result: fixtureCase.case_id === "frontforum-custom-body-alias-offset-multi"
        ? {
            observed_thread_ids: observedThreadIds,
            requested_offset: fixtureCase.selection.offset,
            requested_category_ids: fixtureCase.selection.category_ids,
            observation: "one populated alias item rendered after combined-category offset selection",
          }
        : undefined,
      source: fixtureCase.source,
      source_sha256: sha256(fixtureCase.source),
      request: {
        method: "POST",
        url: fixture.endpoint,
        module_name: capture.request.moduleName,
        mode: capture.request.mode,
        title: capture.request.title,
      },
      response: {
        http_status: capture.httpStatus,
        status: capture.payload.status,
        title: capture.payload.title,
        current_timestamp: capture.payload.CURRENT_TIMESTAMP,
        body: redacted.body,
        body_sha256: sha256(redacted.body),
        unredacted_body_sha256: sha256(capture.payload.body),
        raw_response_sha256: sha256(capture.rawResponse),
        redactions: redacted.applied,
        js_include: capture.payload.jsInclude,
        css_include: capture.payload.cssInclude,
      },
    })
  }

  const scriptBytes = await fs.readFile(new URL(import.meta.url))
  const artifact = {
    schema: "wikijump.frontforum_custom_body_live_evidence.v1",
    captured_at: new Date().toISOString(),
    surface_ids: fixture.surface_ids,
    public_interface: fixture.public_interface,
    provenance: {
      actor: "anonymous",
      authenticated: false,
      mutated: false,
      site: fixture.site,
      capture_script: "install/local/wikidot-verification/scripts/capture-frontforum-custom-body.mjs",
      capture_script_sha256: sha256(scriptBytes),
    },
    inputs: {
      cases: "install/local/wikidot-verification/fixtures/frontforum-custom-body/cases.json",
      cases_sha256: sha256(fixtureBytes),
    },
    case_ids: cases.map(({ case_id }) => case_id),
    controls: {
      positive: cases.filter(({ control }) => control === "positive").length,
      negative: cases.filter(({ control }) => control === "negative").length,
    },
    ownership_boundary: {
      owner: "FrontForum body-bearing runtime module",
      observed: "A recognized body-bearing FrontForum consumes its closer and evaluates documented variables once per selected thread; an unknown variable remains literal; malformed category selection renders the module error without leaking the custom body.",
      forbidden_inferences: [
        "raw closer consumption outside the typed FrontForum owner",
        "feed or document-head ownership",
        "fixRelativeLinks behavior",
        "private or deleted visibility",
        "forum mutation authority",
      ],
    },
    cases,
  }
  await fs.writeFile(options.output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o644 })
  process.stdout.write(`${JSON.stringify({ cases: cases.length, mutated: false, output: options.output.pathname })}\n`)
}

await main()
