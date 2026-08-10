import crypto from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const ORIGIN = "http://sandbox-for-codex.wikidot.com";
const LOGIN_URL = "https://www.wikidot.com/default--flow/login__LoginPopupScreen";
const EDIT_MODULE_JS = "http://d3g0gp89917ko0.cloudfront.net/v--7690939296dc/common--modules/js/edit/PageEditModule.js";
const TOKEN = "123456";
const here = path.dirname(fileURLToPath(import.meta.url));
const defaultCases = path.resolve(here, "../fixtures/open43-q1035-listdrafts-nonempty/cases.json");
const defaultOutput = path.resolve(here, "../artifacts/open43-q1035-listdrafts-nonempty-live-20260810.json");

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

function selectedListDraftsDom(body, interfaceName = "PagePreviewModule") {
  const wrapperPresent = /<div\s+class=["']list-drafts-box["'][^>]*>/iu.test(body);
  if (!wrapperPresent) throw new Error(`${interfaceName} did not emit div.list-drafts-box`);
  const rows = [];
  const pattern = /<div\s+class=["']list-drafts-item["'][^>]*>\s*<p[^>]*>\s*<a\s+href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>\s*<\/p>\s*<\/div>/giu;
  for (const match of body.matchAll(pattern)) {
    rows.push({
      hierarchy: ["div.list-drafts-item", "p", "a"],
      href: decodeHtml(match[1]),
      text: decodeHtml(match[2].replace(/<[^>]*>/gu, "")).trim(),
    });
  }
  return {
    interface: interfaceName,
    wrapper: {tag: "div", class: "list-drafts-box"},
    rows,
    row_count: rows.length,
    closing_marker_literal: /<p>\s*\[\[\/module\]\]\s*<\/p>/iu.test(body),
    selected_body_sha256: sha256(body),
  };
}

class WikidotSession {
  constructor(label) {
    this.label = label;
    this.cookie = `wikidot_token7=${TOKEN};`;
  }

  async login(username, password) {
    const response = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {"content-type": "application/x-www-form-urlencoded", "user-agent": "WikidotEvidenceCapture"},
      body: new URLSearchParams({login: username, password, action: "Login2Action", event: "login"}),
      redirect: "manual",
    });
    const cookies = response.headers.getSetCookie();
    const session = cookies.map((cookie) => cookie.match(/^WIKIDOT_SESSION_ID=([^;]+)/u)?.[1]).find(Boolean);
    if (response.status !== 200 || !session) throw new Error(`authentication failed for ${this.label}`);
    this.cookie = `wikidot_token7=${TOKEN};WIKIDOT_SESSION_ID=${session};`;
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
      if (response.status !== 200) throw new Error(`Wikidot Ajax returned HTTP ${response.status} for ${fields.moduleName ?? fields.event ?? "request"}`);
      const result = await response.json();
      if (!result || typeof result !== "object") throw new Error("Wikidot Ajax returned malformed JSON");
      if (result.status !== "try_again") return result;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
    throw new Error(`Wikidot Ajax exhausted retries for ${fields.moduleName ?? fields.event ?? "request"}`);
  }

  async get(slug) {
    const response = await fetch(`${ORIGIN}/${slug}?capture=${crypto.randomUUID()}`, {
      headers: {cookie: this.cookie, "user-agent": "WikidotEvidenceCapture"},
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
    const text = decodeHtml(fragment.replace(/<br\s*\/?>/giu, "")).replace(/^\n/u, "").replace(/\n$/u, "");
    return {id: page.id, source: text.split("\n").map((line) => line.replace(/^\t/u, "")).join("\n")};
  }

  async edit(slug, forceLock = false) {
    const response = await this.amc({moduleName: "edit/PageEditModule", mode: "page", wiki_page: slug, ...(forceLock ? {force_lock: "yes"} : {})});
    if (response.status !== "ok" || !response.lock_id || !response.lock_secret || typeof response.body !== "string") {
      throw new Error(`edit interface unavailable for ${slug}: ${JSON.stringify({status: response.status ?? null, locked: response.locked ?? null, has_lock: Boolean(response.lock_id && response.lock_secret), has_body: typeof response.body === "string"})}`);
    }
    return response;
  }

  async savePage(slug, title, source) {
    if (await this.source(slug)) throw new Error(`preexisting page refused: ${slug}`);
    const edit = await this.edit(slug);
    const result = await this.amc({
      moduleName: "Empty",
      action: "WikiPageAction",
      event: "savePage",
      mode: "page",
      wiki_page: slug,
      lock_id: String(edit.lock_id),
      lock_secret: String(edit.lock_secret),
      revision_id: "",
      title,
      source,
      comments: "Q1035 FW21 run-owned evidence",
    });
    if (result.status !== "ok") throw new Error(`savePage failed for ${slug}: ${result.status ?? "missing-status"}`);
    const saved = await this.source(slug);
    if (!saved || saved.source !== source) throw new Error(`saved source mismatch for ${slug}`);
    return saved;
  }

  async saveDraft(slug, title, source, edit) {
    const result = await this.amc({
      moduleName: "Empty",
      action: "WikiPageAction",
      event: "synchronize",
      mode: "page",
      wiki_page: slug,
      lock_id: String(edit.lock_id),
      lock_secret: String(edit.lock_secret),
      revision_id: String(edit.page_revision_id ?? ""),
      ...(edit.page_id ? {page_id: String(edit.page_id)} : {}),
      source,
      title,
      comments: "Q1035 FW21 draft evidence",
      since_last_input: "0",
    });
    if (result.status !== "ok" || ![true, "true"].includes(result.savedDraft)) throw new Error(`synchronize did not save draft for ${slug}: ${result.status ?? "missing-status"}`);
    return {status: result.status, saved_draft: true, title_sha256: sha256(title), source_sha256: sha256(source)};
  }

  async checkDraft(slug, edit, title = "", source = "") {
    const result = await this.amc({
      moduleName: "Empty",
      action: "WikiPageAction",
      event: "checkDraftExists",
      wiki_page: slug,
      lock_id: String(edit.lock_id),
      ...(edit.page_id ? {page_id: String(edit.page_id)} : {}),
      title,
      source,
    });
    if (result.status !== "ok" || typeof result.draftExists !== "boolean") throw new Error(`checkDraftExists failed for ${slug}`);
    return result.draftExists;
  }

  async closeEdit(slug, edit, leaveDraft) {
    const result = await this.amc({
      moduleName: "Empty",
      action: "WikiPageAction",
      event: "removePageEditLock",
      wiki_page: slug,
      lock_id: String(edit.lock_id),
      lock_secret: String(edit.lock_secret),
      ...(edit.page_id ? {page_id: String(edit.page_id)} : {}),
      leave_draft: leaveDraft ? "true" : "false",
    });
    if (result.status !== "ok") throw new Error(`removePageEditLock failed for ${slug}: ${result.status ?? "missing-status"}`);
    return result.status;
  }

  async verifyDraftAbsent(slug) {
    const edit = await this.edit(slug, true);
    const exists = await this.checkDraft(slug, edit);
    await this.closeEdit(slug, edit, false);
    return !exists;
  }

  async preview(source) {
    const result = await this.amc({moduleName: "edit/PagePreviewModule", mode: "page", source, title: "Q1035 FW21 ListDrafts evidence"});
    if (result.status !== "ok" || typeof result.body !== "string") throw new Error(`PagePreviewModule failed for ${this.label}`);
    return {result, selected: selectedListDraftsDom(result.body)};
  }

  async removePage(slug, expectedSource) {
    const current = await this.source(slug);
    if (!current) return {slug, status: "already-absent"};
    if (current.source !== expectedSource) throw new Error(`cleanup identity mismatch for ${slug}`);
    const result = await this.amc({moduleName: "Empty", action: "WikiPageAction", event: "deletePage", page_id: String(current.id)});
    if (result.status !== "ok") throw new Error(`deletePage failed for ${slug}`);
    if (await this.source(slug)) throw new Error(`deleted page remains: ${slug}`);
    return {slug, status: "deleted"};
  }
}

function findRow(matrixCase, slug) {
  return matrixCase.rows.find(({href}) => href === `/${slug}`) ?? null;
}

function summarizeStage(stage, cases) {
  return {
    stage,
    cases: cases.map(({case_id, rows, row_count, wrapper}) => ({case_id, rows, row_count, wrapper})),
  };
}

async function previewMatrix(session, declaredCases) {
  const matrix = [];
  for (const declared of declaredCases) {
    const {selected} = await session.preview(declared.source);
    matrix.push({case_id: declared.case_id, source_sha256: sha256(declared.source), ...selected});
  }
  return matrix;
}

async function roleCategory(owner, accountId) {
  for (const [group, category] of [["admins", "administrator"], ["moderators", "moderator"], ["", "member"]]) {
    const response = await owner.amc({moduleName: "membership/MembersListModule", page: "1", group});
    if (response.status !== "ok" || typeof response.body !== "string") throw new Error(`MembersListModule failed for group ${group || "members"}`);
    if (new RegExp(`(^|[^0-9])${accountId}([^0-9]|$)`, "u").test(response.body)) return category;
  }
  return "registered-account-not-present-in-first-public-members-page";
}

async function main(argv) {
  const args = parseArgs(argv);
  const fixtureBytes = await readFile(args.cases, "utf8");
  const fixture = JSON.parse(fixtureBytes);
  if (fixture.schema !== "wikidot.live.open43.q1035-listdrafts-nonempty.cases.v1" || fixture.site !== "sandbox-for-codex" || fixture.run_id !== "q1035-listdrafts-fw21-20260810") throw new Error("fixture identity is outside the Q1035 FW21 contract");

  const credentials = {};
  for (const label of ["A", "B", "C"]) {
    credentials[label] = {username: process.env[`WIKIDOT_${label}_USERNAME`], password: process.env[`WIKIDOT_${label}_PASSWORD`]};
    delete process.env[`WIKIDOT_${label}_USERNAME`];
    delete process.env[`WIKIDOT_${label}_PASSWORD`];
    delete process.env[`WIKIDOT_${label}_EMAIL`];
    if (!credentials[label].username || !credentials[label].password) throw new Error(`account ${label} credentials are required through the environment`);
  }

  const owner = new WikidotSession("owner");
  const anonymous = new WikidotSession("anonymous");
  const second = new WikidotSession("second-account");
  const third = new WikidotSession("third-account");
  const sessions = {owner, anonymous, "second-account": second, "third-account": third};
  const lifecycle = {};
  const previewMatrices = {};
  const cleanupOperations = [];
  const draftLocks = new Map();
  let publishedCreated = false;
  let holderCreated = false;
  let baselineRows = null;
  let finalRows = null;
  let savedHolder = null;
  let publishedRevisionBefore = null;
  let publishedRevisionAfter = null;
  let primaryError = null;
  let preflight = {
    discard_route_established: false,
    discard_verification_route_established: false,
    all_fullnames_absent_or_run_owned: false,
    foreign_draft_reused: false,
    static_module_route: EDIT_MODULE_JS,
    static_module_sha256: null,
    attempted_actions: [],
  };
  let actorMatrix = [
    {actor_id: "owner", client_identity: "independent-session-a", observed_role_category: "unresolved"},
    {actor_id: "anonymous", client_identity: "independent-anonymous-session", observed_role_category: "anonymous"},
    {actor_id: "second-account", client_identity: "independent-session-b", observed_role_category: "unresolved"},
    {actor_id: "third-account", client_identity: "independent-session-c", observed_role_category: "unresolved"},
  ];

  const {existing_page: existingPage, nonexisting_page: nonexistingPage, holder_page: holderPage, published_source: publishedSource, holder_source: holderSource} = fixture.fixture;
  const existingTitleV1 = "Q1035 FW21 existing draft v1";
  const existingTitleV2 = "Q1035 FW21 existing draft v2";
  const nonexistingTitleV1 = "Q1035 FW21 nonexisting draft v1";
  const nonexistingTitleV2 = "Q1035 FW21 nonexisting draft v2";

  await owner.login(credentials.A.username, credentials.A.password);
  await second.login(credentials.B.username, credentials.B.password);
  await third.login(credentials.C.username, credentials.C.password);
  credentials.A = credentials.B = credentials.C = null;

  try {
    const moduleJsResponse = await fetch(EDIT_MODULE_JS);
    const moduleJs = await moduleJsResponse.text();
    if (!moduleJsResponse.ok || !moduleJs.includes('b.event="synchronize"') || !moduleJs.includes('b.event="checkDraftExists"') || !moduleJs.includes('b.event="removePageEditLock"')) throw new Error("public PageEditModule JavaScript does not expose the required draft lifecycle actions");
    preflight.static_module_sha256 = sha256(moduleJs);
    preflight.attempted_actions.push("PageEditModule.js saveDraft -> WikiPageAction/synchronize");
    preflight.attempted_actions.push("PageEditModule.js cancel -> WikiPageAction/checkDraftExists then removePageEditLock");

    for (const slug of [existingPage, nonexistingPage, holderPage]) if (await owner.source(slug)) throw new Error(`assigned fullname already exists: ${slug}`);
    const baselineMatrix = await previewMatrix(anonymous, fixture.listdrafts_cases);
    for (const item of baselineMatrix) if (findRow(item, existingPage) || findRow(item, nonexistingPage) || findRow(item, holderPage)) throw new Error("assigned fullname already appears in a preexisting draft row");
    preflight.all_fullnames_absent_or_run_owned = true;

    const preflightSlug = "run-owned:q1035-fw21-discard-preflight-20260810";
    if (await owner.source(preflightSlug)) throw new Error("discard preflight fullname unexpectedly exists");
    const preflightEdit = await owner.edit(preflightSlug);
    const preflightDraft = await owner.checkDraft(preflightSlug, preflightEdit, "Q1035 discard preflight", "Q1035 discard preflight");
    if (preflightDraft) throw new Error("discard preflight fullname has a foreign draft");
    await owner.closeEdit(preflightSlug, preflightEdit, false);
    preflight.discard_route_established = true;
    preflight.discard_verification_route_established = await owner.verifyDraftAbsent(preflightSlug);
    if (!preflight.discard_verification_route_established) throw new Error("public discard verification route did not prove absence");

    const identities = {};
    for (const [actorId, session] of [["owner", owner], ["second-account", second], ["third-account", third]]) {
      const {result} = await session.preview("[[module ListDrafts pageType=\"exists\"]]");
      if (!Number.isSafeInteger(result.account?.id)) throw new Error(`public actor identity unavailable for ${actorId}`);
      identities[actorId] = result.account.id;
    }
    actorMatrix = await Promise.all(actorMatrix.map(async (actor) => actor.actor_id === "anonymous" ? actor : ({...actor, observed_role_category: await roleCategory(owner, identities[actor.actor_id])})));

    await owner.savePage(existingPage, "Q1035 FW21 published page", publishedSource);
    publishedCreated = true;
    await owner.savePage(holderPage, "Q1035 FW21 ListDrafts holder", holderSource);
    holderCreated = true;
    const publishedBaselineEdit = await owner.edit(existingPage);
    publishedRevisionBefore = String(publishedBaselineEdit.page_revision_id ?? "");
    await owner.closeEdit(existingPage, publishedBaselineEdit, false);

    baselineRows = await previewMatrix(owner, fixture.listdrafts_cases);
    lifecycle.empty_baseline = summarizeStage("empty-baseline-before-run-owned-draft-creation", baselineRows);

    const existingEdit = await owner.edit(existingPage);
    draftLocks.set(existingPage, existingEdit);
    const existingSaveOne = await owner.saveDraft(existingPage, existingTitleV1, "Q1035 existing draft body v1", existingEdit);
    if (!await owner.checkDraft(existingPage, existingEdit, existingTitleV1, "Q1035 existing draft body v1")) throw new Error("existing-page draft was not publicly detectable after synchronize");
    const existingOnly = await previewMatrix(owner, fixture.listdrafts_cases);
    const publishedDuringExisting = await owner.source(existingPage);
    lifecycle.existing_only = {...summarizeStage("existing-draft-only", existingOnly), draft_save: existingSaveOne, existing_published_unchanged: publishedDuringExisting?.source === publishedSource};

    const nonexistingEdit = await owner.edit(nonexistingPage);
    draftLocks.set(nonexistingPage, nonexistingEdit);
    const nonexistingSaveOne = await owner.saveDraft(nonexistingPage, nonexistingTitleV1, "Q1035 nonexisting draft body v1", nonexistingEdit);
    if (!await owner.checkDraft(nonexistingPage, nonexistingEdit, nonexistingTitleV1, "Q1035 nonexisting draft body v1")) throw new Error("nonexisting-page draft was not publicly detectable after synchronize");
    const bothDrafts = await previewMatrix(owner, fixture.listdrafts_cases);
    lifecycle.both_drafts = {...summarizeStage("existing-plus-nonexisting-drafts", bothDrafts), draft_save: nonexistingSaveOne, existing_published_unchanged: (await owner.source(existingPage))?.source === publishedSource, nonexisting_target_absent: (await owner.source(nonexistingPage)) === null};

    const existingSaveTwo = await owner.saveDraft(existingPage, existingTitleV2, "Q1035 existing draft body v2", existingEdit);
    const existingUpdated = await previewMatrix(owner, fixture.listdrafts_cases);
    const existingUpdatedRow = findRow(existingUpdated.find(({case_id}) => case_id === "exists"), existingPage);
    lifecycle.existing_updated = {...summarizeStage("existing-draft-updated-second-time", existingUpdated), draft_save: existingSaveTwo, update_verified: existingUpdatedRow?.text === existingTitleV2};
    if (!lifecycle.existing_updated.update_verified) throw new Error("existing-page draft update was not visible in ListDrafts");

    const nonexistingSaveTwo = await owner.saveDraft(nonexistingPage, nonexistingTitleV2, "Q1035 nonexisting draft body v2", nonexistingEdit);
    const nonexistingUpdated = await previewMatrix(owner, fixture.listdrafts_cases);
    const nonexistingUpdatedRow = findRow(nonexistingUpdated.find(({case_id}) => case_id === "notexists"), nonexistingPage);
    lifecycle.nonexisting_updated = {...summarizeStage("nonexisting-draft-updated-second-time", nonexistingUpdated), draft_save: nonexistingSaveTwo, update_verified: nonexistingUpdatedRow?.text === nonexistingTitleV2};
    if (!lifecycle.nonexisting_updated.update_verified) throw new Error("nonexisting-page draft update was not visible in ListDrafts");

    for (const [actorId, session] of Object.entries(sessions)) previewMatrices[actorId] = await previewMatrix(session, fixture.listdrafts_cases);

    const anonymousHolder = await anonymous.get(holderPage);
    if (anonymousHolder.status !== 200) throw new Error(`saved holder returned HTTP ${anonymousHolder.status}`);
    savedHolder = {...selectedListDraftsDom(anonymousHolder.html, "saved-holder-anonymous-GET"), http_status: anonymousHolder.status, saved_source: (await owner.source(holderPage))?.source ?? null};

    await owner.closeEdit(existingPage, existingEdit, false);
    draftLocks.delete(existingPage);
    const existingAbsent = await owner.verifyDraftAbsent(existingPage);
    const afterExistingDiscard = await previewMatrix(owner, fixture.listdrafts_cases);
    lifecycle.after_existing_discard = {...summarizeStage("after-existing-draft-discard", afterExistingDiscard), existing_draft_absent: existingAbsent};
    if (!existingAbsent) throw new Error("existing-page draft remained after discard");

    await owner.closeEdit(nonexistingPage, nonexistingEdit, false);
    draftLocks.delete(nonexistingPage);
    const nonexistingAbsent = await owner.verifyDraftAbsent(nonexistingPage);
    const afterNonexistingDiscard = await previewMatrix(owner, fixture.listdrafts_cases);
    lifecycle.after_nonexisting_discard = {...summarizeStage("after-nonexisting-draft-discard", afterNonexistingDiscard), nonexisting_draft_absent: nonexistingAbsent};
    if (!nonexistingAbsent) throw new Error("nonexisting-page draft remained after discard");

    finalRows = afterNonexistingDiscard;
    const baselineSignature = JSON.stringify(baselineRows.map(({case_id, rows}) => ({case_id, rows})));
    const finalSignature = JSON.stringify(finalRows.map(({case_id, rows}) => ({case_id, rows})));
    lifecycle.final_baseline = {
      ...summarizeStage("final-empty-run-owned-wrapper-matrix", finalRows),
      run_owned_row_count: finalRows.flatMap(({rows}) => rows).filter(({href}) => href === `/${existingPage}` || href === `/${nonexistingPage}`).length,
      wrapper_present_for_every_case: finalRows.every(({wrapper}) => wrapper.tag === "div" && wrapper.class === "list-drafts-box"),
      foreign_baseline_restored: baselineSignature === finalSignature,
      foreign_baseline_rows: baselineRows.find(({case_id}) => case_id === "omitted").rows,
    };
    if (lifecycle.final_baseline.run_owned_row_count !== 0 || !lifecycle.final_baseline.foreign_baseline_restored) throw new Error("final ListDrafts matrix did not restore the exact pre-run baseline");

    const finalPublishedEdit = await owner.edit(existingPage);
    publishedRevisionAfter = String(finalPublishedEdit.page_revision_id ?? "");
    await owner.closeEdit(existingPage, finalPublishedEdit, false);
  } catch (error) {
    primaryError = error;
  } finally {
    for (const [slug, edit] of [...draftLocks.entries()].reverse()) {
      try {
        await owner.closeEdit(slug, edit, false);
        cleanupOperations.push({object: `draft:${slug}`, status: "discarded-after-error"});
      } catch (error) {
        cleanupOperations.push({object: `draft:${slug}`, status: "cleanup-failed", failure: error.message});
      }
    }
    draftLocks.clear();
    for (const [slug, source, created] of [[holderPage, holderSource, holderCreated], [existingPage, publishedSource, publishedCreated]]) {
      try {
        const result = await owner.removePage(slug, source);
        cleanupOperations.push({object: `page:${slug}`, status: result.status});
      } catch (error) {
        cleanupOperations.push({object: `page:${slug}`, status: "cleanup-failed", failure: error.message});
      }
      if (!created && await owner.source(slug)) cleanupOperations.push({object: `page:${slug}`, status: "unexpected-preexisting-object"});
    }
  }

  let existingDraftAbsent = false;
  let nonexistingDraftAbsent = false;
  try { existingDraftAbsent = await owner.verifyDraftAbsent(existingPage); } catch {}
  try { nonexistingDraftAbsent = await owner.verifyDraftAbsent(nonexistingPage); } catch {}
  const remaining = [];
  if (await owner.source(existingPage)) remaining.push(existingPage);
  if (await owner.source(nonexistingPage)) remaining.push(nonexistingPage);
  if (await owner.source(holderPage)) remaining.push(holderPage);
  if (!existingDraftAbsent) remaining.push(`draft:${existingPage}`);
  if (!nonexistingDraftAbsent) remaining.push(`draft:${nonexistingPage}`);
  const cleanupFailed = cleanupOperations.some(({status}) => status === "cleanup-failed" || status === "unexpected-preexisting-object") || remaining.length > 0;
  if (cleanupFailed && !primaryError) primaryError = new Error("run-owned cleanup was incomplete");

  const ownerMatrix = previewMatrices.owner ?? [];
  const existsCase = ownerMatrix.find(({case_id}) => case_id === "exists");
  const notexistsCase = ownerMatrix.find(({case_id}) => case_id === "notexists");
  const omittedCase = ownerMatrix.find(({case_id}) => case_id === "omitted");
  const emptyCase = ownerMatrix.find(({case_id}) => case_id === "empty");
  const controls = {
    "both-exists-includes-existing": Boolean(existsCase && findRow(existsCase, existingPage)),
    "both-notexists-includes-nonexisting": Boolean(notexistsCase && findRow(notexistsCase, nonexistingPage)),
    "both-exists-excludes-nonexisting": Boolean(existsCase && !findRow(existsCase, nonexistingPage)),
    "both-notexists-excludes-existing": Boolean(notexistsCase && !findRow(notexistsCase, existingPage)),
    "both-omitted-includes-both": Boolean(omittedCase && findRow(omittedCase, existingPage) && findRow(omittedCase, nonexistingPage)),
    "both-empty-includes-both": Boolean(emptyCase && findRow(emptyCase, existingPage) && findRow(emptyCase, nonexistingPage)),
  };
  if (!primaryError && Object.values(controls).some((passed) => !passed)) primaryError = new Error("required promoted-rule control failed");
  const status = primaryError ? "blocked" : "observed";
  const promotedRules = status === "observed" ? fixture.promoted_rule_contracts.map((rule) => ({
    ...rule,
    observations: [...rule.positive_control_ids, ...rule.negative_control_ids].map((control_id) => ({control_id, passed: controls[control_id]})),
  })) : [];

  const artifact = {
    schema: "wikidot.live.open43.q1035-listdrafts-nonempty.v1",
    captured_at: new Date().toISOString(),
    status,
    site: fixture.site,
    run_id: fixture.run_id,
    surface_ids: fixture.surface_ids,
    fixture_sha256: sha256(fixtureBytes),
    fixture: fixture.fixture,
    public_interfaces: [
      "edit/PageEditModule",
      "WikiPageAction/savePage",
      "WikiPageAction/synchronize",
      "WikiPageAction/checkDraftExists",
      "WikiPageAction/removePageEditLock",
      "edit/PagePreviewModule",
      "anonymous saved-holder GET",
      "viewsource/ViewSourceModule",
      "WikiPageAction/deletePage",
    ],
    actor_matrix: actorMatrix,
    preflight,
    lifecycle,
    preview_matrices: previewMatrices,
    saved_holder: savedHolder,
    promoted_rules: promotedRules,
    published_page_unchanged: {
      source: publishedSource,
      source_sha256: sha256(publishedSource),
      revision_before: publishedRevisionBefore,
      revision_after: publishedRevisionAfter,
      unchanged_during_drafts: lifecycle.existing_only?.existing_published_unchanged === true && lifecycle.both_drafts?.existing_published_unchanged === true && publishedRevisionBefore === publishedRevisionAfter,
    },
    nonexisting_page_absent: {
      before_draft: preflight.all_fullnames_absent_or_run_owned,
      during_draft: lifecycle.both_drafts?.nonexisting_target_absent === true,
      after_discard: (await owner.source(nonexistingPage)) === null,
    },
    cleanup: {
      owned_fullnames: [existingPage, nonexistingPage, holderPage],
      discard_existing: {verified_absent: existingDraftAbsent},
      discard_nonexisting: {verified_absent: nonexistingDraftAbsent},
      published_page_deleted: !(await owner.source(existingPage)),
      holder_page_deleted: !(await owner.source(holderPage)),
      baseline_restored: lifecycle.final_baseline?.foreign_baseline_restored === true,
      remaining_run_owned_objects: remaining,
      operations: cleanupOperations,
    },
    blocked: status === "blocked" ? {
      reason: primaryError.message,
      missing_authority: primaryError.message,
      draft_types_created: Number(Boolean(lifecycle.existing_only)) + Number(Boolean(lifecycle.both_drafts)),
    } : null,
    credential_material: "none; credentials, cookies, account identifiers, edit locks, and hidden form values remained process-local",
    remaining_gaps: [
      "draft expiration and clock behavior",
      "rename, delete, and publish effects on active drafts",
      "cache convergence and concurrent draft updates",
      "actor visibility beyond the exact four observed clients",
      "saved-page behavior for authenticated viewers",
      "local Wikijump draft persistence and product implementation",
    ],
  };
  await writeFile(args.output, `${JSON.stringify(artifact, null, 2)}\n`, {flag: "wx"});
  process.stdout.write(`${args.output}\nstatus=${status}\n`);
}

await main(process.argv);
