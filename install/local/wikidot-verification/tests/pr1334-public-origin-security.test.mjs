import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { spawnSync } from "node:child_process"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const scriptPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../scripts/capture-pr1334-q1040-q811-q809-page-query-v2-20260810-b.py")

test("page-query capture rejects untrusted origins and redirects before any live request", async () => {
  const source = await readFile(scriptPath, "utf8")
  const program = String.raw`
import ast, ipaddress, socket, sys, types, urllib.error, urllib.parse, urllib.request

tree = ast.parse(open(sys.argv[1], encoding="utf-8").read())
wanted = [node for node in tree.body if isinstance(node, (ast.Assign, ast.ClassDef, ast.FunctionDef)) and (getattr(node, "name", None) in {"RefuseRedirectHandler", "validate_public_origin"} or any(isinstance(target, ast.Name) and target.id == "EXPECTED_PUBLIC_ORIGIN" for target in getattr(node, "targets", [])))]
namespace = {"Any": object, "ipaddress": ipaddress, "socket": types.SimpleNamespace(SOCK_STREAM=socket.SOCK_STREAM, getaddrinfo=lambda *args, **kwargs: [(None, None, None, None, ("93.184.216.34", 0))]), "urllib": __import__("urllib")} 
namespace["urllib"].parse = urllib.parse
namespace["urllib"].request = urllib.request
namespace["urllib"].error = urllib.error
exec(compile(ast.Module(body=wanted, type_ignores=[]), sys.argv[1], "exec"), namespace)
validate = namespace["validate_public_origin"]
assert validate("http://sandbox-for-codex.wikidot.com") == "http://sandbox-for-codex.wikidot.com"
for value in ("https://attacker.example", "http://127.0.0.1", "http://sandbox-for-codex.wikidot.com@127.0.0.1", "http://sandbox-for-codex.wikidot.com/private"):
    try:
        validate(value)
    except SystemExit:
        pass
    else:
        raise AssertionError(value)
namespace["socket"] = types.SimpleNamespace(SOCK_STREAM=socket.SOCK_STREAM, getaddrinfo=lambda *args, **kwargs: [(None, None, None, None, ("127.0.0.1", 0))])
try:
    validate("http://sandbox-for-codex.wikidot.com")
except SystemExit:
    pass
else:
    raise AssertionError("private DNS result accepted")
handler = namespace["RefuseRedirectHandler"]()
try:
    handler.redirect_request(types.SimpleNamespace(full_url="http://sandbox-for-codex.wikidot.com/a"), None, 302, "Found", {}, "http://attacker.example")
except urllib.error.HTTPError as error:
    assert error.code == 302
else:
    raise AssertionError("redirect accepted")
`
  const result = spawnSync("python3", ["-c", program, scriptPath], {encoding: "utf8"})
  assert.equal(result.status, 0, result.stderr)
  assert.match(source, /urllib\.request\.ProxyHandler\(\{\}\)/u)
  assert.doesNotMatch(source, /urllib\.request\.urlopen\(/u)
})
