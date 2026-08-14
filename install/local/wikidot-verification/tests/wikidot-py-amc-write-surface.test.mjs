import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..")
const wikidotPyRoot = path.resolve(repositoryRoot, "../wikidot.py")
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
  assert.equal(value.authenticated_behavior_gaps, undefined)
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
