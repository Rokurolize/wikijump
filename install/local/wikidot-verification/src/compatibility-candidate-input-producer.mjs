import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { buildQ1026UserIdentitySource } from "./open43-q1026-user-identity-candidate-case-set.mjs";
import { OPEN43_Q1032_SAVED_DIRECTORY_SOURCE } from "./open43-q1032-members-userinfo-candidate-contract.mjs";
import { SAVED_SOURCE as Q1036_SAVED_SOURCE } from "./open43-q1036-search-feed-candidate-contract.mjs";
import { FORUM_MINI_SAVED_SOURCE } from "./open43-q778-forum-mini-candidate-case-set.mjs";
import { Q1034_SAVED_SOURCES } from "./open43-q1034-forum-candidate-case-set.mjs";
import { Q1035_SAVED_SOURCES } from "./open43-q1035-sitechanges-candidate-case-set.mjs";
import { captureUrlsSha256 } from "../scripts/capture-framerail-route-action-temporal.mjs";
import { defaultBrowserRoot, loadPlaywright } from "./browser-session.mjs";
import { readJsonObject, sealJsonNoReplace, sha256File } from "./standing-browser-parity-util.mjs";

export const COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA = "wikijump.compatibility_candidate_input_receipt.v1";
const SITE_ID = 6_000_003;
const SITE_SLUG = "scpaiueouiuiuiui";
const FOREIGN_SITE_ID = 6_000_006;
const ACTOR_IDS = Object.freeze({ editor: 20_000_007, eligible: 20_000_008, registered: 20_000_009, pending: 20_000_010, banned: 20_000_011, other: 20_000_012 });
const Q1026_USERS = Object.freeze({
  visible_user: Object.freeze({ user_id: 19_102_600, name: "Extant User", slug: "extant-user", is_deleted: false }),
  deleted_user: Object.freeze({ user_id: 19_102_601, name: "Deleted User", slug: "deleted-user", is_deleted: true }),
});
const MEDIA_BROWSER_EVIDENCE = Object.freeze({
  M756_BROWSER_CACHE_TRANSITIONS: "E_ICON_OBSERVATIONS",
  M776_BROWSER_GEOMETRY_AND_NETWORK: "E_G06",
  M806_BROWSER_GEOMETRY_AND_NETWORK: "E_G61",
  M1043_BROWSER_RENDER_AND_VIEWER: "E_FOCUSED_CORPUS",
  M1062_BROWSER_UPLOAD_FLOW: "E_UPLOAD_HISTORICAL_FAILURE",
});
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function usage() {
  return "Usage: prepare-compatibility-candidate-inputs.mjs --candidate-identity FILE --private-runtime FILE --template-private-dir DIR --output-private-dir DIR --receipt FILE";
}

export function parseCompatibilityCandidateInputArgs(argv) {
  if (argv.includes("--help") || argv.includes("-h")) return { help: true };
  const names = new Set(["candidate-identity", "private-runtime", "template-private-dir", "output-private-dir", "receipt"]);
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    const name = flag?.startsWith("--") ? flag.slice(2) : "";
    if (!names.has(name) || Object.hasOwn(result, name) || !value || value.startsWith("--")) throw new Error(usage());
    result[name] = path.resolve(value);
  }
  for (const name of names) if (!result[name]) throw new Error(usage());
  if (result["template-private-dir"] === result["output-private-dir"]) throw new Error("template and output private directories must differ");
  return result;
}

function dockerInspect(name) {
  return JSON.parse(execFileSync("docker", ["inspect", name], { encoding: "utf8" }))[0];
}

function containerIp(name) {
  const networks = Object.values(dockerInspect(name).NetworkSettings.Networks ?? {});
  if (networks.length !== 1 || !networks[0].IPAddress) throw new Error(`candidate container ${name} has no exact network address`);
  return networks[0].IPAddress;
}

function sql(container, statement, { capture = true } = {}) {
  return execFileSync("docker", ["exec", "-i", container, "sh", "-lc", "PGPASSWORD=\"$POSTGRES_PASSWORD\" psql -h 127.0.0.1 -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -v ON_ERROR_STOP=1 -At"], {
    input: statement,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["pipe", "pipe", "inherit"] : ["pipe", "ignore", "inherit"],
  }).trim();
}

async function copyPrivateTemplates(templateRoot, outputRoot, bindings) {
  await fs.mkdir(outputRoot, { recursive: false, mode: 0o700 });
  const files = (await fs.readdir(templateRoot)).filter((name) => name.endsWith(".json")).sort();
  if (files.length === 0) throw new Error("template private directory contains no JSON inputs");
  for (const name of files) {
    const input = JSON.parse(await fs.readFile(path.join(templateRoot, name), "utf8"));
    Object.assign(input, bindings.public);
    if (input.cargo_env) Object.assign(input.cargo_env, bindings.cargo);
    if (input.runtime_bindings) input.runtime_bindings = bindings.runtime;
    await fs.writeFile(path.join(outputRoot, name), `${JSON.stringify(input, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  await fs.writeFile(path.join(outputRoot, "tls-ca.pem"), bindings.public.tls_ca_pem, { mode: 0o600, flag: "wx" });
  return files;
}

function actorDefinition(template, name) {
  const actor = template.actors?.[name];
  if (!actor || actor.user_id !== ACTOR_IDS[name] || typeof actor.password !== "string" || typeof actor.name !== "string" || typeof actor.slug !== "string") {
    throw new Error(`template actor ${name} is incomplete`);
  }
  return actor;
}

export async function prepareCompatibilityCandidateInputs(args) {
  const [identity, runtime, identitySha256] = await Promise.all([
    readJsonObject(args["candidate-identity"], "editable candidate identity"),
    readJsonObject(args["private-runtime"], "candidate private runtime"),
    sha256File(args["candidate-identity"]),
  ]);
  const candidate = identity.candidate;
  if (candidate?.endpoint?.host !== `${SITE_SLUG}.wikijump.localhost` || candidate.endpoint.port === 443 || candidate.port_443_published !== false) throw new Error("producer requires the exact non-standing editable compatibility candidate");
  const project = candidate.compose_project;
  if (typeof project !== "string" || !project.startsWith("wikijump-compat-")) throw new Error("candidate compose project is outside compatibility ownership");
  if (runtime.editable_candidate_identity_sha256 !== identitySha256) throw new Error("private runtime is not bound to the editable candidate identity");

  const database = `${project}-database-1`;
  const cache = `${project}-cache-1`;
  const files = `${project}-files-1`;
  const caddy = `${project}-caddy-1`;
  for (const name of [database, cache, files, caddy]) if (dockerInspect(name).State?.Running !== true) throw new Error(`candidate container is not running: ${name}`);
  const caPath = path.join(path.dirname(args.receipt), `.candidate-ca-${process.pid}.pem`);
  try {
    execFileSync("docker", ["cp", `${caddy}:/data/caddy/pki/authorities/local/root.crt`, caPath], { stdio: "ignore" });
    const tlsCa = await fs.readFile(caPath, "utf8");
    const standardIdentityPath = path.join(path.dirname(args["candidate-identity"]), "candidate-identity.json");
    const standardIdentitySha256 = await sha256File(standardIdentityPath);
    const dbIp = containerIp(database);
    const cacheIp = containerIp(cache);
    const filesIp = containerIp(files);
    const bindings = {
      public: {
        candidate_identity_sha256: standardIdentitySha256,
        editable_candidate_identity_sha256: identitySha256,
        candidate_origin: candidate.site_origins[SITE_SLUG].page,
        deepwell_rpc_url: runtime.deepwell_rpc_url,
        deepwell_rpc_token: runtime.deepwell_rpc_token,
        object_store_origin: runtime.object_store_origin,
        presigned_origin: runtime.presigned_origin,
        tls_ca_pem: tlsCa,
      },
      cargo: {
        DATABASE_URL: `postgres://wikijump:wikijump@${dbIp}:5432/wikijump`,
        REDIS_URL: `redis://${cacheIp}:6379`,
        DEEPWELL_RPC_TOKEN: runtime.deepwell_rpc_token,
        S3_CUSTOM_ENDPOINT: `http://${filesIp}:9000`,
      },
      runtime: [
        { role: "caddy", container_port: "443/tcp", host_address: candidate.endpoint.local_connect_address, host_port: candidate.endpoint.port },
        { role: "deepwell", container_port: "2747/tcp", host_address: "127.0.0.1", host_port: Number(new URL(runtime.deepwell_rpc_url).port) },
        { role: "files", container_port: "9000/tcp", host_address: "127.0.0.1", host_port: Number(new URL(runtime.object_store_origin).port) },
      ],
    };
    const privateFiles = await copyPrivateTemplates(args["template-private-dir"], args["output-private-dir"], bindings);
    const generalPath = path.join(args["output-private-dir"], "general-r11.json");
    const general = JSON.parse(await fs.readFile(generalPath, "utf8"));

    // Candidate-owned users are created through the public Deepwell mutation seam. Only the platform-staff
    // bootstrap session is inserted directly because no unauthenticated seam can mint that authority.
    const staffToken = `wj:${randomBytes(48).toString("base64url")}`;
    sql(database, `insert into session(session_token,user_id,created_at,expires_at,ip_address,user_agent,restricted,mfa_failed_attempts) values ($x$${staffToken}$x$,-1,now(),now()+interval '24 hours','127.0.0.1','compatibility input producer',false,0);`);
    let rpcId = 0;
    const rpc = async (method, params, { token = staffToken, siteId = null } = {}) => {
      const response = await fetch(runtime.deepwell_rpc_url, { method: "POST", headers: { authorization: `Bearer ${runtime.deepwell_rpc_token}`, "content-type": "application/json", ...(token ? { "x-deepwell-session-token": token } : {}), ...(siteId === null ? {} : { "x-deepwell-site-id": String(siteId) }) }, body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }) });
      const payload = JSON.parse(await response.text());
      if (!response.ok || payload.error) throw new Error(`${method}: ${payload.error?.message ?? response.status}`);
      return payload.result ?? null;
    };
    for (const name of Object.keys(ACTOR_IDS)) {
      const actor = actorDefinition(general, name);
      const existing = await rpc("user_get", { user: actor.user_id });
      if (existing === null) {
        await rpc("user_create", { user_type: "regular", name: actor.name, email: `${actor.slug}@candidate.invalid`, locales: ["en-US", "en"], password: actor.password, bypass_filter: true, bypass_email_verification: true, override_user_id: actor.user_id, ip_address: "127.0.0.1" });
      } else if (existing.name !== actor.name || existing.slug !== actor.slug) throw new Error(`candidate actor identity collision for ${name}`);
    }
    const tokens = Object.fromEntries(Object.entries(ACTOR_IDS).map(([name, userId]) => [name, { userId, token: `wj:${randomBytes(48).toString("base64url")}` }]));
    const expiredToken = `wj:${randomBytes(48).toString("base64url")}`;
    const sessionRows = Object.values(tokens).map(({ userId, token }) => `($x$${token}$x$,${userId},now(),now()+interval '24 hours','127.0.0.1','compatibility input producer',false,0)`).join(",");
    sql(database, `insert into session(session_token,user_id,created_at,expires_at,ip_address,user_agent,restricted,mfa_failed_attempts) values ${sessionRows}; insert into session(session_token,user_id,created_at,expires_at,ip_address,user_agent,restricted,mfa_failed_attempts) values ($x$${expiredToken}$x$,${ACTOR_IDS.editor},now()-interval '2 hours',now()-interval '1 hour','127.0.0.1','compatibility expired actor',false,0); insert into user_role(user_id,role_id,site_id,assigned_at,assigned_by) select ${ACTOR_IDS.editor},role_id,site_id,now(),-1 from user_role where user_id=-1 and site_id=${SITE_ID} on conflict do nothing; update site set locale='en' where site_id=${SITE_ID};`);
    general.actors.administrator = { user_id: -1, session_token: staffToken };
    for (const name of Object.keys(ACTOR_IDS)) general.actors[name].session_token = tokens[name].token;
    general.actors.non_admin = { user_id: ACTOR_IDS.other, session_token: tokens.other.token };
    general.actors.expired = { user_id: ACTOR_IDS.editor, session_token: expiredToken };
    const propagateActors = async () => {
      for (const name of privateFiles) {
        const target = path.join(args["output-private-dir"], name);
        const value = JSON.parse(await fs.readFile(target, "utf8"));
        if (!value.actors) continue;
        for (const [actorName, actor] of Object.entries(value.actors)) {
          const source = general.actors[actorName];
          if (source) Object.assign(actor, source);
        }
        await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
      }
    };
    await propagateActors();

    const page = async (slug, title, wikitext, { siteId = SITE_ID, imported = false } = {}) => {
      const prior = await rpc("page_get", { site_id: siteId, page: slug, details: { wikitext: true, compiled: false } }, { siteId });
      if (prior !== null) throw new Error(`candidate fixture already exists: ${siteId}:${slug}`);
      await rpc("page_create", { site_id: siteId, slug, title, alt_title: null, wikitext, layout: "wikidot", user_id: -1, ip_address: "127.0.0.1", tags: [], revision_comments: "compatibility candidate fixture" }, { siteId });
      const created = await rpc("page_get", { site_id: siteId, page: slug, details: { wikitext: true, compiled: false } }, { siteId });
      if (!created || created.wikitext !== wikitext) throw new Error(`candidate fixture readback failed: ${slug}`);
      if (imported) sql(database, `update page set from_wikidot=true where page_id=${created.page_id}; update page_revision set from_wikidot=true where revision_id=${created.revision_id};`);
      return created;
    };
    const edit = async (pageValue, wikitext, comments) => await rpc("page_edit", { site_id: SITE_ID, page: pageValue.page_id, last_revision_id: pageValue.revision_id, revision_comments: comments, user_id: ACTOR_IDS.editor, wikitext, ip_address: "127.0.0.1" }, { token: tokens.editor.token, siteId: SITE_ID });

    const defaultPage = await rpc("page_get", { site_id: SITE_ID, page: "boundary-check", details: { wikitext: false, compiled: false } }, { siteId: SITE_ID });
    const transitionPage = await rpc("page_get", { site_id: SITE_ID, page: "corpus:scp-9506-draft", details: { wikitext: false, compiled: false } }, { siteId: SITE_ID });
    if (!defaultPage || !transitionPage) throw new Error("fresh candidate is missing the maintained base page fixtures");
    for (const name of privateFiles) {
      const target = path.join(args["output-private-dir"], name);
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      if (value.fixture?.default_category) Object.assign(value.fixture.default_category, { category_id: defaultPage.page_category_id, page_id: defaultPage.page_id, page_slug: defaultPage.slug });
      if (value.fixture?.transition_category) Object.assign(value.fixture.transition_category, { category_id: transitionPage.page_category_id, page_id: transitionPage.page_id, page_slug: transitionPage.slug });
      await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    }

    const redirectTarget = await page("a1037-imported-redirect-target", "A1037 Imported Redirect Target", "A1037_REDIRECT_TARGET_FIXTURE", { imported: true });
    const redirectSourceText = '[[module Redirect destination="a1037-imported-redirect-target"]]';
    const redirectSource = await page("a1037-imported-redirect-fixture", "A1037 Imported Redirect Fixture", redirectSourceText, { imported: true });
    general.a1037_redirect_fixture = { source_page: { page_id: redirectSource.page_id, revision_id: redirectSource.revision_id, slug: redirectSource.slug, source_sha256: sha256(redirectSourceText) }, target_page: { page_id: redirectTarget.page_id, revision_id: redirectTarget.revision_id, slug: redirectTarget.slug } };

    const members = await page("members-directory", "Members Directory", OPEN43_Q1032_SAVED_DIRECTORY_SOURCE);
    general.saved_page = { page_id: members.page_id, revision_id: members.revision_id, slug: members.slug };
    general.saved_page_source_sha256 = sha256(OPEN43_Q1032_SAVED_DIRECTORY_SOURCE);
    sql(database, `insert into known_user(user_id) select generate_series(20000100,20000250) on conflict do nothing; insert into wikidot_user(user_id,created_at,fetched_at,is_deleted,name,slug,karma,is_pro) select id,now()-interval '1 second',now(),false,'Fixture Member '||id,'fixture-member-'||id,0,false from generate_series(20000100,20000250) id on conflict do nothing; insert into relation(relation_type,dest_type,dest_id,from_type,from_id,metadata,created_by) select 'member','site',${SITE_ID},'user',id,'{"accepted":{"cause":"accepted","user_id":-1}}'::jsonb,-1 from generate_series(20000100,20000250) id on conflict do nothing;`);

    const featuredSource = "FEATURED_START\n[[module FeaturedSite]]\nFEATURED_END";
    const featured = await page("q810-featuredsite-saved", "Q810 FeaturedSite Saved", featuredSource);
    const nestedSource = '[[module ListPages name="q810-featuredsite-saved" limit="1"]]\n%%content%%\n[[/module]]';
    const featuredNested = await page("q810-featuredsite-nested", "Q810 FeaturedSite Nested", nestedSource);
    general.featuredsite_fixture = { site: { site_id: SITE_ID, slug: SITE_SLUG }, saved_page: { page_id: featured.page_id, revision_id: featured.revision_id, slug: featured.slug, source_sha256: sha256(featuredSource) }, nested_page: { page_id: featuredNested.page_id, revision_id: featuredNested.revision_id, slug: featuredNested.slug, source_sha256: sha256(nestedSource) } };

    const forumMini = await page("q778-forum-mini", "Q778 Forum Mini", FORUM_MINI_SAVED_SOURCE);
    general.forum_mini_fixture = { site: { site_id: SITE_ID, slug: SITE_SLUG }, saved_page: { page_id: forumMini.page_id, revision_id: forumMini.revision_id, slug: forumMini.slug, source_sha256: sha256(FORUM_MINI_SAVED_SOURCE) }, forbidden_markers: ["Q778_HIDDEN_MARKER", "Q778_PRIVATE_MARKER"] };

    const q1036 = await page("q1036-saved-boundary", "Q1036 saved boundary", Q1036_SAVED_SOURCE);
    Object.assign(general, { saved_page_id: q1036.page_id, saved_revision_id: q1036.revision_id, saved_page_slug: q1036.slug });

    sql(database, `insert into known_user(user_id) values (${Q1026_USERS.visible_user.user_id}),(${Q1026_USERS.deleted_user.user_id}) on conflict do nothing; insert into wikidot_user(user_id,created_at,fetched_at,is_deleted,name,slug,karma,is_pro) values (${Q1026_USERS.visible_user.user_id},now()-interval '1 second',now(),false,'${Q1026_USERS.visible_user.name}','${Q1026_USERS.visible_user.slug}',0,false),(${Q1026_USERS.deleted_user.user_id},now()-interval '1 second',now(),true,'${Q1026_USERS.deleted_user.name}','${Q1026_USERS.deleted_user.slug}',0,false) on conflict (user_id) do update set is_deleted=excluded.is_deleted,name=excluded.name,slug=excluded.slug,fetched_at=excluded.fetched_at;`);
    const q1026Source = buildQ1026UserIdentitySource(Q1026_USERS.visible_user, Q1026_USERS.deleted_user);
    const q1026Page = await page("fixture-wikidot-user-identity-matrix", "Q1026 identity matrix", q1026Source);
    const q1026Path = path.join(args["output-private-dir"], "q1026-r11.json");
    const q1026Input = JSON.parse(await fs.readFile(q1026Path, "utf8"));
    Object.assign(q1026Input.fixture, { site_id: SITE_ID, page: { page_id: q1026Page.page_id, revision_id: q1026Page.revision_id, slug: q1026Page.slug }, source_sha256: sha256(q1026Source), ...Q1026_USERS });
    await fs.writeFile(q1026Path, `${JSON.stringify(q1026Input, null, 2)}\n`, { mode: 0o600 });

    const q1034Pages = {};
    for (const [role, source] of Object.entries(Q1034_SAVED_SOURCES)) q1034Pages[role] = await page(`q1034-${role.replaceAll("_", "-")}`, `Q1034 ${role}`, source);

    const q809Source = '[[module RatedPages limit="1" minRating="1"]]';
    const q809Holder = await page("open43-q809-holder", "Q809 holder", q809Source);
    const q809Public = await page("publicq809:low", "Public low", "Q809 public rating target");
    const q809Private = await page("privateq809:high", "Private high", "Q809 private rating target");
    const privateCategory = q809Private.page_category_id;
    const publicCategory = q809Public.page_category_id;
    sql(database, `insert into role_permission(role_id,site_id,resource_type,resource_category_id,action) select role_id,${SITE_ID},'page',${privateCategory},'view' from role where site_id=${SITE_ID} and name in ('root','admin') on conflict do nothing; update page_category set rating_enabled=true,rating_permission='registered',rating_visibility='visible',rating_type='plus_minus' where category_id in (${privateCategory},${publicCategory}); insert into page_vote(page_id,user_id,value,rating_system) values (${q809Public.page_id},${ACTOR_IDS.eligible},1,'points'),(${q809Private.page_id},${ACTOR_IDS.eligible},1,'points'),(${q809Private.page_id},${ACTOR_IDS.registered},1,'points'),(${q809Private.page_id},${ACTOR_IDS.pending},1,'points') on conflict do nothing;`);

    const backHolder = await page("qbacklinks-holder", "Q Backlinks Holder", "BACKLINKS_HOLDER\n[[module Backlinks]]");
    const backEmpty = await page("qbacklinks-empty", "Q Backlinks Empty", "BACKLINKS_EMPTY\n[[module Backlinks]]");
    const backVisibleA = await page("qbacklinks-visible-a", "AAA Backlinks Visible A", "[[[qbacklinks-holder]]]");
    const backVisibleB = await page("qbacklinks-visible-b", "AAB Backlinks Visible B", "[[[qbacklinks-holder]]]");
    const backHidden = await page("qbacklinks-hidden", "Hidden Backlinks Row", "[[[qbacklinks-holder]]]");
    const backPrivate = await page("privateq809:qbacklinks-private", "Private Backlinks Row", "[[[qbacklinks-holder]]]");
    const backDeleted = await page("qbacklinks-deleted", "Deleted Backlinks Row", "[[[qbacklinks-holder]]]");
    const backForeign = await page("qbacklinks-foreign", "Foreign Backlinks Page", "[[[qbacklinks-holder]]]", { siteId: FOREIGN_SITE_ID });
    sql(database, `update page_revision set hidden=array['title','slug'] where revision_id=${backHidden.revision_id};`);
    await rpc("page_delete", { site_id: SITE_ID, page: backDeleted.page_id, last_revision_id: backDeleted.revision_id, revision_comments: "backlinks deleted fixture", user_id: -1, ip_address: "127.0.0.1" }, { siteId: SITE_ID });

    // Forum rows use high candidate-owned IDs because there is no public creation seam for groups/categories/threads.
    sql(database, `insert into forum_group(forum_group_id,site_id,created_by,name,description,visible,sort_index,from_wikidot) values (9000100,${SITE_ID},-1,'Q1034 group','candidate fixture',true,0,false); insert into forum_category(forum_category_id,forum_group_id,site_id,created_by,name,description,sort_index,from_wikidot,max_nest_level,per_page_discussion) values (9000101,9000100,${SITE_ID},-1,'Q1034 primary','candidate fixture',0,false,10,true),(9000102,9000100,${SITE_ID},-1,'Q1034 pagination','candidate fixture',1,false,10,false); insert into role_permission(role_id,site_id,resource_type,resource_category_id,action) select role_id,${SITE_ID},'forum-category',category_id,'create' from role cross join (values(9000101),(9000102)) c(category_id) where site_id=${SITE_ID} and name in ('root','admin') on conflict do nothing; insert into forum_thread(forum_thread_id,forum_category_id,forum_group_id,site_id,page_id,created_by,created_at,title,description,sticky,from_wikidot) values (9100101,9000101,9000100,${SITE_ID},null,${ACTOR_IDS.editor},now()-interval '1 minute','visible-thread','Q1034 visible thread',false,false),(9100122,9000101,9000100,${SITE_ID},${q1034Pages.comments_forward.page_id},${ACTOR_IDS.editor},now(),'comments-forward-thread','Q1034 comments forward',false,false),(9100123,9000101,9000100,${SITE_ID},${q1034Pages.comments_reverse.page_id},${ACTOR_IDS.editor},now(),'comments-reverse-thread','Q1034 comments reverse',false,false),(9100124,9000101,9000100,${SITE_ID},${forumMini.page_id},${ACTOR_IDS.editor},now(),'q778-mini-posts','Q778 mini post fixture',false,false); insert into forum_thread(forum_thread_id,forum_category_id,forum_group_id,site_id,page_id,created_by,created_at,title,description,sticky,from_wikidot) select 9200000+g,9000102,9000100,${SITE_ID},null,${ACTOR_IDS.editor},now()-(g||' seconds')::interval,'pagination-'||lpad(g::text,3,'0'),'Q1034 pagination',false,false from generate_series(1,221) g; update page set discussion_thread_id=9100122 where page_id=${q1034Pages.comments_forward.page_id}; update page set discussion_thread_id=9100123 where page_id=${q1034Pages.comments_reverse.page_id}; select setval('forum_group_forum_group_id_seq',greatest((select max(forum_group_id) from forum_group),9000100),true); select setval('forum_category_forum_category_id_seq',greatest((select max(forum_category_id) from forum_category),9000102),true); select setval('forum_thread_forum_thread_id_seq',greatest((select max(forum_thread_id) from forum_thread),9200221),true);`);
    execFileSync("docker", ["exec", cache, "redis-cli", "FLUSHALL"], { stdio: "ignore" });
    const post = async (thread, title, wikitext) => await rpc("forum_post_create", { site_id: SITE_ID, forum_thread_id: thread, parent_post_id: null, title, wikitext, guest_name: null, guest_email_md5: null }, { token: tokens.editor.token, siteId: SITE_ID });
    for (let i = 0; i < 20; i++) await post(9100101, `Q1034 visible ${i}`, `Q1034_VISIBLE_${i}`);
    for (const thread of [9100122, 9100123]) for (let i = 0; i < 12; i++) await post(thread, `Q1034 comments ${i}`, `[[div class="q1034-fwd-${String(i).padStart(2, "0")}"]]F${i}[[/div]]\n[[div class="q1034-rev-${String(i).padStart(2, "0")}"]]R${i}[[/div]]`);
    for (let i = 0; i < 5; i++) await post(9100124, `Q778 mini post ${i}`, `Q778 recent post excerpt ${i}`);

    const q1035Site = await page("q1035-sitechanges-holder", "Q1035 Public Activity", Q1035_SAVED_SOURCES.sitechanges_holder);
    const q1035Draft = await page("q1035-listdrafts-holder", "Q1035 ListDrafts Holder", Q1035_SAVED_SOURCES.listdrafts_holder);
    const insertRevisions = (from, to) => sql(database, `with base as (select pr.* from page_revision pr where revision_id=${q1035Site.revision_id}), ins as (insert into page_revision(revision_type,created_at,revision_number,page_id,site_id,user_id,from_wikidot,changes,wikitext_hash,compiled_body_html_hash,compiled_top_bar_html_hash,compiled_side_bar_html_hash,compiled_at,compiled_generator,comments,hidden,title,alt_title,slug,tags,compiled_body_styles_hash) select 'regular',now()+(g||' milliseconds')::interval,g,base.page_id,base.site_id,${ACTOR_IDS.editor},false,array['wikitext'],base.wikitext_hash,base.compiled_body_html_hash,base.compiled_top_bar_html_hash,base.compiled_side_bar_html_hash,now(),base.compiled_generator,'Q1035_SOURCE_COMMENT',array[]::text[],'Q1035 Public Activity',base.alt_title,base.slug,base.tags,base.compiled_body_styles_hash from base,generate_series(${from},${to}) g returning revision_id) update page set latest_revision_id=(select max(revision_id) from ins),updated_at=now() where page_id=${q1035Site.page_id};`);
    insertRevisions(1, 1105);
    let privateCurrent = await rpc("page_get", { site_id: SITE_ID, page: q809Private.slug, details: { wikitext: true, compiled: false } }, { token: tokens.editor.token, siteId: SITE_ID });
    await edit(privateCurrent, `${privateCurrent.wikitext}\nQ1035_PRIVATE_ACTIVITY_MID`, "Q1035 mid private activity");
    insertRevisions(1106, 2105);
    privateCurrent = await rpc("page_get", { site_id: SITE_ID, page: q809Private.slug, details: { wikitext: true, compiled: false } }, { token: tokens.editor.token, siteId: SITE_ID });
    await edit(privateCurrent, `${privateCurrent.wikitext}\nQ1035_PRIVATE_ACTIVITY_NEWEST`, "Q1035 newest private activity");
    sql(database, `with src as (select fr.* from file_revision fr order by fr.revision_id limit 1), nf as (insert into file(name,page_id,site_id,from_wikidot) values ('q1035-activity.txt',${q1035Site.page_id},${SITE_ID},false) returning file_id) insert into file_revision(revision_type,created_at,revision_number,file_id,page_id,site_id,user_id,name,s3_hash,mime,size,changes,comments,hidden,content_type_label,content_type_description) select 'create',now(),0,nf.file_id,${q1035Site.page_id},${SITE_ID},${ACTOR_IDS.editor},'q1035-activity.txt',src.s3_hash,src.mime,src.size,array['page','name','blob','mime'],'Q1035_FILE_COMMENT',array[]::text[],src.content_type_label,src.content_type_description from src,nf;`);
    const q1035Latest = await rpc("page_get", { site_id: SITE_ID, page: q1035Site.slug, details: { wikitext: true, compiled: false } }, { siteId: SITE_ID });

    const q809Path = path.join(args["output-private-dir"], "q809.json");
    const q809 = JSON.parse(await fs.readFile(q809Path, "utf8"));
    q809.fixture = { site_id: SITE_ID, holder: { page_id: q809Holder.page_id, slug: q809Holder.slug, title: "Q809 holder", category_id: q809Holder.page_category_id }, private_page: { page_id: q809Private.page_id, slug: q809Private.slug, title: "Private high", category_id: privateCategory }, public_page: { page_id: q809Public.page_id, slug: q809Public.slug, title: "Public low", category_id: publicCategory }, source: q809Source, initial_public_score: 1, mutated_public_score: 2, private_score: 3, mutation_value: 1 };
    await fs.writeFile(q809Path, `${JSON.stringify(q809, null, 2)}\n`, { mode: 0o600 });

    const backPath = path.join(args["output-private-dir"], "backlinks-r23.json");
    const back = JSON.parse(await fs.readFile(backPath, "utf8"));
    Object.assign(back.fixture, { site_id: SITE_ID, site_slug: SITE_SLUG, holder: { page_id: backHolder.page_id, slug: backHolder.slug, title: backHolder.title, source: "BACKLINKS_HOLDER\n[[module Backlinks]]" }, empty_holder: { page_id: backEmpty.page_id, slug: backEmpty.slug, title: backEmpty.title, source: "BACKLINKS_EMPTY\n[[module Backlinks]]" }, visible: [{ page_id: backVisibleA.page_id, slug: backVisibleA.slug, title: backVisibleA.title }, { page_id: backVisibleB.page_id, slug: backVisibleB.slug, title: backVisibleB.title }], hidden: [{ page_id: backHidden.page_id, slug: backHidden.slug, title: backHidden.title }], private: [{ page_id: backPrivate.page_id, slug: backPrivate.slug, title: backPrivate.title }], deleted: [{ page_id: backDeleted.page_id, slug: backDeleted.slug, title: backDeleted.title }], foreign_page: { page_id: backForeign.page_id, slug: backForeign.slug, title: backForeign.title, site_id: FOREIGN_SITE_ID, site_slug: "scp-wiki" }, stale_page_slug: "qbacklinks-stale-missing" });
    await fs.writeFile(backPath, `${JSON.stringify(back, null, 2)}\n`, { mode: 0o600 });

    const q1034Path = path.join(args["output-private-dir"], "q1034-r23.json");
    const q1034 = JSON.parse(await fs.readFile(q1034Path, "utf8"));
    for (const [role, pageValue] of Object.entries(q1034Pages)) q1034.forum_read_fixture.pages[role] = { page_id: pageValue.page_id, revision_id: pageValue.revision_id, slug: pageValue.slug, source_sha256: sha256(Q1034_SAVED_SOURCES[role]) };
    Object.assign(q1034.forum_read_fixture, { primary_category_id: 9000101, pagination_category_id: 9000102, missing_category_id: 99990101, visible_thread_id: 9100101, comments_thread_id: 9100122, missing_thread_id: 99990102, category_route_name: "visible-category", thread_route_name: "visible-thread" });
    await fs.writeFile(q1034Path, `${JSON.stringify(q1034, null, 2)}\n`, { mode: 0o600 });

    for (const name of ["q1035-r23.json", "q1035-r23-admin.json"]) {
      const target = path.join(args["output-private-dir"], name);
      const value = JSON.parse(await fs.readFile(target, "utf8"));
      value.sitechanges_listdrafts_fixture = { site_id: SITE_ID, pages: { sitechanges_holder: { page_id: q1035Site.page_id, revision_id: q1035Latest.revision_id, slug: q1035Site.slug, source_sha256: sha256(Q1035_SAVED_SOURCES.sitechanges_holder) }, listdrafts_holder: { page_id: q1035Draft.page_id, revision_id: q1035Draft.revision_id, slug: q1035Draft.slug, source_sha256: sha256(Q1035_SAVED_SOURCES.listdrafts_holder) } }, row_markers: Array.from({ length: 2105 }, (_, index) => `(rev. ${2105 - index})`), forbidden_markers: ["Private high", "privateq809"], public_title: "Q1035 Public Activity", source_comment: "Q1035_SOURCE_COMMENT", file_comment: "Q1035_FILE_COMMENT", private_host_page_id: q809Private.page_id };
      await fs.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    }

    const mediaAudit = JSON.parse(await fs.readFile(new URL("../../../../docs/development/open43-m-closure-audit.json", import.meta.url), "utf8"));
    const mediaCaseIds = mediaAudit.issues
      .filter(({ issue }) => [756, 776, 806, 1039, 1043, 1062].includes(issue))
      .flatMap(({ subrows }) => subrows)
      .filter(({ classification, next_command_ids }) => classification === "candidate_required" && next_command_ids.includes("C_MEDIA_BROWSER_CANDIDATE"))
      .map(({ case_id }) => case_id);
    if (JSON.stringify(mediaCaseIds) !== JSON.stringify(Object.keys(MEDIA_BROWSER_EVIDENCE))) throw new Error("media browser audit denominator drifted during private input production");
    const mediaInput = structuredClone(general);
    mediaInput.media_browser = {
      cases: mediaCaseIds.map((caseId) => {
        const evidenceId = MEDIA_BROWSER_EVIDENCE[caseId];
        const evidence = mediaAudit.evidence_registry?.[evidenceId];
        if (typeof evidence?.path !== "string" || !/^[0-9a-f]{64}$/u.test(evidence.sha256 ?? "")) throw new Error(`${caseId} media browser evidence is absent from the audit registry`);
        return { case_id: caseId, evidence: { evidence_id: evidenceId, path: evidence.path, sha256: evidence.sha256 } };
      }),
    };
    const mediaPath = path.join(args["output-private-dir"], "media-browser.json");
    await fs.writeFile(mediaPath, `${JSON.stringify(mediaInput, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    privateFiles.push("media-browser.json");

    const temporalContractPath = new URL("../fixtures/framerail-route-action-browser/run-contract.json", import.meta.url);
    const temporalContract = JSON.parse(await fs.readFile(temporalContractPath, "utf8"));
    if (temporalContract?.issue !== 1372 || !Array.isArray(temporalContract.subjects) || temporalContract.subjects.length !== 14) throw new Error("route-action temporal run contract denominator drifted");
    const candidateOrigin = bindings.public.candidate_origin;
    const temporalUrls = {
      denial: {
        missing_page: new URL("/privateq809:route-action-denied-missing", candidateOrigin).href,
        saved_page: new URL(`/${q809Private.slug}`, candidateOrigin).href,
      },
      failure: {
        missing_page: new URL("/route-action-missing", candidateOrigin).href,
        saved_page: new URL(`/${redirectTarget.slug}`, candidateOrigin).href,
      },
      success: {
        missing_page: new URL("/route-action-missing", candidateOrigin).href,
        saved_page: new URL(`/${redirectTarget.slug}`, candidateOrigin).href,
      },
    };
    for (const slug of ["privateq809:route-action-denied-missing", "route-action-missing"]) {
      if (await rpc("page_get", { site_id: SITE_ID, page: slug, details: { wikitext: false, compiled: false } }, { siteId: SITE_ID }) !== null) throw new Error(`route-action missing-page namespace already exists: ${slug}`);
    }
    const temporalUrlsSha256 = captureUrlsSha256(temporalUrls);
    const finalTrigger = (subject) => subject.trigger_selectors.at(-1);
    const denialOracles = Object.fromEntries(temporalContract.subjects.map((subject) => [subject.id, {
      type: "dom",
      predicate: { selector: finalTrigger(subject), state: "absent" },
      activation: "none",
    }]));
    const failureOracles = Object.fromEntries(temporalContract.subjects.map((subject) => {
      if (subject.id === "control:create") return [subject.id, {
        type: "event",
        event: { kind: "request", method: "GET", url_suffix: "/edit/true" },
        failure_control: { kind: "abort_request", request: { resource_type: "document", method: "GET", url_suffix: "/edit/true" } },
      }];
      if (subject.id === "control:restore") return [subject.id, {
        type: "event",
        event: { kind: "request", method: "POST", url_suffix: "?/deletedGet" },
        failure_control: { kind: "abort_request", request: { method: "POST", url_suffix: "?/deletedGet" } },
      }];
      return [subject.id, {
        type: "dom",
        predicate: { selector: ".pane-loading", state: "visible" },
        failure_control: { kind: "abort_request", request: { resource_type: "script" } },
      }];
    }));
    const temporalFixturePath = path.join(args["output-private-dir"], "framerail-route-action-fixture.json");
    const temporalFailurePath = path.join(args["output-private-dir"], "framerail-route-action-failure-control.json");
    const temporalRuntimePath = path.join(args["output-private-dir"], "framerail-route-action-runtime.json");
    const temporalDenialStatePath = path.join(args["output-private-dir"], "framerail-route-action-denial-storage.json");
    const temporalFailureStatePath = path.join(args["output-private-dir"], "framerail-route-action-failure-storage.json");
    const temporalSuccessStatePath = path.join(args["output-private-dir"], "framerail-route-action-success-storage.json");
    const temporalFixture = {
      schema: "wikijump.framerail_route_action_fixture_identity.v1",
      evidence_registry: temporalContract.evidence_registry,
      urls: temporalUrls,
      urls_sha256: temporalUrlsSha256,
      fixtures: {
        denial_private_page: { page_id: q809Private.page_id, slug: q809Private.slug, category_id: privateCategory },
        saved_imported_page: { page_id: redirectTarget.page_id, revision_id: redirectTarget.revision_id, slug: redirectTarget.slug },
        failure_missing_slug: "route-action-missing",
        denial_missing_slug: "privateq809:route-action-denied-missing",
      },
      run_owned_fixture: { restored: [], removed: [] },
    };
    const temporalFailureControl = {
      schema: "wikijump.framerail_route_action_failure_control_identity.v1",
      evidence_registry: temporalContract.evidence_registry,
      urls_sha256: temporalUrlsSha256,
      result_oracles: { denial: denialOracles, failure: failureOracles },
    };
    const temporalRuntime = {
      schema: "wikijump.framerail_route_action_runtime_identity.v1",
      wikijump_commit: candidate.wikijump_commit,
      wikijump_tree: candidate.wikijump_tree,
      ftml_sha: candidate.ftml_sha,
      candidate_identity_sha256: identitySha256,
      runtime_bindings: bindings.runtime,
    };
    const storageState = (token) => ({ cookies: [{ name: "wikijump_token", value: token, url: candidateOrigin, httpOnly: true, secure: true, sameSite: "Lax" }], origins: [] });
    await Promise.all([
      fs.writeFile(temporalFixturePath, `${JSON.stringify(temporalFixture, null, 2)}\n`, { mode: 0o600, flag: "wx" }),
      fs.writeFile(temporalFailurePath, `${JSON.stringify(temporalFailureControl, null, 2)}\n`, { mode: 0o600, flag: "wx" }),
      fs.writeFile(temporalRuntimePath, `${JSON.stringify(temporalRuntime, null, 2)}\n`, { mode: 0o600, flag: "wx" }),
      fs.writeFile(temporalDenialStatePath, `${JSON.stringify(storageState(tokens.other.token), null, 2)}\n`, { mode: 0o600, flag: "wx" }),
      fs.writeFile(temporalFailureStatePath, `${JSON.stringify(storageState(tokens.editor.token), null, 2)}\n`, { mode: 0o600, flag: "wx" }),
      fs.writeFile(temporalSuccessStatePath, `${JSON.stringify(storageState(tokens.editor.token), null, 2)}\n`, { mode: 0o600, flag: "wx" }),
    ]);
    const browserRoot = defaultBrowserRoot();
    const { chromium } = loadPlaywright(browserRoot);
    const browserExecutable = path.resolve(chromium.executablePath());
    const browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const browserVersion = browser.version();
    await browser.close();
    const temporalInput = structuredClone(general);
    temporalInput.temporal_capture = {
      browser_root: browserRoot,
      browser_executable: browserExecutable,
      browser_identity: { sha256: await sha256File(browserExecutable), version: browserVersion },
      fixture_identity: temporalFixturePath,
      fixture_identity_sha256: await sha256File(temporalFixturePath),
      failure_control_identity: temporalFailurePath,
      failure_control_identity_sha256: await sha256File(temporalFailurePath),
      runtime_identity: temporalRuntimePath,
      runtime_identity_sha256: await sha256File(temporalRuntimePath),
      actor_classes: { denial: "denied", failure: "permitted", success: "permitted" },
      storage_states: { denial: temporalDenialStatePath, failure: temporalFailureStatePath, success: temporalSuccessStatePath },
      urls: temporalUrls,
      runtime_bindings: bindings.runtime,
      timeout_ms: 30_000,
      ignore_https_errors: true,
    };
    const temporalInputPath = path.join(args["output-private-dir"], "framerail-route-action-browser.json");
    await fs.writeFile(temporalInputPath, `${JSON.stringify(temporalInput, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    privateFiles.push("framerail-route-action-browser.json");

    await fs.writeFile(generalPath, `${JSON.stringify(general, null, 2)}\n`, { mode: 0o600 });
    await propagateActors();
    execFileSync("docker", ["exec", cache, "redis-cli", "FLUSHALL"], { stdio: "ignore" });
    const receipt = { schema: COMPATIBILITY_CANDIDATE_INPUT_RECEIPT_SCHEMA, status: "pass", generated_at: new Date().toISOString(), candidate: { wikijump_commit: candidate.wikijump_commit, wikijump_tree: candidate.wikijump_tree, ftml_sha: candidate.ftml_sha, compose_project: project, editable_identity_sha256: identitySha256 }, output_private_dir: args["output-private-dir"], private_files: privateFiles, fixture_counts: { members: 151, q1034_pagination_threads: 221, q1034_page_comment_posts: 24, q778_posts: 5, q1035_public_revisions: 2105 }, fixtures: { a1037_redirect_source: redirectSource.page_id, q1032_members: members.page_id, q1036_saved: q1036.page_id, q1026_identity: q1026Page.page_id, q810_saved: featured.page_id, q778_saved: forumMini.page_id, q809_private: q809Private.page_id, q1035_sitechanges: q1035Site.page_id } };
    const publication = await sealJsonNoReplace(args.receipt, receipt);
    if (publication.publication !== "created") throw new Error(`candidate input receipt already exists: ${args.receipt}`);
    return { receipt: { path: args.receipt, sha256: publication.sha256 }, private_dir: args["output-private-dir"] };
  } finally {
    await fs.rm(caPath, { force: true });
  }
}

export async function prepareCompatibilityCandidateInputsMain(argv = process.argv.slice(2)) {
  const args = parseCompatibilityCandidateInputArgs(argv);
  if (args.help) return void process.stdout.write(`${usage()}\n`);
  process.stdout.write(`${JSON.stringify(await prepareCompatibilityCandidateInputs(args))}\n`);
}
