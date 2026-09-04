#!/usr/bin/env node

import crypto from "node:crypto";
import {mkdir, writeFile} from "node:fs/promises";
import path from "node:path";

import {defaultBrowserRoot, loadPlaywright} from "../src/browser-session.mjs";

const ORIGIN = "http://sandbox-for-codex.wikidot.com";
const LOGIN_URL = "https://www.wikidot.com/default--flow/login__LoginPopupScreen";
const TOKEN = "123456";
const RUN_TOKEN = crypto.randomBytes(4).toString("hex");
const RUN_ID = `issue1391-data-form-ui-era-20260905-${RUN_TOKEN}`;
const CATEGORY = `runowned1391ui-${RUN_TOKEN}`;
const TEMPLATE = `${CATEGORY}:_template`;
const PAGE_BEFORE = `${CATEGORY}:before`;
const PAGE_FORMLESS = `${CATEGORY}:formless`;
const PAGE_AFTER = `${CATEGORY}:after`;
const TEMPLATE_A = "[[form]]\nfields:\n  name:\n    label: Field A\n    type: text\n[[/form]]";
const TEMPLATE_B = "[[form]]\nfields:\n  name:\n    label: Field B\n    type: text\n[[/form]]";
const TEMPLATE_C = "[[form]]\nfields:\n  name:\n    label: Field C\n    type: text\n[[/form]]";
const TEMPLATE_WITHOUT_FORM = "Form removed for Issue 1391 lifecycle evidence.";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

function parseArgs(argv) {
  const args = {output: null};
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--output" || !argv[index + 1]) throw new Error("usage: capture-issue1391-data-form-ui-era.mjs --output FILE");
    args.output = path.resolve(argv[++index]);
  }
  if (!args.output) throw new Error("--output is required");
  return args;
}

function pageId(html) {
  const match = html.match(/WIKIREQUEST\.info\.pageId\s*=\s*([0-9]+)\s*;/u);
  return match ? Number(match[1]) : null;
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gu, " ")
    .replace(/&#39;|&apos;/gu, "'")
    .replace(/&quot;/gu, '"')
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&amp;/gu, "&")
    .replace(/&#(\d+);/gu, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/giu, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function visibleText(html) {
  return decodeHtml(
    html
      .replace(/<script\b[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[\s\S]*?<\/style>/giu, " ")
      .replace(/<br\s*\/?>/giu, "\n")
      .replace(/<[^>]+>/gu, " "),
  ).replace(/[ \t]+/gu, " ").replace(/\s*\n\s*/gu, "\n").trim();
}

function safeRequestFields(postData) {
  const safe = {};
  for (const [key, value] of new URLSearchParams(postData ?? "")) {
    if (["wikidot_token7", "lock_id", "lock_secret"].includes(key)) continue;
    if (/password|email|token|secret|cookie/iu.test(key)) continue;
    safe[key] = value;
  }
  return safe;
}

function editShape(body) {
  return {
    data_form: /<form\b[^>]*id=["']edit-page-form["'][^>]*class=["'][^"']*\bdata-form\b/iu.test(body)
      || /<form\b[^>]*class=["'][^"']*\bdata-form\b[^"']*["'][^>]*id=["']edit-page-form["']/iu.test(body),
    ordinary_textarea: /<textarea\b[^>]*(?:name=["']source["']|id=["']edit-page-textarea["'])/iu.test(body),
    form_fields: body.match(/name=["']form-fields["'][^>]*value=["']([^"']*)["']/iu)?.[1] ?? null,
    body_sha256: sha256(body),
  };
}

class WikidotSession {
  async login(username, password) {
    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "WikidotEvidenceCapture"},
      body: new URLSearchParams({login: username, password, action: "Login2Action", event: "login"}),
      redirect: "manual",
    });
    const sessionId = response.headers.getSetCookie()
      .map((cookie) => cookie.match(/^WIKIDOT_SESSION_ID=([^;]+)/u)?.[1])
      .find(Boolean);
    if (response.status !== 200 || !sessionId) throw new Error("Wikidot authentication failed");
    this.sessionId = sessionId;
    this.cookie = `wikidot_token7=${TOKEN};WIKIDOT_SESSION_ID=${sessionId};`;
  }

  async amc(fields) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await fetch(`${ORIGIN}/ajax-module-connector.php`, {
        method: "POST",
        headers: {
          cookie: this.cookie,
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "user-agent": "WikidotEvidenceCapture",
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
      headers: authenticated ? {cookie: this.cookie, "user-agent": "WikidotEvidenceCapture"} : {"user-agent": "WikidotEvidenceCapture"},
      redirect: "manual",
    });
    const html = await response.text();
    return {status: response.status, html, id: pageId(html)};
  }

  async source(slug) {
    const page = await this.get(slug);
    if (page.status === 404 || page.id === null) return null;
    const response = await this.amc({moduleName: "viewsource/ViewSourceModule", page_id: String(page.id)});
    const fragment = response.body?.match(/<div class=["']page-source["'][^>]*>([\s\S]*?)<\/div>/u)?.[1];
    if (typeof fragment !== "string") throw new Error(`source unavailable for ${slug}`);
    const source = decodeHtml(fragment.replace(/<br\s*\/?>/giu, ""))
      .replace(/^\n/u, "")
      .replace(/\n$/u, "")
      .split("\n")
      .map((line) => line.replace(/^\t/u, ""))
      .join("\n");
    return {id: page.id, source};
  }

  async editForm(slug) {
    const response = await this.amc({mode: "page", wiki_page: slug, moduleName: "edit/PageEditModule"});
    if (response.status !== "ok" || !response.lock_id || !response.lock_secret || typeof response.body !== "string") throw new Error(`edit form unavailable for ${slug}`);
    return response;
  }

  async saveGeneric(slug, title, source) {
    if (await this.source(slug)) throw new Error(`preexisting page refused: ${slug}`);
    const edit = await this.editForm(slug);
    const response = await this.amc({
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
      comments: `${RUN_ID} generic create`,
    });
    if (response.status !== "ok") throw new Error(`generic create failed for ${slug}`);
    const saved = await this.source(slug);
    if (!saved) throw new Error(`created page unavailable: ${slug}`);
    return saved;
  }

  async editGeneric(slug, title, source) {
    const current = await this.source(slug);
    if (!current) throw new Error(`missing edit target: ${slug}`);
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
      page_id: String(current.id),
      title,
      source,
      comments: `${RUN_ID} generic edit`,
    });
    if (response.status !== "ok") throw new Error(`generic edit failed for ${slug}`);
    const saved = await this.source(slug);
    if (!saved || saved.id !== current.id) throw new Error(`edited page identity changed: ${slug}`);
    return saved;
  }

  async removeOwned(slug, expectedPageId) {
    const current = await this.source(slug);
    if (!current) return {slug, status: "already_absent"};
    if (current.id !== expectedPageId) throw new Error(`cleanup page identity mismatch for ${slug}`);
    const response = await this.amc({action: "WikiPageAction", event: "deletePage", moduleName: "Empty", page_id: String(current.id)});
    if (response.status !== "ok") throw new Error(`delete failed for ${slug}`);
    if (await this.source(slug)) throw new Error(`deleted page remains: ${slug}`);
    return {slug, status: "deleted"};
  }

  async shape(slug) {
    const response = await this.editForm(slug);
    const shape = editShape(response.body);
    await this.amc({
      action: "WikiPageAction",
      event: "removePageEditLock",
      moduleName: "Empty",
      wiki_page: slug,
      lock_id: String(response.lock_id),
      lock_secret: String(response.lock_secret),
      ...(response.page_id ? {page_id: String(response.page_id)} : {}),
      leave_draft: "false",
    });
    return shape;
  }
}

async function waitForEditorKind(session, slug, expectedDataForm, {attempts = 60, intervalMs = 500} = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await session.shape(slug);
    if (last.data_form === expectedDataForm) return {attempt: attempt + 1, shape: last};
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`editor kind did not converge for ${slug}: expected data-form=${expectedDataForm}, last=${JSON.stringify(last)}`);
}

async function waitForView(session, slug, predicate, {attempts = 60, intervalMs = 500} = {}) {
  let last = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await anonymousObservation(session, slug);
    if (predicate(last)) return {attempt: attempt + 1, observation: last};
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`saved view did not converge for ${slug}: ${JSON.stringify(last)}`);
}

async function anonymousObservation(session, slug) {
  const response = await session.get(slug, false);
  if (response.status !== 200) throw new Error(`anonymous GET ${slug} returned ${response.status}`);
  const text = visibleText(response.html);
  return {
    status: response.status,
    page_id: response.id,
    contains_field_a: text.includes("Field A"),
    contains_field_b: text.includes("Field B"),
    contains_field_c: text.includes("Field C"),
    contains_formless_value: text.includes("Formless value"),
    text_sha256: sha256(text),
  };
}

async function createThroughBrowser({browser, session, slug, value, expectDataForm}) {
  const context = await browser.newContext({userAgent: "WikidotEvidenceCapture"});
  try {
    await context.addCookies([
      {name: "WIKIDOT_SESSION_ID", value: session.sessionId, domain: ".wikidot.com", path: "/"},
      {name: "wikidot_token7", value: TOKEN, domain: ".wikidot.com", path: "/"},
    ]);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/${slug}?capture=${crypto.randomUUID()}`, {waitUntil: "load"});
    const create = page.locator("#create-it-now-link a");
    if (await create.count() !== 1) throw new Error(`missing create control for ${slug}`);
    const editResponse = page.waitForResponse((response) => {
      if (!response.url().includes("/ajax-module-connector.php")) return false;
      return safeRequestFields(response.request().postData()).moduleName === "edit/PageEditModule";
    }, {timeout: 15_000});
    await create.click();
    await editResponse;
    await page.locator("form#edit-page-form").waitFor({state: "attached", timeout: 15_000});
    const dataForm = page.locator("form#edit-page-form.data-form");
    const ordinary = page.locator("form#edit-page-form textarea#edit-page-textarea, form#edit-page-form textarea[name=source]");
    const dataFormCount = await dataForm.count();
    if ((dataFormCount === 1) !== expectDataForm) throw new Error(`unexpected editor kind for ${slug}: data-form=${dataFormCount}`);
    if (expectDataForm) {
      const field = page.locator('form#edit-page-form.data-form [name="field-name"]');
      await field.waitFor({state: "visible", timeout: 10_000});
      await field.fill(value);
    } else {
      await ordinary.first().waitFor({state: "visible", timeout: 10_000});
    }
    const saveResponsePromise = page.waitForResponse((response) => {
      if (!response.url().includes("/ajax-module-connector.php")) return false;
      const fields = safeRequestFields(response.request().postData());
      return fields.action === "WikiPageAction" && fields.event === "savePage";
    }, {timeout: 15_000});
    await page.locator("#edit-save-button").click();
    const saveResponse = await saveResponsePromise;
    const payload = await saveResponse.json();
    if (payload.status !== "ok") throw new Error(`browser save failed for ${slug}`);
    const saved = await session.source(slug);
    if (!saved) throw new Error(`browser-created page unavailable: ${slug}`);
    return {
      page_id: saved.id,
      source: saved.source,
      source_sha256: sha256(saved.source),
      editor: {data_form: expectDataForm, ordinary_textarea: !expectDataForm},
      request: safeRequestFields(saveResponse.request().postData()),
      response: {http_status: saveResponse.status(), status: payload.status},
    };
  } finally {
    await context.close();
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const username = process.env.WIKIDOT_USERNAME;
  const password = process.env.WIKIDOT_PASSWORD;
  if (!username || !password) throw new Error("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required through the environment");
  const session = new WikidotSession();
  await session.login(username, password);
  delete process.env.WIKIDOT_USERNAME;
  delete process.env.WIKIDOT_PASSWORD;

  const owned = new Map();
  const cleanup = [];
  const lifecycle = {};
  let primaryError = null;
  const {chromium} = loadPlaywright(defaultBrowserRoot());
  const browser = await chromium.launch({headless: true, executablePath: "/usr/bin/google-chrome"});
  try {
    for (const slug of [TEMPLATE, PAGE_BEFORE, PAGE_FORMLESS, PAGE_AFTER]) {
      if (await session.source(slug)) throw new Error(`preflight target already exists: ${slug}`);
    }

    const templateA = await session.saveGeneric(TEMPLATE, "Issue 1391 UI template", TEMPLATE_A);
    owned.set(TEMPLATE, templateA.id);
    lifecycle.template_a = {
      page_id: templateA.id,
      source_sha256: sha256(templateA.source),
      create_editor_convergence: await waitForEditorKind(session, PAGE_BEFORE, true),
    };

    const before = await createThroughBrowser({browser, session, slug: PAGE_BEFORE, value: "Before value", expectDataForm: true});
    owned.set(PAGE_BEFORE, before.page_id);
    lifecycle.before_created_with_form_a = {
      browser_create: before,
      view: await anonymousObservation(session, PAGE_BEFORE),
      edit: await session.shape(PAGE_BEFORE),
    };

    const templateB = await session.editGeneric(TEMPLATE, "Issue 1391 UI template", TEMPLATE_B);
    lifecycle.after_in_place_template_edit = {
      template_page_id: templateB.id,
      view_convergence: await waitForView(session, PAGE_BEFORE, (view) => view.contains_field_b),
      edit: await session.shape(PAGE_BEFORE),
    };

    const templateWithoutForm = await session.editGeneric(TEMPLATE, "Issue 1391 UI template", TEMPLATE_WITHOUT_FORM);
    const deleteConvergence = await waitForEditorKind(session, PAGE_FORMLESS, false);
    lifecycle.after_form_removal = {
      template_page_id: templateWithoutForm.id,
      same_template_identity: templateWithoutForm.id === templateA.id,
      new_page_editor_convergence: deleteConvergence,
      before_view_convergence: await waitForView(session, PAGE_BEFORE, (view) => !view.contains_field_a && !view.contains_field_b && !view.contains_field_c),
      before_edit: await session.shape(PAGE_BEFORE),
    };

    const formless = await createThroughBrowser({browser, session, slug: PAGE_FORMLESS, value: "", expectDataForm: false});
    owned.set(PAGE_FORMLESS, formless.page_id);
    lifecycle.formless_created = {
      browser_create: formless,
      view: await anonymousObservation(session, PAGE_FORMLESS),
      edit: await session.shape(PAGE_FORMLESS),
    };

    const templateC = await session.editGeneric(TEMPLATE, "Issue 1391 UI template", TEMPLATE_C);
    lifecycle.template_c = {
      page_id: templateC.id,
      source_sha256: sha256(templateC.source),
      same_identity_as_a: templateC.id === templateA.id,
      create_editor_convergence: await waitForEditorKind(session, PAGE_AFTER, true),
    };

    const after = await createThroughBrowser({browser, session, slug: PAGE_AFTER, value: "After value", expectDataForm: true});
    owned.set(PAGE_AFTER, after.page_id);
    lifecycle.after_created_with_form_c = {
      browser_create: after,
      view: await anonymousObservation(session, PAGE_AFTER),
      edit: await session.shape(PAGE_AFTER),
    };
    lifecycle.after_form_recreation_existing_pages = {
      before_view_convergence: await waitForView(session, PAGE_BEFORE, (view) => view.contains_field_c),
      before_edit: await session.shape(PAGE_BEFORE),
      formless_view_convergence: await waitForView(session, PAGE_FORMLESS, (view) => view.contains_field_c),
      formless_edit: await session.shape(PAGE_FORMLESS),
    };
  } catch (error) {
    primaryError = error;
  } finally {
    await browser.close().catch(() => {});
    for (const [slug, id] of [...owned.entries()].reverse()) {
      try {
        cleanup.push(await session.removeOwned(slug, id));
      } catch (error) {
        cleanup.push({slug, status: "cleanup_failed", error: error.message});
      }
    }
  }

  const remaining = [];
  for (const slug of [TEMPLATE, PAGE_BEFORE, PAGE_FORMLESS, PAGE_AFTER]) {
    if (await session.source(slug)) remaining.push(slug);
  }
  const cleanupOk = cleanup.every(({status}) => ["deleted", "already_absent"].includes(status)) && remaining.length === 0;
  if (!cleanupOk && !primaryError) primaryError = new Error("run-owned cleanup incomplete");

  const artifact = {
    schema: "wikijump.issue1391.data_form_ui_era_live.v1",
    captured_at: new Date().toISOString(),
    status: primaryError ? "blocked" : "observed",
    issue: 1391,
    site: "sandbox-for-codex",
    run_id: RUN_ID,
    interfaces: ["authenticated browser missing-page create", "edit/PageEditModule", "WikiPageAction/savePage", "WikiPageAction/deletePage", "anonymous saved-page GET"],
    lifecycle,
    cleanup: {operations: cleanup, remaining_run_owned_objects: remaining, verified: cleanupOk},
    blocked: primaryError ? {reason: primaryError.message} : null,
    redactions: ["credentials", "session cookie", "wikidot_token7", "edit lock id", "edit lock secret"],
  };
  const serialized = `${JSON.stringify(artifact, null, 2)}\n`;
  for (const secret of [username, password, session.sessionId]) {
    if (secret && serialized.includes(secret)) throw new Error("artifact contains credential material");
  }
  await mkdir(path.dirname(args.output), {recursive: true, mode: 0o700});
  await writeFile(args.output, serialized, {flag: "wx", mode: 0o600});
  process.stdout.write(`${args.output}\nstatus=${artifact.status}\n`);
}

main(process.argv).catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
