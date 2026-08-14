import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const toolRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const repositoryRoot = path.resolve(toolRoot, "../../..")
const cliPath = path.join(toolRoot, "scripts/build-wws-route-registration-denominator.mjs")

const expectedRegistrations = [
  ["ANY", "/-/basic-error/{error_code}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/-/code/{page_slug}/{index}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/-/download/{page_slug}/{filename}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/-/file/{page_slug}/{filename}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/-/files/{page_slug}/{filename}", "handle_file_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/-/health-check", "handle_health_check", "wws/src/handler/misc.rs"],
  ["ANY", "/-/html/{page_slug}/{id}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/.well-known", "handle_well_known", "wws/src/handler/well_known.rs"],
  ["ANY", "/.well-known/{*path}", "handle_well_known", "wws/src/handler/well_known.rs"],
  ["ANY", "/local--code/{page_slug}/{index}", "handle_code_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/local--files/{page_slug}/{filename}", "handle_local_file", "wws/src/handler/file.rs"],
  ["ANY", "/local--html/{page_slug}/{id}", "handle_html_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/local--resized-images/{page_slug}/{filename}/{variant}", "handle_invalid_method", "wws/src/handler/misc.rs"],
  ["ANY", "/{page_slug}/code/{filename}", "handle_code_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/{page_slug}/download/{filename}", "handle_download_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/{page_slug}/file/{filename}", "handle_file_redirect", "wws/src/handler/redirect.rs"],
  ["ANY", "/{page_slug}/html/{filename}", "handle_html_redirect", "wws/src/handler/redirect.rs"],
  ["GET", "/-/basic-error/{error_code}", "handle_basic_error", "wws/src/handler/basic_error.rs"],
  ["GET", "/-/code/{page_slug}/{index}", "handle_code_block", "wws/src/handler/text_block.rs"],
  ["GET", "/-/download/{page_slug}/{filename}", "handle_file_download", "wws/src/handler/file.rs"],
  ["GET", "/-/file/{page_slug}/{filename}", "handle_file_fetch", "wws/src/handler/file.rs"],
  ["GET", "/-/html/{page_slug}/{id}", "handle_html_block", "wws/src/handler/text_block.rs"],
  ["GET", "/common--javascript/html-block-iframe.js", "handle_html_block_iframe_js", "wws/src/handler/misc.rs"],
  ["GET", "/common--javascript/resize-iframe.html", "handle_resize_iframe_html", "wws/src/handler/misc.rs"],
  ["GET", "/common--javascript/{*path}", "handle_common_javascript", "wws/src/handler/misc.rs"],
  ["GET", "/common--theme/base/css/html-block.css", "handle_html_block_css", "wws/src/handler/misc.rs"],
  ["GET", "/common--theme/{*path}", "handle_common_theme", "wws/src/handler/misc.rs"],
  ["GET", "/local--resized-images/{page_slug}/{filename}/{variant}", "handle_resized_image", "wws/src/handler/resized_image.rs"],
  ["GET", "/robots.txt", "handle_robots_txt", "wws/src/handler/robots.rs"],
  ["GET", "/{page_slug}/code", "handle_default_code_redirect", "wws/src/handler/redirect.rs"]
]

function runCli(root, output) {
  return spawnSync(process.execPath, [cliPath, "--root", root, "--output", output], {
    encoding: "utf8"
  })
}

function git(root, ...arguments_) {
  const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

async function sha256(filePath) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex")
}

async function writeRouteSource(root, source) {
  const target = path.join(root, "wws/src/route.rs")
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, source)
}

function runGit(root, ...arguments_) {
  const result = spawnSync("git", ["-C", root, ...arguments_], { encoding: "utf8" })
  assert.equal(result.status, 0, result.stderr)
}

test("CLI writes the exact current 30-registration WWS denominator with source ownership", async (t) => {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "wws-route-denominator-"))
  t.after(() => fs.rm(temporaryDirectory, { recursive: true, force: true }))
  const output = path.join(temporaryDirectory, "denominator.json")

  const result = runCli(repositoryRoot, output)

  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, `wrote 30 WWS route registrations to ${output}\n`)
  const manifest = JSON.parse(await fs.readFile(output, "utf8"))
  assert.equal(manifest.schema, "wikijump.wws_route_registration_denominator.v1")
  assert.deepEqual(manifest.historical_artifact, {
    path: "install/local/wikidot-verification/artifacts/pr1334-wws-route-attribution-no-thumbnails-20260810.json",
    sha256: "356c8b5b3ee063a92e8dac266bd8e0aa32b221ff4e0e2a7d660001da04c0478d",
    fixture_path: "install/local/wikidot-verification/fixtures/pr1334-wws-route-attribution-no-thumbnails.json",
    fixture_sha256: "c5a21d7c1b5bc3af42d325b8bb68e67c78f0dd1cfdc8624e8df884a7110642c2",
    registration_count: 27,
    status: "historical_27_route_source_attribution_preserved"
  })
  assert.equal(manifest.source.repository_commit, git(repositoryRoot, "rev-parse", "HEAD"))
  assert.equal(manifest.source.repository_tree, git(repositoryRoot, "rev-parse", "HEAD^{tree}"))
  assert.deepEqual(manifest.counts, {
    registrations: 30,
    by_declared_method_class: { ANY: 17, GET: 13 },
    primary_handler_owners: 30,
    fallback_handler_owners: 1,
    handler_owner_bindings: 31,
    duplicate_registration_ids: 0
  })
  assert.deepEqual(
    manifest.registrations.map((registration) => [
      registration.declared_method_class,
      registration.path,
      registration.registered_handler_symbol,
      registration.handler_definition_path
    ]),
    expectedRegistrations
  )
  assert.equal(new Set(manifest.registrations.map(({ registration_id }) => registration_id)).size, 30)
  assert.deepEqual(
    manifest.registrations
      .filter(({ fallback_handler_symbol: symbol }) => symbol !== null)
      .map(({ registration_id, fallback_handler_symbol: symbol }) => [registration_id, symbol]),
    [["wws-route-registration:GET:/{page_slug}/code", "redirect_to_main"]]
  )
  for (const input of manifest.source.inputs) {
    assert.equal(input.sha256, await sha256(path.join(repositoryRoot, input.path)))
  }
  for (const registration of manifest.registrations) {
    assert.ok(registration.route_registration_reference.startsWith("wws/src/route.rs#L"))
    assert.ok(registration.handler_definition_reference.startsWith(`${registration.handler_definition_path}#L`))
  }
})

test("CLI rejects duplicate registrations with equivalent reordered method filters", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wws-route-duplicate-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const filler = Array.from(
    { length: 28 },
    (_, index) => `.route("/filler-${index}", any(handle_filler_${index}))`
  ).join("\n")
  await writeRouteSource(
    root,
    `pub fn build_router() {
  Router::new()
    .route("/duplicate", on(MethodFilter::GET.or(MethodFilter::HEAD), handle_first).fallback(handle_fallback))
    .route("/duplicate", on(MethodFilter::HEAD.or(MethodFilter::GET), handle_second).fallback(handle_fallback))
    ${filler}
}
`
  )

  const result = runCli(root, path.join(root, "denominator.json"))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /duplicate WWS route registration ids/u)
  assert.equal(result.stdout, "")
})

test("CLI fails closed when another Axum router composition form is introduced", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "wws-route-unsupported-"))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.cp(path.join(repositoryRoot, "wws/src"), path.join(root, "wws/src"), { recursive: true })
  const routePath = path.join(root, "wws/src/route.rs")
  const routeSource = await fs.readFile(routePath, "utf8")
  await fs.writeFile(
    routePath,
    routeSource.replace(
      "        .fallback(redirect_to_main)\n        // Middleware",
      "        .fallback(redirect_to_main)\n        .route_service(\"/unsupported\", unsupported_service)\n        // Middleware"
    )
  )
  runGit(root, "init", "--quiet")
  runGit(root, "config", "user.email", "denominator-test@example.invalid")
  runGit(root, "config", "user.name", "Denominator Test")
  runGit(root, "add", "wws/src")
  runGit(root, "commit", "--quiet", "-m", "fixture")

  const result = runCli(root, path.join(root, "denominator.json"))

  assert.notEqual(result.status, 0)
  assert.match(result.stderr, /unsupported WWS router composition: route_service/u)
  assert.equal(result.stdout, "")
})
