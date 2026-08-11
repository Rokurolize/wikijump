import crypto from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {visibleText as parsedVisibleText} from "../src/syntax-differential.mjs";

const ORIGIN = "http://sandbox-for-codex.wikidot.com";
const LOGIN_URL = "https://www.wikidot.com/default--flow/login__LoginPopupScreen";
const TOKEN = "123456";
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultCases = path.resolve(here, "../fixtures/data-form-date-pagepath/cases.json");
const defaultOutput = path.resolve(here, "../artifacts/data-form-date-pagepath-live-20260810.json");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseArgs(argv) {
  const args = {cases: defaultCases, output: defaultOutput};
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--cases" || flag === "--output") args[flag.slice(2)] = path.resolve(argv[++index]);
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function decodeHtml(value) {
  return value
    .replace(/<br\s*\/?>/giu, "\n")
    .replace(/<[^>]*>/gu, "")
    .replace(/&nbsp;/gu, " ")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function pageId(html) {
  const match = html.match(/WIKIREQUEST\.info\.pageId\s*=\s*([0-9]+)\s*;/u);
  return match ? Number(match[1]) : null;
}

function visibleText(html) {
  const content = html.match(/<div id="page-content"[^>]*>([\s\S]*?)<div class="page-tags"/u)?.[1]
    ?? html.match(/<div id="page-content"[^>]*>([\s\S]*?)<div class="page-info-break"/u)?.[1]
    ?? "";
  return parsedVisibleText(content)
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function fieldValues(body, name) {
  const values = [];
  const pattern = new RegExp(`<[^>]+name=["']${name}["'][^>]*>`, "giu");
  for (const [tag] of body.matchAll(pattern)) {
    const value = tag.match(/\bvalue=["']([^"']*)["']/iu)?.[1] ?? "";
    values.push(decodeHtml(value));
  }
  return values;
}

function validationMessages(body) {
  return [...body.matchAll(/<span class="form-message text-danger"[^>]*>([\s\S]*?)<\/span>/giu)]
    .map((match) => decodeHtml(match[1]).trim())
    .filter(Boolean);
}

class WikidotSession {
  async login(username, password) {
    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "WikidotPy"},
      body: new URLSearchParams({login: username, password, action: "Login2Action", event: "login"}),
      redirect: "manual",
    });
    const cookies = response.headers.getSetCookie();
    const session = cookies.map((cookie) => cookie.match(/^WIKIDOT_SESSION_ID=([^;]+)/u)?.[1]).find(Boolean);
    if (response.status !== 200 || !session) throw new Error("Wikidot authentication failed");
    this.cookie = `wikidot_token7=${TOKEN};WIKIDOT_SESSION_ID=${session};`;
  }

  async amc(fields) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${ORIGIN}/ajax-module-connector.php`, {
        method: "POST",
        headers: {
          cookie: this.cookie,
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "WikidotPy",
          referer: `${ORIGIN}/`,
        },
        body: new URLSearchParams({wikidot_token7: TOKEN, ...fields}),
        redirect: "manual",
      });
      if (response.status !== 200) throw new Error(`Wikidot Ajax returned HTTP ${response.status}`);
      const result = await response.json();
      if (!result || typeof result !== "object") throw new Error("Wikidot Ajax returned malformed JSON");
      if (result.status !== "try_again") return result;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error("Wikidot Ajax exhausted try_again retries");
  }

  async get(slug, authenticated = true) {
    const response = await fetch(`${ORIGIN}/${slug}?capture=${crypto.randomUUID()}`, {
      headers: authenticated ? {cookie: this.cookie, "user-agent": "WikidotPy"} : {"user-agent": "WikidotEvidenceCapture"},
      redirect: "manual",
    });
    const html = await response.text();
    return {status: response.status, html, id: pageId(html)};
  }

  async source(slug) {
    const page = await this.get(slug);
    if (page.status === 404 || page.id === null) return null;
    const response = await this.amc({moduleName: "viewsource/ViewSourceModule", page_id: String(page.id)});
    const fragment = response.body?.match(/<div class="page-source"[^>]*>([\s\S]*?)<\/div>/u)?.[1];
    if (typeof fragment !== "string") throw new Error(`source unavailable for ${slug}`);
    const text = decodeHtml(fragment.replace(/<br\s*\/?>/giu, "")).replace(/^\n/u, "").replace(/\n$/u, "");
    return {id: page.id, source: text.split("\n").map((line) => line.replace(/^\t/u, "")).join("\n")};
  }

  async editForm(slug, forceLock = false) {
    const response = await this.amc({mode: "page", wiki_page: slug, moduleName: "edit/PageEditModule", ...(forceLock ? {force_lock: "yes"} : {})});
    if (response.status !== "ok" || !response.lock_id || !response.lock_secret || typeof response.body !== "string") throw new Error(`edit form unavailable for ${slug}: ${JSON.stringify({status: response.status ?? null, locked: response.locked ?? null, other_locks: response.other_locks ?? null, has_lock_id: Boolean(response.lock_id), has_lock_secret: Boolean(response.lock_secret), has_body: typeof response.body === "string", message: response.message ?? null})}`);
    return response;
  }

  async saveGeneric(slug, title, source) {
    if ((await this.get(slug)).id !== null) throw new Error(`preexisting page refused: ${slug}`);
    const edit = await this.editForm(slug);
    const saved = await this.amc({
      action: "WikiPageAction",
      event: "savePage",
      moduleName: "Empty",
      mode: "page",
      lock_id: String(edit.lock_id),
      lock_secret: String(edit.lock_secret),
      revision_id: "",
      wiki_page: slug,
      page_id: "",
      title,
      source,
      comments: "FW-10 run-owned live evidence",
    });
    if (saved.status !== "ok") throw new Error(`generic save failed for ${slug}: ${JSON.stringify({status: saved.status ?? null, message: saved.message ?? null, body: typeof saved.body === "string" ? visibleText(saved.body).slice(0, 160) : null})}`);
    const created = await this.source(slug);
    if (!created || created.source !== source) {
      const difference = created ? [...source].findIndex((character, index) => character !== created.source[index]) : -1;
      throw new Error(`generic page did not round-trip: ${slug} expected=${sha256(source)} actual=${created ? sha256(created.source) : "absent"} bytes=${created?.source.length ?? 0} difference=${difference} actual_fragment=${JSON.stringify(created?.source.slice(Math.max(0, difference - 10), difference + 30) ?? null)}`);
    }
    await this.amc({tags: "codex-oracle", action: "WikiPageAction", event: "saveTags", pageId: String(created.id), moduleName: "Empty"});
    return created;
  }

  async setParent(slug, parent) {
    const page = await this.source(slug);
    if (!page) throw new Error(`cannot parent missing page: ${slug}`);
    const response = await this.amc({action: "WikiPageAction", event: "setParentPage", moduleName: "Empty", pageId: String(page.id), parentName: parent});
    if (response.status !== "ok") throw new Error(`setParentPage failed for ${slug}`);
  }

  async saveForm(slug, title, values) {
    const edit = await this.editForm(slug);
    const response = await this.amc({
      action: "WikiPageAction",
      event: "savePage",
      moduleName: "Empty",
      mode: "page",
      lock_id: String(edit.lock_id),
      lock_secret: String(edit.lock_secret),
      revision_id: String(edit.page_revision_id ?? ""),
      wiki_page: slug,
      page_id: String(edit.page_id ?? edit.pageId ?? ""),
      title,
      "form-use": "true",
      "form-fields": "date_value,origin",
      "field-date_value": values.date_value ?? "",
      "field-origin": values.origin ?? "",
      comments: "FW-10 data form evidence",
    });
    return {initial: edit, response};
  }

  async remove(slug, expectedSource) {
    const current = await this.source(slug);
    if (!current) return {slug, status: "already_absent"};
    if (expectedSource !== undefined && current.source !== expectedSource) throw new Error(`cleanup identity mismatch for ${slug}`);
    const deleted = await this.amc({action: "WikiPageAction", event: "deletePage", page_id: String(current.id), moduleName: "Empty"});
    if (deleted.status !== "ok") throw new Error(`delete failed for ${slug}`);
    if ((await this.source(slug)) !== null) throw new Error(`deleted page remains: ${slug}`);
    return {slug, status: "deleted"};
  }
}

function templateSource(treeCategory) {
  return `[[form]]\nfields:\n  date_value:\n    label: Date value\n    type: date\n    options:\n      dateFormat: 'mm/dd/yy'\n  origin:\n    label: Origin\n    type: pagepath\n    category: ${treeCategory}\n    max-level: 3\n[[/form]]\n====\nDATE-DATA-BEGIN\n%%form_data{date_value}%%\nDATE-DATA-END\nDATE-FORMATTED-BEGIN\n[[date %%form_data{date_value}%% format="%Y-%m-%d %H:%M:%S %z"]]\nDATE-FORMATTED-END\nPAGEPATH-DATA-BEGIN\n%%form_data{origin}%%\nPAGEPATH-DATA-END`;
}

function storedValue(source, field) {
  const match = source.match(new RegExp(`^${field}:\\s*(.+)$`, "mu"));
  if (!match) return null;
  const scalar = match[1].trim();
  if (scalar === "null") return null;
  return scalar.replace(/^'(.*)'$/u, "$1").replace(/''/gu, "'");
}

async function main(argv) {
  const args = parseArgs(argv);
  const fixtureBytes = await readFile(args.cases, "utf8");
  const fixture = JSON.parse(fixtureBytes);
  if (fixture.schema !== "wikidot.live.data-form.date-pagepath.cases.v1" || fixture.site !== "sandbox-for-codex" || !/^dfdp-20260810-[a-z][0-9]$/u.test(fixture.run_id)) throw new Error("fixture identity is outside the FW-10 contract");
  const username = process.env.WIKIDOT_USERNAME;
  const password = process.env.WIKIDOT_PASSWORD;
  delete process.env.WIKIDOT_USERNAME;
  delete process.env.WIKIDOT_PASSWORD;
  if (!username || !password) throw new Error("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required through the environment");

  const client = new WikidotSession();
  const created = new Map();
  const cleanup = [];
  const cases = [];
  let primaryError = null;
  await client.login(username, password);
  try {
    const {template, tree_pages: treePages} = fixture.fixture;
    const allTargets = fixture.cases.map(({case_id}) => `${fixture.fixture.form_category}:${case_id}`);
    for (const slug of [template, ...treePages, ...allTargets]) {
      if ((await client.source(slug)) !== null) throw new Error(`run-owned fixture already exists: ${slug}`);
    }

    const authoredTemplate = templateSource(fixture.fixture.tree_category);
    created.set(template, authoredTemplate);
    await client.saveGeneric(template, "FW-10 data form template", authoredTemplate);
    const treeSources = new Map([
      [treePages[0], "FW-10 pagepath root"],
      [treePages[1], "FW-10 pagepath alpha"],
      [treePages[2], "FW-10 pagepath beta"],
    ]);
    for (const [slug, source] of treeSources) {
      created.set(slug, source);
      await client.saveGeneric(slug, slug.split(":")[1], source);
    }
    await client.setParent(treePages[1], treePages[0]);
    await client.setParent(treePages[2], treePages[1]);

    for (const declared of fixture.cases) {
      const slug = `${fixture.fixture.form_category}:${declared.case_id}`;
      const values = declared.surface_id === "data-forms-date-field"
        ? {date_value: declared.submitted, origin: ""}
        : {date_value: "", origin: declared.submitted};
      const attempt = await client.saveForm(slug, declared.case_id, values);
      const saved = await client.source(slug);
      const validation = validationMessages(attempt.response.body ?? "");
      const accepted = saved !== null;
      if (accepted) created.set(slug, saved.source);
      if (declared.control === "positive" && !accepted) throw new Error(`${declared.case_id} did not produce the required accepted control`);
      const rendered = accepted ? await client.get(slug, false) : {status: 404, html: ""};
      const edit = await client.editForm(slug, true);
      const reload = await client.editForm(slug, true);
      const field = declared.surface_id === "data-forms-date-field" ? "date_value" : "origin";
      const editValues = fieldValues(edit.body, `field-${field}`);
      const reloadValues = fieldValues(reload.body, `field-${field}`);
      const createValues = fieldValues(attempt.initial.body, `field-${field}`);
      const stored = saved ? storedValue(saved.source, field) : null;
      cases.push({
        case_id: declared.case_id,
        surface_id: declared.surface_id,
        control: declared.control,
        submitted: declared.submitted,
        lifecycle: {
          create_or_validation_captured: true,
          saved_source_captured: true,
          stored_representation_captured: true,
          display_captured: true,
          edit_captured: true,
          reload_captured: true,
        },
        result: {
          validation_status: accepted ? "accepted" : "rejected",
          validation_messages: validation,
          save_response_status: attempt.response.status ?? null,
          create_field_values: createValues,
          create_form_sha256: sha256(attempt.initial.body),
          saved_source: saved?.source ?? "",
          stored_representation: stored,
          submitted_fullname: declared.surface_id.startsWith("data-forms-pagepath") ? declared.submitted : null,
          display_http_status: rendered.status,
          display: accepted ? visibleText(rendered.html) : "page absent after rejected save",
          edit_value: editValues.at(-1) ?? null,
          edit_field_values: editValues,
          reload_value: reloadValues.at(-1) ?? null,
          reload_field_values: reloadValues,
          edit_form_sha256: sha256(edit.body),
          reload_form_sha256: sha256(reload.body),
        },
      });
    }
  } catch (error) {
    primaryError = error;
  } finally {
    for (const [slug, source] of [...created.entries()].reverse()) {
      try {
        cleanup.push(await client.remove(slug, source));
      } catch (error) {
        cleanup.push({slug, status: "cleanup_failed", error: error.message});
      }
    }
  }

  const requestedPages = [fixture.fixture.template, ...fixture.fixture.tree_pages, ...fixture.cases.map(({case_id}) => `${fixture.fixture.form_category}:${case_id}`)];
  const remaining = [];
  for (const slug of requestedPages) if ((await client.source(slug)) !== null) remaining.push(slug);
  if (primaryError) throw primaryError;
  if (remaining.length > 0 || cleanup.some(({status}) => status === "cleanup_failed")) throw new Error(`cleanup incomplete: ${remaining.join(", ")}`);
  if (cases.length !== fixture.cases.length) throw new Error(`evidence count unmet: captured ${cases.length} of ${fixture.cases.length} cases`);

  const artifact = {
    schema: "wikidot.live.data-form.date-pagepath.v1",
    observed_at: new Date().toISOString(),
    site: fixture.site,
    run_id: fixture.run_id,
    surface_ids: fixture.surface_ids,
    actor: "authenticated sandbox account A through direct public Wikidot page and Ajax interfaces",
    credential_material: "none; credentials and session material remained environment-only",
    environment: {
      locale: "en",
      capture_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      utc_offset_minutes: -new Date().getTimezoneOffset(),
      storage_interpretation: "Direct public Ajax saves stored the submitted date scalar verbatim and pagepath values as submitted page fullnames",
      generalization_limit: "Date parsing, display, and day boundaries are not generalized to other Wikidot locales or timezones.",
    },
    fixture: {
      identities: {requested: fixture.fixture, cases_sha256: sha256(fixtureBytes)},
      cleanup: {
        template_restored_or_deleted: !remaining.includes(fixture.fixture.template),
        all_run_owned_pages_absent: remaining.length === 0,
        remaining_pages: remaining,
        operations: cleanup,
      },
    },
    routes: [
      "HTTPS Login2Action session creation with credentials supplied only through environment variables",
      "HTTP sandbox PageEditModule and WikiPageAction savePage for create, validation, and edit/reload forms",
      "Authenticated ViewSourceModule for exact saved source and stored scalar representation",
      "Anonymous public page GET for saved display",
      "Identity-checked WikiPageAction deletePage followed by authenticated absence verification",
    ],
    cases,
  };
  await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${args.output}\n`);
}

await main(process.argv);
