import crypto from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {parseFragment} from "parse5";

import {defaultBrowserRoot, loadPlaywright} from "../src/browser-session.mjs";
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
  const args = {
    cases: defaultCases,
    output: defaultOutput,
    capturePagepathControl: false,
    capturePagepathCreateNew: false,
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--cases" || flag === "--output") args[flag.slice(2)] = path.resolve(argv[++index]);
    else if (flag === "--capture-pagepath-control") args.capturePagepathControl = true;
    else if (flag === "--capture-pagepath-create-new") args.capturePagepathCreateNew = true;
    else throw new Error(`unknown argument: ${flag}`);
  }
  return args;
}

function decodeHtml(value) {
  const text = [];
  const hidden = new Set(["script", "style", "template"]);
  const visit = (node) => {
    if (node.nodeName === "#text") text.push(node.value);
    else if (node.tagName === "br") text.push("\n");
    else if (!hidden.has(node.tagName)) for (const child of node.childNodes ?? []) visit(child);
  };
  for (const node of parseFragment(value).childNodes) visit(node);
  return text.join("");
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

function pageContentLinks(html) {
  const pageContent = html.match(/<div id="page-content"[^>]*>([\s\S]*?)<div class="page-tags"/u)?.[1]
    ?? html.match(/<div id="page-content"[^>]*>([\s\S]*?)<div class="page-info-break"/u)?.[1]
    ?? "";
  const root = parseFragment(pageContent);
  const links = [];
  const visit = (node) => {
    if (node.tagName === "a") {
      const attributes = nodeAttributes(node);
      links.push({
        href: attributes.href ?? "",
        class: attributes.class ?? "",
        text: normalizedNodeText(node).replace(/\s+/gu, " ").trim(),
      });
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);
  return links;
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

function decodeViewSource(fragment) {
  return decodeHtml(fragment.replace(/<br\s*\/?>/giu, ""))
    .replace(/^\n/u, "")
    .replace(/\n$/u, "")
    .split("\n")
    .map((line) => line.replace(/^\u00a0+/u, (indent) => " ".repeat(indent.length)).replace(/^\t/u, ""))
    .join("\n");
}

function nodeAttributes(node) {
  return Object.fromEntries((node.attrs ?? []).map(({name, value}) => [name, value]));
}

function normalizedNodeText(node) {
  if (node.nodeName === "#text") return node.value;
  return (node.childNodes ?? []).map(normalizedNodeText).join("");
}

function pagepathControlProjection(body, fieldName) {
  const root = parseFragment(body);
  let namedControl = null;
  const findNamedControl = (node) => {
    if (namedControl) return;
    if (nodeAttributes(node).name === fieldName) {
      namedControl = node;
      return;
    }
    for (const child of node.childNodes ?? []) findNamedControl(child);
  };
  findNamedControl(root);
  if (!namedControl) throw new Error(`pagepath control ${fieldName} is absent`);

  let controlRoot = namedControl;
  for (let node = namedControl; node; node = node.parentNode) {
    controlRoot = node;
    const classes = nodeAttributes(node).class?.split(/\s+/u) ?? [];
    if (classes.includes("form-group")) break;
  }
  const controls = [];
  const collectControls = (node) => {
    if (node.tagName === "input") {
      const attributes = nodeAttributes(node);
      controls.push({
        tag: "input",
        class: attributes.class ?? "",
        name: attributes.name ?? null,
        type: attributes.type ?? null,
        value: attributes.value ?? "",
      });
    } else if (node.tagName === "select") {
      const attributes = nodeAttributes(node);
      controls.push({
        tag: "select",
        class: attributes.class ?? "",
        options: (node.childNodes ?? [])
          .filter((child) => child.tagName === "option")
          .map((option) => ({
            value: nodeAttributes(option).value ?? "",
            text: normalizedNodeText(option).replace(/\s+/gu, " ").trim(),
          })),
      });
    }
    for (const child of node.childNodes ?? []) collectControls(child);
  };
  collectControls(controlRoot);
  const label = (controlRoot.childNodes ?? [])
    .find((child) => child.tagName === "label");
  const valueContainer = controls.find((control) => control.tag === "input" && control.name === fieldName);
  return {
    wrapper_class: nodeAttributes(controlRoot).class ?? "",
    chooser_class: (() => {
      let found = null;
      const visit = (node) => {
        if (found) return;
        const classes = nodeAttributes(node).class?.split(/\s+/u) ?? [];
        if (classes.includes("dataform-pagepath-chooser")) {
          found = nodeAttributes(node).class;
          return;
        }
        for (const child of node.childNodes ?? []) visit(child);
      };
      visit(controlRoot);
      return found;
    })(),
    label_class: label ? nodeAttributes(label).class ?? "" : "",
    label_text: label ? normalizedNodeText(label).replace(/\s+/gu, " ").trim() : "",
    value: valueContainer?.value ?? null,
    controls,
    text: normalizedNodeText(controlRoot).replace(/\s+/gu, " ").trim(),
  };
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
    this.sessionId = session;
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
    return {id: page.id, source: decodeViewSource(fragment)};
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

function safeAjaxRequestFields(postData) {
  const fields = {};
  for (const [key, value] of new URLSearchParams(postData ?? "")) {
    if (["wikidot_token7", "lock_id", "lock_secret"].includes(key)) continue;
    fields[key] = value;
  }
  return fields;
}

async function browserPagepathProjection(group) {
  return await group.evaluate((root) => {
    const normalize = (value) => (value ?? "").replace(/\s+/gu, " ").trim();
    const chooser = root.querySelector(".dataform-pagepath-chooser");
    return {
      wrapper_class: root.className ?? "",
      chooser_class: chooser?.className ?? null,
      text: normalize(root.textContent),
      controls: [...root.querySelectorAll("input,select,a")].map((element) => {
        if (element instanceof HTMLSelectElement) {
          return {
            tag: "select",
            class: element.className,
            value: element.value,
            options: [...element.options].map((option) => ({
              value: option.value,
              text: normalize(option.textContent),
              selected: option.selected,
            })),
          };
        }
        if (element instanceof HTMLInputElement) {
          return {
            tag: "input",
            class: element.className,
            name: element.getAttribute("name"),
            type: element.type,
            value: element.value,
          };
        }
        return {
          tag: "a",
          class: element.className,
          text: normalize(element.textContent),
          href: element.getAttribute("href"),
        };
      }),
    };
  });
}

async function capturePagepathCreateNew({
  client,
  slug,
  fieldName,
  treeCategory,
  parentFullname,
  title,
}) {
  const expectedFullname = `${treeCategory}:${title}`;
  const {chromium} = loadPlaywright(defaultBrowserRoot());
  const browser = await chromium.launch({headless: true});
  try {
    const context = await browser.newContext({userAgent: "WikidotPy"});
    await context.addCookies([
      {
        name: "WIKIDOT_SESSION_ID",
        value: client.sessionId,
        domain: ".wikidot.com",
        path: "/",
      },
      {
        name: "wikidot_token7",
        value: TOKEN,
        domain: ".wikidot.com",
        path: "/",
      },
    ]);
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/${slug}`, {waitUntil: "load"});
    const editButton = page.locator("#edit-button");
    if (await editButton.count() !== 1) throw new Error("authenticated Wikidot Edit control is absent");
    const editResponsePromise = page.waitForResponse((response) => {
      if (!response.url().includes("/ajax-module-connector.php")) return false;
      return safeAjaxRequestFields(response.request().postData()).moduleName === "edit/PageEditModule";
    }, {timeout: 15_000});
    await editButton.click();
    await editResponsePromise;

    const valueInput = page.locator(`input[name="${fieldName}"]`);
    await valueInput.waitFor({state: "attached", timeout: 15_000});
    const group = valueInput.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' form-group ')]");
    const childSelector = group.locator(
      `select.dataform-pagepath-select-children-of-${parentFullname.replace(":", "---")}`,
    );
    if (await childSelector.count() !== 1) throw new Error("pagepath child selector is absent");

    const before = await browserPagepathProjection(group);
    await childSelector.selectOption("+");
    const newItemInput = group.locator('input.text:not([type="hidden"])');
    await newItemInput.waitFor({state: "visible", timeout: 10_000});
    const afterCreateNewSelection = await browserPagepathProjection(group);
    const initialInputValue = await newItemInput.inputValue();
    await newItemInput.fill(title);

    const responsePromise = page.waitForResponse((response) => {
      if (!response.url().includes("/ajax-module-connector.php")) return false;
      const fields = safeAjaxRequestFields(response.request().postData());
      return fields.action === "DataFormAction" && fields.event === "newPage";
    }, {timeout: 10_000});
    await newItemInput.press("Enter");
    const response = await responsePromise;
    const responseBody = await response.json();
    await page.waitForFunction(
      ({selector, expected}) => document.querySelector(selector)?.value === expected,
      {selector: `input[name="${fieldName}"]`, expected: expectedFullname},
      {timeout: 10_000},
    );
    await group.locator(
      `select.dataform-pagepath-select-children-of-${expectedFullname.replace(":", "---")}`,
    ).waitFor({state: "attached", timeout: 10_000});

    const afterEnter = await browserPagepathProjection(group);
    const created = await client.source(expectedFullname);
    if (!created) throw new Error(`pagepath Create new did not create ${expectedFullname}`);
    const rootFullname = `${treeCategory}:_root`;
    const rootPage = await client.source(rootFullname);
    const saved = await client.source(slug);
    if (!saved) throw new Error("pagepath source page disappeared during Create new interaction");
    const hiddenValueAfterInteraction = await valueInput.inputValue();
    const cancelButton = page.locator("#edit-cancel-button");
    if (await cancelButton.count() !== 1) throw new Error("Wikidot page editor Cancel control is absent");
    await cancelButton.click();
    await valueInput.waitFor({state: "detached", timeout: 10_000});
    const createdAfterCancel = await client.source(expectedFullname);
    const savedAfterCancel = await client.source(slug);
    if (!savedAfterCancel) throw new Error("pagepath source page disappeared after cancelling the editor");
    return {
      expected_fullname: expectedFullname,
      initial_input_value: initialInputValue,
      before,
      after_create_new_selection: afterCreateNewSelection,
      request: safeAjaxRequestFields(response.request().postData()),
      response: {
        http_status: response.status(),
        body: responseBody,
      },
      after_enter: afterEnter,
      root_page_after_interaction: rootPage
        ? {fullname: rootFullname, source: rootPage.source}
        : null,
      created_page_source: created.source,
      saved_page_source_after_interaction: saved.source,
      hidden_value_after_interaction: hiddenValueAfterInteraction,
      cancel: {
        created_page_still_exists: createdAfterCancel !== null,
        created_page_source: createdAfterCancel?.source ?? null,
        saved_page_source_after_cancel: savedAfterCancel.source,
      },
    };
  } finally {
    await browser.close();
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
  if (fixture.schema !== "wikidot.live.data-form.date-pagepath.cases.v1" || fixture.site !== "sandbox-for-codex" || !/^dfdp-[0-9]{8}-[a-z][0-9]$/u.test(fixture.run_id)) throw new Error("fixture identity is outside the data-form date/pagepath contract");
  const username = process.env.WIKIDOT_USERNAME;
  const password = process.env.WIKIDOT_PASSWORD;
  delete process.env.WIKIDOT_USERNAME;
  delete process.env.WIKIDOT_PASSWORD;
  if (!username || !password) throw new Error("WIKIDOT_USERNAME and WIKIDOT_PASSWORD are required through the environment");

  const client = new WikidotSession();
  const created = new Map();
  const browserCreated = new Set();
  const cleanup = [];
  const cases = [];
  let primaryError = null;
  await client.login(username, password);
  try {
    const {template, tree_pages: treePages} = fixture.fixture;
    const createNewPlan = fixture.pagepath_create_new ?? null;
    const backlinksPlan = fixture.pagepath_backlinks ?? null;
    const treeTemplate = backlinksPlan
      ? `${fixture.fixture.tree_category}:_template`
      : null;
    const browserCreatedFullname = createNewPlan
      ? `${fixture.fixture.tree_category}:${createNewPlan.title}`
      : null;
    if (browserCreatedFullname) browserCreated.add(browserCreatedFullname);
    const allTargets = fixture.cases.map(({case_id}) => `${fixture.fixture.form_category}:${case_id}`);
    for (const slug of [template, ...treePages, ...allTargets, ...(browserCreatedFullname ? [browserCreatedFullname] : []), ...(treeTemplate ? [treeTemplate] : [])]) {
      if ((await client.source(slug)) !== null) throw new Error(`run-owned fixture already exists: ${slug}`);
    }

    const authoredTemplate = templateSource(fixture.fixture.tree_category);
    created.set(template, authoredTemplate);
    await client.saveGeneric(template, "FW-10 data form template", authoredTemplate);
    if (treeTemplate) {
      const source = "[[module Backlinks]]";
      created.set(treeTemplate, source);
      await client.saveGeneric(treeTemplate, "FW-10 pagepath tree template", source);
    }
    if (fixture.setup_tree_pages !== false) {
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
    } else if (createNewPlan) {
      browserCreated.add(`${fixture.fixture.tree_category}:_root`);
    }

    for (const declared of fixture.cases) {
      const slug = `${fixture.fixture.form_category}:${declared.case_id}`;
      const values = declared.surface_id === "data-forms-date-field"
        ? {date_value: declared.submitted, origin: ""}
        : {date_value: "", origin: declared.submitted};
      const backlinkBefore = backlinksPlan?.case_id === declared.case_id
        ? await client.get(declared.submitted, false)
        : null;
      const attempt = await client.saveForm(slug, declared.case_id, values);
      const saved = await client.source(slug);
      const validation = validationMessages(attempt.response.body ?? "");
      const accepted = saved !== null;
      if (accepted) created.set(slug, saved.source);
      if (declared.control === "positive" && !accepted) throw new Error(`${declared.case_id} did not produce the required accepted control`);
      const rendered = accepted ? await client.get(slug, false) : {status: 404, html: ""};
      const field = declared.surface_id === "data-forms-date-field" ? "date_value" : "origin";
      const pagepathCreateNew = args.capturePagepathCreateNew
        && createNewPlan?.case_id === declared.case_id
        ? await capturePagepathCreateNew({
            client,
            slug,
            fieldName: `field-${field}`,
            treeCategory: fixture.fixture.tree_category,
            parentFullname: createNewPlan.parent_fullname ?? declared.submitted,
            title: createNewPlan.title,
          })
        : undefined;
      const edit = await client.editForm(slug, true);
      const reload = await client.editForm(slug, true);
      const editValues = fieldValues(edit.body, `field-${field}`);
      const reloadValues = fieldValues(reload.body, `field-${field}`);
      const createValues = fieldValues(attempt.initial.body, `field-${field}`);
      const stored = saved ? storedValue(saved.source, field) : null;
      const backlinkAfter = backlinksPlan?.case_id === declared.case_id
        ? await client.get(declared.submitted, false)
        : null;
      const pagepathControl = args.capturePagepathControl && declared.surface_id.startsWith("data-forms-pagepath")
        ? {
            create: pagepathControlProjection(attempt.initial.body, `field-${field}`),
            edit: pagepathControlProjection(edit.body, `field-${field}`),
            reload: pagepathControlProjection(reload.body, `field-${field}`),
          }
        : undefined;
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
          ...(pagepathControl ? {pagepath_control: pagepathControl} : {}),
          ...(pagepathCreateNew ? {pagepath_create_new: pagepathCreateNew} : {}),
          ...(backlinkBefore && backlinkAfter
            ? {
                pagepath_backlinks: {
                  target_fullname: declared.submitted,
                  before: {
                    http_status: backlinkBefore.status,
                    links: pageContentLinks(backlinkBefore.html),
                    visible_text: visibleText(backlinkBefore.html),
                  },
                  after: {
                    http_status: backlinkAfter.status,
                    links: pageContentLinks(backlinkAfter.html),
                    visible_text: visibleText(backlinkAfter.html),
                  },
                },
              }
            : {}),
        },
      });
    }
  } catch (error) {
    primaryError = error;
  } finally {
    for (const slug of [...browserCreated].reverse()) {
      try {
        cleanup.push(await client.remove(slug));
      } catch (error) {
        cleanup.push({slug, status: "cleanup_failed", error: error.message});
      }
    }
    for (const [slug, source] of [...created.entries()].reverse()) {
      try {
        cleanup.push(await client.remove(slug, source));
      } catch (error) {
        cleanup.push({slug, status: "cleanup_failed", error: error.message});
      }
    }
  }

  const requestedPages = [
    fixture.fixture.template,
    ...fixture.fixture.tree_pages,
    ...(fixture.pagepath_backlinks ? [`${fixture.fixture.tree_category}:_template`] : []),
    ...fixture.cases.map(({case_id}) => `${fixture.fixture.form_category}:${case_id}`),
    ...(fixture.pagepath_create_new ? [`${fixture.fixture.tree_category}:${fixture.pagepath_create_new.title}`] : []),
  ];
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
