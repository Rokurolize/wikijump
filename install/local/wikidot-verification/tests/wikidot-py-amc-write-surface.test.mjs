import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const wikidotPyRoot = process.env.WIKIDOT_PY_CHECKOUT ?? path.resolve(repositoryRoot, "../wikidot.py")
const contractPath = path.join(repositoryRoot, "docs/development/wikidot-py-amc-write-surface.json")
const authorityPath = path.join(repositoryRoot, "docs/development/wikidot-py-amc-client-parity.json")
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"))
const authority = JSON.parse(fs.readFileSync(authorityPath, "utf8"))
const GIT_EXECUTABLE = "/usr/bin/git"
const PYTHON_EXECUTABLE = "/usr/bin/python3"
const EXECUTION_ENVIRONMENT = Object.freeze({
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_LAZY_FETCH: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  LANG: "C",
  LC_ALL: "C",
  PATH: "/usr/bin:/bin"
})

const pythonScanner = String.raw`
import ast, json, subprocess, sys

request = json.load(sys.stdin)
functions = {}
module_dicts = []
conditional_lock_fields = []
git_environment = {
    "GIT_CONFIG_GLOBAL": "/dev/null",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_NO_LAZY_FETCH": "1",
    "GIT_NO_REPLACE_OBJECTS": "1",
    "GIT_OPTIONAL_LOCKS": "0",
    "GIT_PAGER": "cat",
    "GIT_TERMINAL_PROMPT": "0",
    "LANG": "C",
    "LC_ALL": "C",
    "PATH": "/usr/bin:/bin",
}

for path in request["paths"]:
    source = subprocess.run(
        ["/usr/bin/git", "-C", request["root"], "show", request["commit"] + ":" + path],
        check=True, capture_output=True, env=git_environment, text=True,
    ).stdout
    tree = ast.parse(source)
    for owner in tree.body:
        if not isinstance(owner, ast.ClassDef):
            continue
        for node in owner.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            suffix = ".setter" if any(
                isinstance(decorator, ast.Attribute) and decorator.attr == "setter"
                for decorator in node.decorator_list
            ) else ""
            functions[f"{owner.name}.{node.name}{suffix}"] = (owner.name, node)
            functions.setdefault(f"{owner.name}.{node.name}", (owner.name, node))
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            values = {
                key.value: value for key, value in zip(node.keys, node.values)
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
            module = values.get("moduleName")
            if isinstance(module, ast.Constant) and module.value == "edit/PageEditModule":
                module_dicts.append(sorted(values))
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Subscript)
            and isinstance(target.value, ast.Name)
            and target.value.id == "page_lock_request_body"
            and isinstance(target.slice, ast.Constant)
            and target.slice.value == "force_lock"
            for target in node.targets
        ):
            conditional_lock_fields.append("force_lock")

def literal(node, environment):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Name):
        return environment.get(node.id)
    return None

def scan(owner, function, environment=None, seen=None):
    environment = dict(environment or {})
    seen = set(seen or ())
    key = (owner, function.name, tuple(sorted(environment.items())))
    if key in seen:
        return []
    seen.add(key)
    for node in function.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            value = literal(node.value, environment)
            if value is not None:
                environment[node.targets[0].id] = value
    results = []
    for node in ast.walk(function):
        if isinstance(node, ast.Dict):
            values = {
                key.value: value for key, value in zip(node.keys, node.values)
                if isinstance(key, ast.Constant) and isinstance(key.value, str)
            }
            action = literal(values.get("action"), environment)
            event = literal(values.get("event"), environment)
            variant = literal(values.get("type"), environment)
            if isinstance(action, str) and isinstance(event, str):
                results.append({"action": action, "event": event, "application_type": variant})
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute) or not node.func.attr.startswith("_"):
            continue
        helper = functions.get(f"{owner}.{node.func.attr}")
        if helper is None:
            continue
        helper_owner, helper_function = helper
        parameters = [argument.arg for argument in helper_function.args.args if argument.arg not in ("self", "cls")]
        bindings = {
            parameter: literal(argument, environment)
            for parameter, argument in zip(parameters, node.args)
            if literal(argument, environment) is not None
        }
        results.extend(scan(helper_owner, helper_function, bindings, seen))
    return results

operations = {}
for reference, (owner, function) in functions.items():
    if reference.endswith(".setter") or not function.name.startswith("_"):
        records = scan(owner, function)
        if records:
            operations[reference] = records

json.dump({
    "conditional_lock_fields": conditional_lock_fields,
    "lock_shapes": module_dicts,
    "operations": operations,
    "references": sorted(functions),
}, sys.stdout, sort_keys=True)
`

function git(...args) {
  const result = spawnSync(GIT_EXECUTABLE, ["-C", wikidotPyRoot, ...args], {
    cwd: "/",
    encoding: "utf8",
    env: EXECUTION_ENVIRONMENT
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout.trim()
}

function gitBytes(...args) {
  const result = spawnSync(GIT_EXECUTABLE, ["-C", wikidotPyRoot, ...args], {
    cwd: "/",
    env: EXECUTION_ENVIRONMENT
  })
  assert.equal(result.status, 0, result.stderr.toString())
  return result.stdout
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex")
}

function scanSource(value) {
  const result = spawnSync(PYTHON_EXECUTABLE, ["-c", pythonScanner], {
    cwd: "/",
    encoding: "utf8",
    env: EXECUTION_ENVIRONMENT,
    input: JSON.stringify({
      root: wikidotPyRoot,
      commit: value.source.commit,
      paths: value.source.objects.map(({ path: sourcePath }) => sourcePath)
    })
  })
  assert.equal(result.status, 0, result.stderr)
  return JSON.parse(result.stdout)
}

function verifyContract(value, source) {
  assert.equal(value.schema, "wikijump.wikidot_py_amc_write_surface.v1")
  assert.equal(value.source.repository, authority.source.repository)
  assert.equal(value.source.commit, authority.source.commit)
  assert.equal(value.source.revision_authority, "docs/development/wikidot-py-amc-client-parity.json#source")
  assert.equal(git("rev-parse", "HEAD"), value.source.commit)
  for (const object of value.source.objects) {
    assert.equal(object.type, "blob")
    assert.equal(git("rev-parse", `${value.source.commit}:${object.path}`), object.oid)
  }
  assert.equal(new Set(value.source.objects.map(({ path: sourcePath }) => sourcePath)).size, value.source.objects.length)

  const verifyReference = reference => {
    const [sourcePath, symbol] = reference.split("#")
    assert.ok(value.source.objects.some(object => object.path === sourcePath), reference)
    assert.ok(source.references.includes(symbol), reference)
  }

  assert.equal(value.page_edit_lock_shapes.length, 1)
  assert.deepEqual(value.page_edit_lock_shapes[0], {
    module_name: "edit/PageEditModule",
    required_fields: ["mode", "moduleName", "wiki_page"],
    conditional_fields: ["force_lock"],
    source_reference: "src/wikidot/module/page.py#Page.create_or_edit"
  })
  assert.deepEqual(source.lock_shapes, [["mode", "moduleName", "wiki_page"]])
  assert.deepEqual(source.conditional_lock_fields, ["force_lock"])
  verifyReference(value.page_edit_lock_shapes[0].source_reference)

  const pairIds = value.action_event_pairs.map(({ action, event }) => `${action};${event}`)
  assert.equal(pairIds.length, 21)
  assert.equal(new Set(pairIds).size, pairIds.length)
  for (const pair of value.action_event_pairs) verifyReference(pair.source_reference)

  const bindingIds = value.public_operation_bindings.map(({ operation_id }) => operation_id)
  assert.equal(bindingIds.length, 22)
  assert.equal(new Set(bindingIds).size, bindingIds.length)
  assert.deepEqual([...bindingIds].sort(), Object.keys(source.operations).sort())
  for (const binding of value.public_operation_bindings) {
    verifyReference(binding.source_reference)
    assert.equal(binding.source_reference.split("#")[1], binding.operation_id)
    assert.ok(source.operations[binding.operation_id])
    assert.deepEqual(
      [...binding.action_event_ids].sort(),
      [...new Set(source.operations[binding.operation_id].map(({ action, event }) => `${action};${event}`))].sort()
    )
    for (const pairId of binding.action_event_ids) assert.ok(pairIds.includes(pairId))
  }

  const extractedPairs = new Set(Object.values(source.operations).flat().map(({ action, event }) => `${action};${event}`))
  assert.deepEqual([...pairIds].sort(), [...extractedPairs].sort())

  const applicationBindings = value.public_operation_bindings.filter(({ application_type }) => application_type)
  assert.deepEqual(applicationBindings.map(({ application_type }) => application_type).sort(), ["accept", "decline"])
  for (const binding of applicationBindings) {
    assert.deepEqual(
      [...new Set(source.operations[binding.operation_id].map(({ application_type }) => application_type))],
      [binding.application_type]
    )
  }
  verifyBehaviorEvidence(value)
  assert.equal(value.authenticated_behavior_gaps, undefined)
}

function verifyBehaviorEvidence(value) {
  const evidence = value.authenticated_behavior_evidence
  const pairIds = value.action_event_pairs.map(({ action, event }) => `${action};${event}`)
  const sha256Pattern = /^[0-9a-f]{64}$/u
  assert.equal(evidence.schema, "wikijump.wikidot_py_amc_write_evidence.v1")
  assert.equal(evidence.current_source_commit, value.source.commit)
  assert.equal(evidence.client.repository, value.source.repository)
  assert.equal(evidence.client.commit, value.source.commit)
  assert.equal(evidence.client.tree, authority.source.root_tree)
  assert.equal(evidence.client.uv_lock_sha256, sha256(gitBytes("show", `${value.source.commit}:uv.lock`)))
  assert.deepEqual(evidence.server, {
    site: "sandbox-for-codex",
    site_id: 5301522,
    ssl_supported: false,
    login_endpoint: "https://www.wikidot.com/default--flow/login__LoginPopupScreen"
  })
  assert.deepEqual(Object.keys(evidence.hash_labels).sort(), ["page_edit_lifecycle", "request_hash.scope", "response.body_sha256", "response.sha256"])

  const actorLabels = evidence.actors.map(({ label }) => label)
  assert.deepEqual(actorLabels, ["A", "B"])
  assert.equal(new Set(evidence.actors.map(({ user_id }) => user_id)).size, evidence.actors.length)
  const runIds = evidence.runs.map(({ run_id }) => run_id)
  assert.equal(new Set(runIds).size, runIds.length)
  for (const run of evidence.runs) {
    assert.ok(run.actors.every(actor => actorLabels.includes(actor)))
    assert.ok(run.page_ids.every(Number.isInteger))
    assert.ok(run.page_names.every(name => typeof name === "string" && name.length > 0))
    if (run.page_names.length > 0) assert.equal(run.cleanup.anonymous_absence_verified, true)
    else assert.equal(run.cleanup.session_cookie_absent, true)
  }

  const evidenceIds = evidence.pair_evidence.map(({ pair_id }) => pair_id)
  assert.equal(evidenceIds.length, pairIds.length)
  assert.equal(new Set(evidenceIds).size, evidenceIds.length)
  assert.deepEqual([...evidenceIds].sort(), [...pairIds].sort())
  const counts = { positive: 0, observed_not_ok: 0, blocked: 0 }
  for (const row of evidence.pair_evidence) {
    assert.ok(Object.hasOwn(counts, row.classification), row.pair_id)
    counts[row.classification]++
    if (row.classification === "blocked") {
      assert.equal(row.request_sent, false)
      assert.ok(typeof row.reason === "string" && row.reason.length > 0)
      for (const forbidden of ["run_id", "request_hash", "response", "readback"]) assert.equal(row[forbidden], undefined)
      continue
    }
    assert.ok(runIds.includes(row.run_id), row.pair_id)
    assert.ok(["exact_canonical_json", "sanitized_canonical_json"].includes(row.request_hash.scope))
    assert.match(row.request_hash.sha256, sha256Pattern)
    assert.ok(row.readback && Object.keys(row.readback).length > 0)
    if (row.request_hash.scope === "sanitized_canonical_json") assert.equal(row.pair_id, "Login2Action;login")
    if (row.classification === "positive") {
      assert.equal(row.response.status, "ok")
    } else {
      assert.equal(row.request_hash.scope, "exact_canonical_json")
      assert.equal(row.response.status, "not_ok")
      assert.equal(row.readback.unchanged, true)
      assert.ok(typeof row.reason === "string" && row.reason.length > 0)
    }
  }
  assert.deepEqual(counts, evidence.classification_counts)

  assert.ok(runIds.includes(evidence.page_edit_lifecycle.run_id))
  assert.deepEqual(evidence.page_edit_lifecycle.steps.map(({ name }) => name), ["initial_lock", "contention", "force_lock", "post_save_lock"])
  for (const step of evidence.page_edit_lifecycle.steps) {
    assert.match(step.request_sha256, sha256Pattern)
    assert.match(step.response_sha256, sha256Pattern)
    assert.equal(step.status, "ok")
  }
  assert.deepEqual(evidence.non_counting_observations.map(({ pair_id }) => pair_id), ["WikiPageAction;setParentPage"])
  assert.equal(evidence.non_counting_observations[0].counts_as_positive, false)
  assert.ok(evidence.non_counting_observations[0].readback.parent_was_still)

  const forbiddenSecretKeys = new Set(["username", "password", "cookie", "cookies", "lock_secret", "wikidot_token7"])
  const inspect = object => {
    if (Array.isArray(object)) return object.forEach(inspect)
    if (object === null || typeof object !== "object") return
    for (const [key, item] of Object.entries(object)) {
      assert.equal(forbiddenSecretKeys.has(key), false, key)
      inspect(item)
    }
  }
  inspect(evidence)
}

const source = scanSource(contract)

test("wikidot.py AMC write contract exactly matches its pinned source", () => {
  verifyContract(contract, source)
})

test("wikidot.py AMC write verifier ignores poisoned process execution state", () => {
  const originalPath = process.env.PATH
  const originalGitDirectory = process.env.GIT_DIR
  process.env.PATH = "/poisoned"
  process.env.GIT_DIR = "/poisoned"
  try {
    verifyContract(contract, scanSource(contract))
  } finally {
    if (originalPath === undefined) delete process.env.PATH
    else process.env.PATH = originalPath
    if (originalGitDirectory === undefined) delete process.env.GIT_DIR
    else process.env.GIT_DIR = originalGitDirectory
  }
})

test("wikidot.py AMC write contract rejects incomplete or ambiguous inventories", () => {
  for (const mutate of [
    value => value.page_edit_lock_shapes.pop(),
    value => value.page_edit_lock_shapes.push(value.page_edit_lock_shapes[0]),
    value => value.action_event_pairs.pop(),
    value => value.action_event_pairs.push(value.action_event_pairs[0]),
    value => value.public_operation_bindings.pop(),
    value => value.public_operation_bindings.push(value.public_operation_bindings[0]),
    value => { value.public_operation_bindings.find(binding => binding.application_type).application_type = "review" }
  ]) {
    const invalid = structuredClone(contract)
    mutate(invalid)
    assert.throws(() => verifyContract(invalid, source))
  }
})

test("wikidot.py AMC write evidence rejects incomplete, stale, unknown, or misclassified rows", () => {
  for (const mutate of [
    value => value.authenticated_behavior_evidence.pair_evidence.pop(),
    value => value.authenticated_behavior_evidence.pair_evidence.push(value.authenticated_behavior_evidence.pair_evidence[0]),
    value => { value.authenticated_behavior_evidence.pair_evidence[0].pair_id = "UnknownAction;unknown" },
    value => { value.authenticated_behavior_evidence.pair_evidence.find(row => row.classification === "positive").classification = "blocked" },
    value => { value.authenticated_behavior_evidence.current_source_commit = "0000000000000000000000000000000000000000" },
    value => { value.authenticated_behavior_evidence.non_counting_observations[0].counts_as_positive = true }
  ]) {
    const invalid = structuredClone(contract)
    mutate(invalid)
    assert.throws(() => verifyContract(invalid, source))
  }
})
