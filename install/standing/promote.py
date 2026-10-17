#!/usr/bin/env python3
"""Promote the merged develop head to the standing runtime.

One command, in this order; each stage blocks the next and a failure leaves
standing as it was (or restores it):

1. identity     the checkout is clean and exactly the fetched origin/develop.
2. validation   every check group the change since standing selects has a
                passing `preflight.sh --final` receipt whose tree differs from
                this one only in paths that do not select that group; missing
                groups run now, alongside the build.
3. build        the three application images, from BuildKit caches.
4. render-ahead when the renderer generation changes, every saved page is
                rendered with the new image while the old one keeps serving.
5. rehearsal    when activation cannot be undone by restarting the old
                containers (new migrations or a new renderer generation), the
                new images start on a copy of standing's data and must pass
                the same freshness, HTTP and browser checks first.
6. activation   park the old containers, start the new ones, require health,
                zero stale saved pages, the HTTP canary and the standing
                browser parity; restore the parked containers on any failure.

The receipt records every stage's duration and result.
"""

from __future__ import annotations

import argparse
import concurrent.futures
from datetime import UTC, datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
import sys
import tempfile
import time

import refresh
import render_ahead
from volume_contract import PROTECTED_VOLUMES


SERVICES = refresh.SERVICES
VERIFICATION = Path("install/local/wikidot-verification")
STANDING_DATABASE = "wikijump-standing-database-1"
STANDING_CACHE = "wikijump-standing-cache-1"
STANDING_NAMESPACE = "wikijump-standing-caddy-1"
STANDING_FILES_VOLUME = "wikijump-standing-files-data"
RESOURCE_LIFETIME = timedelta(days=30)
REFRESH_RECEIPT_SCHEMA_VERSION = 4
PROMOTION_RECEIPT_SCHEMA = "wikijump.standing_promotion_receipt.v1"
VALIDATION_SCHEMA = "wikijump.consolidated_validation_receipt.v2"
BROWSER_REFERENCE_SCHEMA = "wikijump.standing_browser_reference.v1"
GROUPS = ("deepwell", "wws", "framerail", "locales", "workflow", "theme_lab", "verification")
GIT_OBJECT = re.compile(r"[0-9a-f]{40}")


def state_root() -> Path:
    return refresh.DEFAULT_RUNTIME_HOME.parent


def run(*args: str, cwd: Path | None = None, env: dict[str, str] | None = None) -> str:
    result = subprocess.run(
        args, cwd=cwd, env=env, check=True, text=True, capture_output=True
    )
    return result.stdout.strip()


def run_logged(args: list[str], log: Path, cwd: Path, env: dict[str, str] | None = None) -> str:
    """Run a step, keep its output in the evidence directory, and return
    stdout; a failure names the log."""
    with log.open("w", encoding="utf-8") as output:
        result = subprocess.run(
            args, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=output
        )
        output.write(result.stdout)
    if result.returncode != 0:
        raise RuntimeError(f"{Path(args[1]).name if len(args) > 1 else args[0]} failed; see {log}")
    return result.stdout


def last_json_line(stdout: str) -> dict[str, object]:
    for line in reversed(stdout.splitlines()):
        if line.startswith("{"):
            return json.loads(line)
    raise RuntimeError("step printed no JSON result")


class Stages:
    """Stage durations and results for the receipt."""

    def __init__(self) -> None:
        self.records: list[dict[str, object]] = []
        self.started = time.monotonic()

    def run(self, name: str, action):
        started = time.monotonic()
        record: dict[str, object] = {"stage": name}
        self.records.append(record)
        print(f"promote: {name} ...", file=sys.stderr, flush=True)
        try:
            result = action()
        except BaseException as error:
            record.update(status="fail", error=str(error))
            raise
        finally:
            record["duration_seconds"] = round(time.monotonic() - started, 3)
        record["status"] = "pass"
        if isinstance(result, dict):
            record["result"] = result
        print(
            f"promote: {name} {record['status']} in {record['duration_seconds']:.0f}s",
            file=sys.stderr,
            flush=True,
        )
        return result

    def elapsed(self) -> float:
        return time.monotonic() - self.started


# Validation coverage


def classify(source_root: Path, paths: list[str]) -> dict[str, bool]:
    """The check groups `scripts/preflight.sh` selects for these paths."""
    result = subprocess.run(
        ["node", ".github/scripts/classify-changes.mjs"],
        cwd=source_root,
        input="\0".join(paths),
        check=True,
        text=True,
        capture_output=True,
    )
    selected = dict(line.split("=", 1) for line in result.stdout.split())
    return {group: selected.get(group) == "true" for group in GROUPS}


def changed_paths(source_root: Path, before: str, after: str) -> list[str]:
    return run(
        "git", "diff", "--no-renames", "--name-only", before, after, cwd=source_root
    ).splitlines()


def validation_receipts(store: Path) -> list[tuple[Path, dict[str, object]]]:
    receipts = []
    for path in sorted(store.glob("*.json")) if store.is_dir() else []:
        try:
            receipt = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if (
            receipt.get("schema") == VALIDATION_SCHEMA
            and receipt.get("status") == "pass"
            and receipt.get("mode") == "final"
            and isinstance(receipt.get("wikijump_tree"), str)
            and GIT_OBJECT.fullmatch(receipt["wikijump_tree"])
            and receipt.get("checks")
            and all(check.get("status") == "ok" for check in receipt["checks"])
        ):
            receipts.append((path, receipt))
    return receipts


def validation_coverage(
    required: dict[str, bool],
    tree: str,
    receipts: list[tuple[Path, dict[str, object]]],
    delta_groups,
) -> tuple[dict[str, dict[str, str]], list[str]]:
    """For each required group, a passing receipt that ran it on a tree whose
    difference from `tree` does not select it. `delta_groups(other_tree)`
    classifies that difference."""
    covered: dict[str, dict[str, str]] = {}
    deltas: dict[str, dict[str, bool]] = {}
    for group in GROUPS:
        if not required.get(group):
            continue
        for path, receipt in receipts:
            if not receipt.get("groups", {}).get(group):
                continue
            other = receipt["wikijump_tree"]
            if other not in deltas:
                try:
                    deltas[other] = (
                        {name: False for name in GROUPS} if other == tree else delta_groups(other)
                    )
                except subprocess.CalledProcessError:
                    deltas[other] = {name: True for name in GROUPS}
            if not deltas[other][group]:
                covered[group] = {"receipt": str(path), "tree": other}
                break
    missing = [group for group in GROUPS if required.get(group) and group not in covered]
    return covered, missing


# Rehearsal


def rehearsal_reason(mode: str, migrations: list[str]) -> str | None:
    """Why activation must be rehearsed first, or None when a failed
    activation can be undone. New migrations cannot be: the old build's
    migration check refuses a schema it does not know, so the parked
    containers would not start again. A renderer generation change can,
    because activation keeps the replaced saved-page output (see
    `snapshot_saved_page_output`)."""
    if migrations:
        return "the schema migrations change"
    if mode == "always":
        return "requested"
    return None


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def clone_standing_database(volume: str) -> None:
    """Copy the standing database with pg_basebackup into a new volume.

    The copy is physical and consistent at one point in time; standing keeps
    serving. The helper joins standing's network namespace and reads the
    replication password from the database container's own environment."""
    image = run("docker", "inspect", "--format", "{{.Image}}", STANDING_DATABASE)
    run("docker", "volume", "create", "--label", "com.rokurolize.wikijump.owner=standing-rehearsal", volume)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", delete=False) as env_file:
        os.chmod(env_file.name, 0o600)
        env_file.write(
            "PGPASSWORD="
            + run("docker", "exec", STANDING_DATABASE, "printenv", "POSTGRES_PASSWORD")
            + "\n"
        )
    try:
        run(
            "docker", "run", "--rm", "--user", "postgres",
            "--network", f"container:{STANDING_NAMESPACE}",
            "--env-file", env_file.name,
            "--volume", f"{volume}:/var/lib/postgresql/data",
            "--entrypoint", "pg_basebackup",
            image,
            "--host", "127.0.0.1", "--username", "wikijump",
            "--pgdata", "/var/lib/postgresql/data",
            "--format", "plain", "--wal-method", "stream", "--checkpoint", "fast",
        )
    finally:
        os.unlink(env_file.name)


def overlay_standing_files(volume: str, upper_volume: str) -> None:
    """A copy-on-write view of the standing object store.

    The rehearsal's writes land in `upper_volume`; standing's volume is only
    the read-only lower layer, so nothing is copied up front."""
    lower = run(
        "docker", "volume", "inspect", "--format", "{{.Mountpoint}}", STANDING_FILES_VOLUME
    )
    run("docker", "volume", "create", "--label", "com.rokurolize.wikijump.owner=standing-rehearsal", upper_volume)
    upper_root = run("docker", "volume", "inspect", "--format", "{{.Mountpoint}}", upper_volume)
    helper = run("docker", "inspect", "--format", "{{.Image}}", STANDING_DATABASE)
    run(
        "docker", "run", "--rm", "--network", "none", "--entrypoint", "mkdir",
        "--volume", f"{upper_volume}:/upper", helper, "/upper/data", "/upper/work",
    )
    run(
        "docker", "volume", "create", "--driver", "local",
        "--label", "com.rokurolize.wikijump.owner=standing-rehearsal",
        "--opt", "type=overlay", "--opt", "device=overlay",
        "--opt", f"o=lowerdir={lower},upperdir={upper_root}/data,workdir={upper_root}/work",
        volume,
    )


def remove_volumes(*names: str) -> None:
    for name in names:
        subprocess.run(["docker", "volume", "rm", "--force", name], capture_output=True)


def saved_page_staleness(
    database_container: str, expected: str, scp_wiki_slugs: list[str] | None = None
) -> int:
    sql = (
        "SELECT count(*) FROM page p JOIN page_revision pr "
        "ON pr.revision_id = p.latest_revision_id WHERE p.deleted_at IS NULL "
        "AND pr.compiled_generator <> '" + expected.replace("'", "''") + "'"
    )
    if scp_wiki_slugs is not None:
        quoted = ", ".join("'" + slug.replace("'", "''") + "'" for slug in scp_wiki_slugs)
        sql += (
            " AND p.site_id = (SELECT site_id FROM site WHERE slug = 'scp-wiki')"
            f" AND p.slug IN ({quoted})"
        )
    return int(
        run(
            "docker", "exec", database_container, "sh", "-c",
            'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -h 127.0.0.1 -U "$POSTGRES_USER" '
            '-d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 -c "$1"',
            "sh", sql,
        )
    )


SAVED_PAGE_OUTPUT_COLUMNS = (
    "revision_id",
    "compiled_body_html_hash",
    "compiled_body_styles_hash",
    "compiled_top_bar_html_hash",
    "compiled_side_bar_html_hash",
    "compiled_at",
    "compiled_generator",
)


def psql(container: str, script: str) -> str:
    return subprocess.run(
        [
            "docker", "exec", "-i", container, "sh", "-c",
            'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -q -h 127.0.0.1 -U "$POSTGRES_USER" '
            '-d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1 --single-transaction',
        ],
        input=script, check=True, text=True, capture_output=True,
    ).stdout


def snapshot_saved_page_output(path: Path, database: str = STANDING_DATABASE) -> int:
    """Keep the compiled output that activating a new renderer generation
    replaces, so a failed activation can put it back for the old build
    instead of leaving every saved page stale to it."""
    columns = ", ".join(SAVED_PAGE_OUTPUT_COLUMNS)
    data = psql(
        database,
        f"COPY (SELECT {columns} FROM page_revision WHERE revision_id IN "
        "(SELECT latest_revision_id FROM page WHERE deleted_at IS NULL) "
        "ORDER BY revision_id) TO STDOUT;\n",
    )
    path.write_text(data, encoding="utf-8")
    os.chmod(path, 0o600)
    return len(data.splitlines())


def restore_saved_page_output(
    path: Path,
    promoted_generator: str,
    database: str = STANDING_DATABASE,
    cache: str = STANDING_CACHE,
) -> int:
    """Put the snapshot back on revisions the new build has not rendered
    since (their generator is still the promoted one), and move every site's
    public-content fence so no cached response from the new build is served."""
    columns = ", ".join(SAVED_PAGE_OUTPUT_COLUMNS)
    assignments = ", ".join(f"{column} = saved.{column}" for column in SAVED_PAGE_OUTPUT_COLUMNS[1:])
    generator = promoted_generator.replace("'", "''")
    output = psql(
        database,
        "CREATE TEMPORARY TABLE saved ON COMMIT DROP AS "
        f"SELECT {columns} FROM page_revision WITH NO DATA;\n"
        f"COPY saved ({columns}) FROM STDIN;\n"
        + path.read_text(encoding="utf-8")
        + "\\.\n"
        + f"WITH restored AS (UPDATE page_revision SET {assignments} FROM saved "
        "WHERE page_revision.revision_id = saved.revision_id "
        f"AND page_revision.compiled_generator = '{generator}' RETURNING 1) "
        "SELECT count(*) FROM restored;\n",
    )
    sites = psql(database, "SELECT site_id FROM site ORDER BY site_id;\n").split()
    for site_id in sites:
        run(
            "docker", "exec", cache, "valkey-cli", "INCR",
            f"deepwell:public-content:site:{site_id}:version",
        )
    return int(output.split()[-1])


def http_canary(url: str, resolve: str | None = None) -> dict[str, object]:
    args = ["curl", "--silent", "--show-error", "--fail", "--location", "--insecure", "--max-time", "30"]
    if resolve:
        args += ["--resolve", resolve]
    body = run(*args, url)
    if "scp-9506" not in body.lower() or "page-content" not in body:
        raise RuntimeError(f"canary {url} returned an unexpected document")
    return {"url": url, "status": "pass", "required_markers": ["scp-9506", "page-content"]}


def browser_canary_slugs(source_root: Path) -> list[str]:
    """The pages the browser parity loads, from its own canary contract."""
    return json.loads(
        run(
            "node", "--input-type=module", "-e",
            "const m = await import('./install/local/wikidot-verification/src/standing-browser-canaries.mjs');"
            "console.log(JSON.stringify(m.STANDING_BROWSER_CANARIES.map((c) => c.slug)));",
            cwd=source_root,
        )
    )


def rerender_rehearsal_pages(project: str, image: str, slugs: list[str]) -> dict[str, object]:
    """Render the canary pages on the rehearsal with its own configuration.

    The copied saved pages were rendered by standing, so their embedded URLs
    name standing's origin, which the rehearsal does not serve. Marking only
    these pages stale on the copy lets render-ahead render them with the new
    image and the rehearsal's configuration; restarting its Deepwell promotes
    them, as activation would."""
    database = f"{project}-database-1"
    deepwell = f"{project}-deepwell-1"
    quoted = ", ".join("'" + slug.replace("'", "''") + "'" for slug in slugs)
    page_ids = [
        int(value)
        for value in psql(
            database,
            "WITH canary AS (SELECT p.page_id, p.latest_revision_id FROM page p "
            "JOIN site s ON s.site_id = p.site_id "
            f"WHERE s.slug = 'scp-wiki' AND p.slug IN ({quoted}) AND p.deleted_at IS NULL), "
            "marked AS (UPDATE page_revision SET compiled_generator = 'rehearsal-rerender' "
            "WHERE revision_id IN (SELECT latest_revision_id FROM canary) RETURNING 1) "
            "SELECT page_id FROM canary;\n",
        ).split()
    ]
    if len(page_ids) != len(slugs):
        raise RuntimeError(f"the rehearsal has {len(page_ids)} of the {len(slugs)} canary pages")
    inspected = render_ahead.container_inspect(deepwell)
    migration = run("docker", "run", "--rm", "--entrypoint", "cat", image, render_ahead.MIGRATION_PATH)
    render_ahead.require_idempotent_migration(migration)
    render_ahead.psql(database, migration)
    with tempfile.TemporaryDirectory() as directory:
        summary = render_ahead.render_pass(
            image, deepwell,
            render_ahead.config_mount(inspected),
            render_ahead.runtime_environment(inspected),
            render_ahead.render_ahead_settings(len(page_ids), 200, render_ahead.utc_now(), page_ids),
            Path(directory) / "render.log",
        )
    if summary["rendered"] != len(page_ids) or summary["failed"]:
        raise RuntimeError(f"the rehearsal could not render its canary pages: {summary['failures']}")
    run("docker", "restart", deepwell)
    deadline = time.monotonic() + 300
    while run("docker", "inspect", "--format", "{{.State.Health.Status}}", deepwell) != "healthy":
        if time.monotonic() > deadline:
            raise RuntimeError("the rehearsal Deepwell did not become healthy after its restart")
        time.sleep(1)
    return {"pages": len(page_ids), "slugs": slugs}


# Browser parity


def browser_reference(path: Path) -> dict[str, str]:
    """The retained live Wikidot reference the browser parity compares to.

    It is captured once (`run-standing-browser-parity.mjs --mode
    live-reference`) and replayed by every promotion; recapture it only when
    the canary contract or the live pages change."""
    manifest = json.loads((path / "reference.json").read_text(encoding="utf-8"))
    if manifest.get("schema") != BROWSER_REFERENCE_SCHEMA:
        raise ValueError(f"{path / 'reference.json'} is not a standing browser reference")
    ledger = path / manifest["live_reference_ledger"]
    if hashlib.sha256(ledger.read_bytes()).hexdigest() != manifest["live_reference_sha256"]:
        raise ValueError("the retained live reference does not match its manifest")
    return {
        "policy": str(path / manifest["live_completion_policy"]),
        "ledger": str(ledger),
        "ledger_sha256": manifest["live_reference_sha256"],
        "cache_dir": manifest["source_response_cache_dir"],
        "cache_identity": manifest["source_response_cache_identity"],
        "browser": manifest["browser_executable"],
        # Cross-origin responses vary by Origin, so the retained responses
        # replay only for the candidate origin they were captured from.
        "candidate_port": int(manifest["candidate_public_port"]),
    }


def browser_parity(
    source_root: Path, mode: str, output: Path, reference: dict[str, str], binding: list[str], log: Path
) -> dict[str, object]:
    stdout = run_logged(
        [
            "node", str(VERIFICATION / "scripts" / "run-standing-browser-parity.mjs"),
            "--mode", mode,
            "--output-dir", str(output),
            "--live-completion-policy", reference["policy"],
            "--live-reference-ledger", reference["ledger"],
            "--live-reference-sha256", reference["ledger_sha256"],
            "--source-response-cache-dir", reference["cache_dir"],
            "--source-response-cache-identity", reference["cache_identity"],
            "--browser-root", "framerail",
            "--browser-executable", reference["browser"],
            *binding,
        ],
        log,
        source_root,
    )
    result = last_json_line(stdout)
    if result.get("status") != "pass":
        raise RuntimeError(f"{mode} browser parity did not pass; see {output}")
    return {"status": "pass", "output_dir": str(output)}


# Promotion


def prepare_promotion_checkout(repository: Path, checkout: Path) -> Path:
    """The persistent checkout promotions run from, moved to the fetched
    origin/develop.

    It keeps its cargo target directory, node_modules and test build between
    promotions, so a promotion that must run checks compiles incrementally
    instead of from a fresh worktree. It must be clean; it is never reset."""
    run("git", "-C", str(repository), "fetch", "--quiet", "origin", "develop")
    if not checkout.exists():
        checkout.parent.mkdir(parents=True, exist_ok=True)
        run("git", "-C", str(repository), "worktree", "add", "--detach", str(checkout), "origin/develop")
        return checkout
    common = lambda root: Path(root, run("git", "-C", str(root), "rev-parse", "--git-common-dir")).resolve()
    if common(checkout) != common(repository):
        raise ValueError(f"{checkout} is not a worktree of {repository}")
    if run("git", "-C", str(checkout), "status", "--porcelain", "--untracked-files=all"):
        raise ValueError(f"the promotion checkout {checkout} has local changes; it is never reset")
    run("git", "-C", str(checkout), "checkout", "--quiet", "--detach", "origin/develop")
    return checkout


def run_from_source_root(source_root: Path) -> None:
    """Re-run this command from the promoted source's own promote.py, so the
    orchestrator is the one that source ships."""
    own = source_root / "install" / "standing" / "promote.py"
    if Path(__file__).resolve() == own.resolve():
        return
    arguments = [argument for argument in sys.argv[1:]]
    if "--source-root" not in arguments:
        arguments = ["--source-root", str(source_root), *arguments]
    os.execv(sys.executable, [sys.executable, str(own), *arguments])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--source-root",
        type=Path,
        help="a clean checkout of the fetched origin/develop; by default the persistent "
        "promotion checkout under the state directory, moved to origin/develop",
    )
    parser.add_argument("--runtime-home", type=Path, default=refresh.DEFAULT_RUNTIME_HOME)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--validation-store", type=Path, default=state_root() / "validation")
    parser.add_argument(
        "--browser-reference", type=Path, default=state_root() / "standing-browser-reference"
    )
    parser.add_argument(
        "--rehearse",
        choices=("auto", "always"),
        default="auto",
        help="auto rehearses only when a failed activation cannot be undone",
    )
    parser.add_argument("--health-timeout-seconds", type=int, default=600)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.source_root is None:
        source_root = prepare_promotion_checkout(
            Path(__file__).resolve().parents[2], state_root() / "promotion-checkout"
        )
    else:
        source_root = args.source_root.resolve()
    run_from_source_root(source_root)
    runtime_home = args.runtime_home.resolve()
    override_file = source_root / "install" / "standing" / "refresh.compose.yaml"
    stages = Stages()
    started_at = datetime.now(UTC)
    receipt: dict[str, object] = {
        "schema": PROMOTION_RECEIPT_SCHEMA,
        "started_at": started_at.isoformat(),
        "stages": stages.records,
    }

    # 1. identity
    def identity_stage():
        identity = refresh.repository_identity(source_root)
        environment = refresh.read_environment(runtime_home / ".env")
        standing_sha = environment.get("STANDING_WIKIJUMP_SHA", "")
        if not GIT_OBJECT.fullmatch(standing_sha):
            raise ValueError("the standing runtime does not record its source revision")
        return {**identity, "standing_sha": standing_sha}

    identity = stages.run("identity", identity_stage)
    target, standing_sha = identity["wikijump_sha"], identity["standing_sha"]
    if target == standing_sha:
        print(json.dumps({"status": "current", "wikijump_sha": target}))
        return 0
    evidence = (
        args.evidence_dir
        or state_root() / "promotions" / f"{target[:12]}-{started_at.strftime('%Y%m%dT%H%M%SZ')}"
    ).resolve()
    evidence.mkdir(mode=0o700, parents=True, exist_ok=False)
    receipt_path = evidence / "promotion-receipt.json"
    receipt["identity"] = identity

    try:
        return promote(args, source_root, runtime_home, override_file, identity, evidence, stages, receipt)
    except BaseException as error:
        receipt.update(status="fail", error=str(error))
        raise
    finally:
        receipt["completed_at"] = datetime.now(UTC).isoformat()
        receipt["duration_seconds"] = round(stages.elapsed(), 3)
        refresh.atomic_json(receipt_path, receipt)
        print(f"promote: receipt {receipt_path}", file=sys.stderr)


def promote(args, source_root, runtime_home, override_file, identity, evidence, stages, receipt) -> int:
    target, standing_sha = identity["wikijump_sha"], identity["standing_sha"]
    reference = browser_reference(args.browser_reference)

    # 2. plan
    def plan_stage():
        changed = changed_paths(source_root, standing_sha, target)
        expected_generator = refresh.expected_compiled_generator(source_root)
        stale = saved_page_staleness(STANDING_DATABASE, expected_generator)
        migrations = sorted(path for path in changed if path.startswith("deepwell/migrations/"))
        reason = rehearsal_reason(args.rehearse, migrations)
        return {
            "changed_paths": len(changed),
            "required_groups": classify(source_root, changed),
            "expected_compiled_generator": expected_generator,
            "stale_pages_before": stale,
            "render_ahead": stale > 0,
            "migration_changes": migrations,
            "rehearse": reason is not None,
            "rehearsal_reason": reason,
        }

    plan = stages.run("plan", plan_stage)
    receipt["plan"] = plan

    # 3. validation and build, side by side
    def validation_stage():
        receipts = validation_receipts(args.validation_store)
        covered, missing = validation_coverage(
            plan["required_groups"],
            identity["wikijump_tree"],
            receipts,
            lambda other: classify(source_root, changed_paths(source_root, other, identity["wikijump_tree"])),
        )
        ran = None
        if missing:
            args.validation_store.mkdir(mode=0o700, parents=True, exist_ok=True)
            output = args.validation_store / f"{identity['wikijump_tree']}-{int(time.time())}.json"
            run_logged(
                [
                    "node", str(VERIFICATION / "scripts" / "run-consolidated-validation.mjs"),
                    "--repository", str(source_root),
                    "--base", standing_sha,
                    "--groups", ",".join(missing),
                    "--output", str(output),
                    # The build stage builds the images alongside.
                    "--no-image-build",
                ],
                evidence / "validation.log",
                source_root,
            )
            ran = {"groups": missing, "receipt": str(output)}
            for group in missing:
                covered[group] = {"receipt": str(output), "tree": identity["wikijump_tree"]}
        return {"covered": covered, "ran": ran}

    def build_stage():
        stdout = run_logged(
            [
                "node", str(VERIFICATION / "scripts" / "build-promotion-candidate-images.mjs"),
                "--source-root", str(source_root),
                "--output-dir", str(evidence / "build"),
                "--run-id", f"promotion-{target[:12]}-{int(time.time())}",
                "--reuse-runtime-home", str(runtime_home),
            ],
            evidence / "build.log",
            source_root,
        )
        return last_json_line(stdout)

    rehearsal_volumes = {
        "database": f"wjrehearsal-{target[:12]}-postgres",
        "files": f"wjrehearsal-{target[:12]}-files",
        "files_upper": f"wjrehearsal-{target[:12]}-files-upper",
    }

    def clone_stage():
        clone_standing_database(rehearsal_volumes["database"])
        overlay_standing_files(rehearsal_volumes["files"], rehearsal_volumes["files_upper"])
        return dict(rehearsal_volumes)

    def browser_dependencies_stage():
        # The browser parity drives Chromium through Framerail's locked
        # Playwright; a fresh checkout has no node_modules yet.
        if (source_root / "framerail" / "node_modules" / "@playwright" / "test").is_dir():
            return {"status": "present"}
        run_logged(
            ["pnpm", "--dir", "framerail", "install", "--frozen-lockfile", "--prefer-offline"],
            evidence / "browser-dependencies.log",
            source_root,
        )
        return {"status": "installed"}

    # The rehearsal renders the pages it serves itself, so its copy needs
    # nothing from render-ahead and is taken alongside the build.
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        validation = pool.submit(stages.run, "validation", validation_stage)
        build = pool.submit(stages.run, "build", build_stage)
        dependencies = pool.submit(stages.run, "browser-dependencies", browser_dependencies_stage)
        clone = pool.submit(stages.run, "rehearsal-clone", clone_stage) if plan["rehearse"] else None
        try:
            receipt["validation"] = validation.result()
            built = build.result()
            dependencies.result()
            if clone:
                clone.result()
        except BaseException:
            for future in (validation, build, dependencies, clone):
                if future:
                    future.cancel()
            if plan["rehearse"]:
                pool.shutdown(wait=True)
                remove_volumes(*rehearsal_volumes.values())
            raise
    try:
        return finish(
            args, source_root, runtime_home, override_file, identity, evidence,
            stages, receipt, plan, reference, built, rehearsal_volumes,
        )
    finally:
        if plan["rehearse"]:
            remove_volumes(*rehearsal_volumes.values())


def finish(
    args, source_root, runtime_home, override_file, identity, evidence,
    stages, receipt, plan, reference, built, rehearsal_volumes,
) -> int:
    """Render ahead, rehearse, activate and prove, after the build."""
    target = identity["wikijump_sha"]
    images = {service: built["images"][service] for service in SERVICES}
    receipt["images"] = images

    # 4. render-ahead
    render_ahead = {
        "status": "not-needed",
        "expected_compiled_generator": plan["expected_compiled_generator"],
        "stale_pages_before": 0,
    }
    if plan["render_ahead"]:
        def render_stage():
            output = evidence / "render-ahead"
            run_logged(
                [
                    sys.executable, str(Path(__file__).with_name("render_ahead.py")),
                    "--image", images["deepwell"],
                    "--output-dir", str(output),
                ],
                evidence / "render-ahead.log",
                source_root,
            )
            path = output / "render-ahead-receipt.json"
            ahead = json.loads(path.read_text(encoding="utf-8"))
            if (
                ahead.get("status") != "pass"
                or ahead.get("render_image_id") != images["deepwell"]
                or ahead.get("compiled_generator") != plan["expected_compiled_generator"]
                or ahead.get("stale_without_valid_ahead") != 0
            ):
                raise RuntimeError(f"render-ahead did not render every stale page: {path}")
            return {
                "status": "pass",
                "expected_compiled_generator": plan["expected_compiled_generator"],
                "stale_pages_before": plan["stale_pages_before"],
                "receipt": {"path": str(path), "sha256": refresh.file_sha256(path)},
            }

    def rehearsal_stage():
        return rehearse(
            source_root, evidence, stages, plan, reference, rehearsal_volumes,
            target, images["deepwell"],
        )

    # 5. rehearsal, alongside render-ahead when both are needed: neither reads
    # the other's database.
    if plan["render_ahead"] and plan["rehearse"]:
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            ahead = pool.submit(stages.run, "render-ahead", render_stage)
            rehearsal = pool.submit(rehearsal_stage)
            errors = [future.exception() for future in (ahead, rehearsal)]
        for error in errors:
            if error is not None:
                raise error
        render_ahead = ahead.result()
        receipt["rehearsal"] = rehearsal.result()
    elif plan["render_ahead"]:
        render_ahead = stages.run("render-ahead", render_stage)
    receipt["render_ahead"] = render_ahead

    if plan["rehearse"]:
        if "rehearsal" not in receipt:
            receipt["rehearsal"] = rehearsal_stage()
    else:
        receipt["rehearsal"] = {
            "status": "not-needed",
            "reason": "no migration change: a failed activation is undone by restoring the parked containers and saved pages",
        }

    # 6. activation and standing proof
    receipt["activation"] = activate(
        source_root, runtime_home, override_file, identity, evidence, stages,
        images, render_ahead, reference, args.health_timeout_seconds,
    )
    receipt["status"] = "pass"
    print(json.dumps({"status": "pass", "wikijump_sha": target, "duration_seconds": round(stages.elapsed())}))
    return 0


def rehearse(source_root, evidence, stages, plan, reference, volumes, target, deepwell_image) -> dict[str, object]:
    project = f"wjcand-rehearsal-{target[:12]}"
    candidate_root = evidence / "rehearsal"
    ports = {"public": reference["candidate_port"], "rpc": free_port(), "object_store": free_port()}
    try:
        def start_stage():
            stdout = run_logged(
                [
                    "node", str(VERIFICATION / "scripts" / "start-promotion-candidate.mjs"),
                    "--source-root", str(source_root),
                    "--build-evidence", str(evidence / "build"),
                    "--candidate-root", str(candidate_root),
                    "--staging-home", str(evidence / "rehearsal-staging"),
                    "--public-port", str(ports["public"]),
                    "--rpc-port", str(ports["rpc"]),
                    "--object-store-port", str(ports["object_store"]),
                    "--project", project,
                    "--expires-at", (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
                    "--database-volume", volumes["database"],
                    "--files-volume", volumes["files"],
                ],
                evidence / "rehearsal-start.log",
                source_root,
            )
            return last_json_line(stdout)

        started = stages.run("rehearsal-start", start_stage)
        slugs = browser_canary_slugs(source_root)
        stages.run(
            "rehearsal-render",
            lambda: rerender_rehearsal_pages(project, deepwell_image, slugs),
        )

        def check_stage():
            # After a generator change only the pages the rehearsal rendered
            # itself are current on its copy; render-ahead renders the rest on
            # standing, and activation requires all of them fresh there.
            stale = saved_page_staleness(
                f"{project}-database-1",
                plan["expected_compiled_generator"],
                slugs if plan["render_ahead"] else None,
            )
            if stale:
                raise RuntimeError(f"the rehearsal serves {stale} stale saved pages")
            origin = f"scp-wiki.wikijump.localhost:{ports['public']}"
            canary = http_canary(
                f"https://{origin}/scp-9506", f"{origin}:127.0.0.1"
            )
            parity = browser_parity(
                source_root, "candidate", evidence / "rehearsal-browser-parity", reference,
                ["--candidate-identity", started["identityPath"]],
                evidence / "rehearsal-browser-parity.log",
            )
            return {"stale_pages_remaining": 0, "canary": canary, "browser_parity": parity}

        result = stages.run("rehearsal-checks", check_stage)
        return {"status": "pass", "project": project, **result}
    finally:
        compose = candidate_root / "compose.json"
        if compose.exists():
            subprocess.run(
                ["docker", "compose", "-p", project, "-f", str(compose), "down", "--volumes", "--remove-orphans"],
                capture_output=True,
                env={**os.environ, "DEEPWELL_RPC_TOKEN": "0" * 64},
            )
        remove_volumes(volumes["files"], volumes["files_upper"], volumes["database"])


def activate(
    source_root, runtime_home, override_file, identity, evidence, stages,
    image_ids, render_ahead, reference, health_timeout,
) -> dict[str, object]:
    run_id = f"{identity['wikijump_sha']}-{evidence.name}"
    environment = refresh.read_environment(runtime_home / ".env")
    previous_environment = dict(environment)
    if environment.get("STANDING_PROJECT_NAME") != "wikijump-standing":
        raise ValueError("runtime home is not the wikijump-standing project")
    previous = refresh.runtime_containers(runtime_home)
    previous_owner = refresh.port_443_owner(previous)
    rollback_images = {
        service: refresh.image_identity(previous[service]["image_id"], runtime_home)
        for service in SERVICES
    }
    images = {}
    for service in SERVICES:
        image = refresh.image_identity(image_ids[service], runtime_home)
        labels = image["labels"]
        if (
            labels.get("com.rokurolize.wikijump.sha") != identity["wikijump_sha"]
            or labels.get("com.rokurolize.wikijump.tree") != identity["wikijump_tree"]
            or labels.get("com.rokurolize.wikijump.ftml_sha") != identity["ftml_sha"]
        ):
            raise RuntimeError(f"built {service} image is not labelled for {identity['wikijump_sha']}")
        images[service] = image
    expiry = (datetime.now(UTC) + RESOURCE_LIFETIME).isoformat()
    parked: dict[str, dict[str, object]] = {}
    switched = False
    differential_path = runtime_home / refresh.RUNTIME_DIFFERENTIAL_IDENTITY
    previous_differential = (
        differential_path.read_text(encoding="utf-8") if differential_path.exists() else None
    )
    timings: dict[str, float] = {}
    snapshot = evidence / "saved-page-output-before.tsv"

    def timed(name, action):
        started = time.monotonic()
        try:
            return action()
        finally:
            timings[name] = round(time.monotonic() - started, 3)

    def switch_stage():
        nonlocal parked, switched
        if refresh.runtime_containers(runtime_home) != previous:
            raise RuntimeError("standing changed while the promotion prepared; rerun it")
        activation_started = time.monotonic()
        if render_ahead["status"] == "pass":
            snapshot_rows = timed("saved-page-snapshot", lambda: snapshot_saved_page_output(snapshot))
            if snapshot_rows < render_ahead["stale_pages_before"]:
                raise RuntimeError("the saved-page snapshot is missing pages")
        parked = refresh.park_containers(previous, runtime_home, run_id)
        environment.update(
            {
                "STANDING_DEEPWELL_IMAGE": images["deepwell"]["id"],
                "STANDING_FRAMERAIL_IMAGE": images["framerail"]["id"],
                "STANDING_WWS_IMAGE": images["wws"]["id"],
                "STANDING_WIKIJUMP_SHA": identity["wikijump_sha"],
                "STANDING_FTML_SHA": identity["ftml_sha"],
                "STANDING_RESOURCE_EXPIRY": expiry,
            }
        )
        refresh.write_environment(runtime_home / ".env", environment)
        switched = True
        timed("compose", lambda: refresh.command(
            *refresh.compose_command(
                runtime_home, "up", "--detach", "--no-deps", "--no-build", *SERVICES,
                override_file=override_file,
            ),
            cwd=runtime_home,
        ))
        health = timed("health", lambda: refresh.wait_for_health(runtime_home, override_file, health_timeout))
        stale = saved_page_staleness(STANDING_DATABASE, render_ahead["expected_compiled_generator"])
        if stale:
            raise RuntimeError(f"standing serves {stale} stale saved pages")
        canary = timed("canary", lambda: http_canary(refresh.CANARY_URL))
        current = refresh.runtime_containers(runtime_home)
        for service in SERVICES:
            if current[service]["container_id"] == previous[service]["container_id"]:
                raise RuntimeError(f"activation did not create a new {service} container")
            if current[service]["image_id"] != images[service]["id"]:
                raise RuntimeError(f"standing {service} does not run the promoted image")
        if refresh.port_443_owner(current)["container_id"] != previous_owner["container_id"]:
            raise RuntimeError("activation changed the port-443 owner")
        effective_config = refresh.command(
            *refresh.compose_command(runtime_home, "config", override_file=override_file),
            cwd=runtime_home,
        )
        differential = refresh.runtime_differential_identity(
            source_root, identity, images, effective_config
        )
        refresh.atomic_json(differential_path, differential)
        refresh_receipt = {
            "schema_version": REFRESH_RECEIPT_SCHEMA_VERSION,
            "kind": "standing-promotion",
            "status": "pass",
            "run_id": run_id,
            "started_at": datetime.now(UTC).isoformat(),
            "completed_at": datetime.now(UTC).isoformat(),
            "activation_duration_seconds": time.monotonic() - activation_started,
            "image_verification_duration_seconds": 0.0,
            "compose_activation_duration_seconds": timings["compose"],
            "health_duration_seconds": timings["health"],
            "canary_duration_seconds": timings["canary"],
            "wikijump_sha": identity["wikijump_sha"],
            "wikijump_tree": identity["wikijump_tree"],
            "ftml_sha": identity["ftml_sha"],
            "dependency_lock_sha256": identity["dependency_lock_sha256"],
            "build_evidence": {
                "path": str(evidence / "build" / "seal.json"),
                "sha256": refresh.file_sha256(evidence / "build" / "seal.json"),
            },
            "runtime_home": str(runtime_home),
            "project_name": "wikijump-standing",
            "network_name": environment["STANDING_NETWORK_NAME"],
            "images": {service: {k: images[service][k] for k in ("reference", "id", "repo_digests", "labels")} for service in SERVICES},
            "rollback_images": rollback_images,
            "protected_volumes": list(PROTECTED_VOLUMES),
            "saved_page_render_freshness": {
                "status": "pass",
                "expected_compiled_generator": render_ahead["expected_compiled_generator"],
                "stale_pages_remaining": 0,
            },
            "render_ahead": render_ahead,
            "runtime_differential_identity": {
                "path": str(differential_path),
                "sha256": refresh.file_sha256(differential_path),
                "identity": differential,
            },
            "health": health,
            "canary": canary,
            "resource_disposition": {
                "active": {
                    service: {"owner": "standing-runtime", "keep_until": expiry, "id": images[service]["id"]}
                    for service in SERVICES
                },
                "rollback": {
                    service: {"owner": "standing-runtime-rollback", "keep_until": expiry, "id": rollback_images[service]["id"]}
                    for service in SERVICES
                },
                "volumes": "protected-and-untouched",
                "worktrees": "none created",
                "target_directories": "none created",
            },
        }
        path = evidence / "refresh-receipt.json"
        refresh.atomic_json_no_replace(path, refresh_receipt)
        return {"refresh_receipt": str(path), "timings": dict(timings)}

    try:
        switched_result = stages.run("activation", switch_stage)
        proof = stages.run(
            "standing-proof",
            lambda: browser_parity(
                source_root, "standing", evidence / "standing-browser-parity", reference,
                ["--standing-refresh", switched_result["refresh_receipt"]],
                evidence / "standing-browser-parity.log",
            ),
        )
    except BaseException as error:
        if not parked:
            raise
        rollback = {"status": "fail"}
        try:
            if switched:
                refresh.write_environment(
                    runtime_home / ".env",
                    refresh.rollback_environment(previous_environment, rollback_images),
                )
                for service in SERVICES:
                    subprocess.run(
                        ["docker", "rm", "--force", f"wikijump-standing-{service}-1"],
                        capture_output=True,
                    )
                if snapshot.exists():
                    rollback["restored_saved_pages"] = restore_saved_page_output(
                        snapshot, render_ahead["expected_compiled_generator"]
                    )
            refresh.restore_parked_containers(parked, runtime_home)
            if previous_differential is None:
                differential_path.unlink(missing_ok=True)
            else:
                differential_path.write_text(previous_differential, encoding="utf-8")
            refresh.wait_for_health(runtime_home, override_file, health_timeout)
            rollback.update(status="pass", canary=http_canary(refresh.CANARY_URL))
        except BaseException as rollback_error:
            rollback["error"] = str(rollback_error)
        raise RuntimeError(f"activation failed ({error}); rollback {rollback}") from error

    for entry in parked.values():
        subprocess.run(["docker", "rm", entry["parked_name"]], capture_output=True)
    return {**switched_result, "standing_proof": proof, "rollback_images": {s: rollback_images[s]["id"] for s in SERVICES}}


if __name__ == "__main__":
    raise SystemExit(main())
