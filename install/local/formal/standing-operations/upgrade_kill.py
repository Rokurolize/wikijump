#!/usr/bin/env python3
from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
import textwrap
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
UPGRADE = ROOT / "install/common/postgres/upgrade/upgrade-cluster.sh"
ENTRY = ROOT / "install/common/postgres/locked-entrypoint.sh"
REQUIRED = ("PG_VERSION", "pg_hba.conf", "postgresql.conf", "base", "global")


def startable(path: Path, version: str) -> bool:
    if not path.is_dir() or (path / "UNSTARTABLE").is_file():
        return False
    if not all((path / name).exists() for name in REQUIRED):
        return False
    return (path / "PG_VERSION").read_text(encoding="utf-8").strip() == version


def verdict(volume: Path) -> str:
    old = startable(volume, "17")
    new = startable(volume, "19")
    side = startable(volume / ".pg-upgrade-new", "19")
    if old and new:
        return "both"
    if old:
        return "old"
    if new:
        return "new"
    if side:
        return "new-sidecar"
    return "neither"


def seed(volume: Path, catalog: str) -> None:
    if volume.exists():
        shutil.rmtree(volume)
    volume.mkdir(parents=True)
    (volume / "PG_VERSION").write_text("17\n", encoding="utf-8")
    (volume / "CATALOG").write_text(catalog + "\n", encoding="utf-8")
    (volume / "CHECKSUM").write_text("0\n", encoding="utf-8")
    for name in ("pg_hba.conf", "pg_ident.conf", "postgresql.auto.conf", "postgresql.conf"):
        (volume / name).write_text(name + "\n", encoding="utf-8")
    (volume / "base").mkdir()
    (volume / "base" / "1").write_text("heap\n", encoding="utf-8")
    (volume / "global").mkdir()
    (volume / "pg_wal").mkdir()


def write_stubs(stubs: Path) -> None:
    stubs.mkdir(parents=True)
    script = textwrap.dedent(
        r"""
        #!/usr/bin/env python3
        import os, signal, subprocess, sys
        from pathlib import Path

        name = sys.argv[1]
        sys.argv = [sys.argv[1], *sys.argv[2:]]
        step_path = Path(os.environ["STEP_FILE"])
        log_path = Path(str(step_path) + ".log")
        current = int(step_path.read_text() or "0")
        nxt = current + 1
        step_path.write_text(str(nxt))
        with log_path.open("a", encoding="utf-8") as log:
            log.write(f"{nxt} {name} {' '.join(sys.argv[1:])}\n")
            log.flush()
            os.fsync(log.fileno())
        kill_at = os.environ.get("KILL_AT", "0")
        if kill_at == str(nxt):
            os.kill(int(os.environ["UPGRADE_PID"]), signal.SIGKILL)
            os._exit(137)

        def arg_value(flag):
            args = sys.argv[1:]
            return args[args.index(flag) + 1]

        if name == "cp":
            os.execv("/usr/bin/cp", ["/usr/bin/cp", *sys.argv[1:]])
        if name == "rm":
            os.execv("/usr/bin/rm", ["/usr/bin/rm", *sys.argv[1:]])
        if name == "mv":
            args = sys.argv[1:]
            if os.environ.get("PARTIAL_MV") == "1" and "-t" in args:
                dest = Path(args[args.index("-t") + 1])
                sources = [Path(a) for a in args if a not in ("-t", str(dest)) and not a.startswith("-")]
                if dest == Path("/volume") and any(".pg-upgrade-new" in str(s) for s in sources):
                    def complete(path, version):
                        need = ("PG_VERSION", "pg_hba.conf", "postgresql.conf", "base", "global")
                        if (path / "UNSTARTABLE").exists():
                            return False
                        if not all((path / item).exists() for item in need):
                            return False
                        return (path / "PG_VERSION").read_text().strip() == version
                    for source in sources:
                        os.rename(source, dest / source.name)
                        side = dest / ".pg-upgrade-new"
                        if not (complete(dest, "17") or complete(dest, "19") or complete(side, "19")):
                            os.kill(int(os.environ["UPGRADE_PID"]), signal.SIGKILL)
                            os._exit(137)
                    os.kill(int(os.environ["UPGRADE_PID"]), signal.SIGKILL)
                    os._exit(137)
            os.execv("/usr/bin/mv", ["/usr/bin/mv", *sys.argv[1:]])
        if name == "pg_controldata":
            data = Path(sys.argv[1])
            catalog = (data / "CATALOG").read_text().strip()
            checksum = (data / "CHECKSUM").read_text().strip()
            sys.stdout.write(f"Catalog version number: {catalog}\n")
            sys.stdout.write(f"Data page checksum version: {checksum}\n")
            raise SystemExit(0)
        if name == "initdb":
            target = Path(arg_value("-D"))
            if target.exists():
                subprocess.check_call(["/usr/bin/rm", "-rf", str(target)])
            target.mkdir(parents=True)
            (target / "PG_VERSION").write_text("19\n")
            (target / "CATALOG").write_text("newcat\n")
            (target / "CHECKSUM").write_text("0\n")
            for entry in ("pg_hba.conf", "pg_ident.conf", "postgresql.auto.conf", "postgresql.conf"):
                (target / entry).write_text(entry + "\n")
            (target / "base").mkdir()
            (target / "base" / "1").write_text("heap\n")
            (target / "global").mkdir()
            (target / "pg_wal").mkdir()
            raise SystemExit(0)
        if name == "pg_upgrade":
            if "--check" in sys.argv[1:]:
                raise SystemExit(0)
            new = Path("/volume/.pg-upgrade-new")
            for entry in ("PG_VERSION", "pg_hba.conf", "postgresql.conf", "base", "global"):
                if not (new / entry).exists():
                    sys.stderr.write(f"new cluster missing {entry}\n")
                    raise SystemExit(1)
            (Path("/volume") / "UNSTARTABLE").write_text("linked\n")
            raise SystemExit(0)
        if name in ("pg_ctl", "psql", "vacuumdb"):
            raise SystemExit(0)
        if name == "postgres":
            sys.stdout.write("postgres (PostgreSQL) 19\n")
            raise SystemExit(0)
        sys.stderr.write(f"unknown stub {name}\n")
        raise SystemExit(127)
        """
    ).lstrip()
    target = stubs / "stub.py"
    target.write_text(script, encoding="utf-8")
    target.chmod(0o755)
    for command in (
        "cp",
        "rm",
        "mv",
        "pg_controldata",
        "initdb",
        "pg_upgrade",
        "pg_ctl",
        "psql",
        "vacuumdb",
        "postgres",
    ):
        link = stubs / command
        link.write_text(
            "#!/usr/bin/bash\n"
            f'exec /usr/bin/python3 /stubs/stub.py {command} "$@"\n',
            encoding="utf-8",
        )
        link.chmod(0o755)


def prepare(work: Path, catalog: str) -> None:
    if work.exists():
        shutil.rmtree(work)
    (work / "opt" / "pg17" / "bin").mkdir(parents=True)
    write_stubs(work / "stubs")
    (work / "opt" / "pg17" / "bin" / "pg_controldata").symlink_to("/stubs/pg_controldata")
    seed(work / "volume", catalog)
    (work / "steps").write_text("0", encoding="utf-8")


def run_upgrade_bound(work: Path, script: Path, mode: str, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
    (work / "steps").write_text("0", encoding="utf-8")
    log = work / "steps.log"
    log.write_text("", encoding="utf-8")
    wrapper = work / "wrapper.sh"
    wrapper.write_text(
        "#!/usr/bin/bash\nmkdir -p /tmp/upgrade\nexport UPGRADE_PID=$$\nexec /usr/bin/bash /upgrade-cluster.sh \"$@\"\n",
        encoding="utf-8",
    )
    wrapper.chmod(0o755)
    cmd = [
        "bwrap",
        "--die-with-parent",
        "--ro-bind", "/usr", "/usr",
        "--ro-bind", "/lib", "/lib",
        "--ro-bind", "/lib64", "/lib64",
        "--tmpfs", "/tmp",
        "--dev", "/dev",
        "--proc", "/proc",
        "--bind", str(work), "/work",
        "--bind", str(work / "volume"), "/volume",
        "--bind", str(work / "opt"), "/opt",
        "--ro-bind", str(work / "stubs"), "/stubs",
        "--ro-bind", str(script), "/upgrade-cluster.sh",
        "--ro-bind", str(wrapper), "/wrapper.sh",
        "--chdir", "/tmp",
        "--setenv", "PATH", "/stubs:/opt/pg17/bin:/usr/bin",
        "--setenv", "STEP_FILE", "/work/steps",
        "--setenv", "KILL_AT", env.get("KILL_AT", "0"),
        "--setenv", "PARTIAL_MV", env.get("PARTIAL_MV", "0"),
        "/usr/bin/bash", "/wrapper.sh", mode,
    ]
    return subprocess.run(cmd, text=True, capture_output=True)


def hold_lock(volume: Path):
    import fcntl
    fd = os.open(volume, os.O_RDONLY)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    return fd


def check_real(script: Path, entry: Path) -> int:
    status = 0
    steps = 0
    import tempfile
    work = Path(tempfile.mkdtemp(prefix="upgrade-full-"))
    try:
        prepare(work, "oldcat")
        result = run_upgrade_bound(work, script, "upgrade", {})
        got = verdict(work / "volume")
        if result.returncode == 0 and got == "new":
            print(f"PASS  upgrade-full ({got})")
        else:
            print(f"FAIL  upgrade-full exit {result.returncode} verdict {got}", file=sys.stderr)
            sys.stderr.write(result.stdout + result.stderr)
            status = 1
        steps = int((work / "steps").read_text(encoding="utf-8"))
    finally:
        shutil.rmtree(work, ignore_errors=True)

    work = Path(tempfile.mkdtemp(prefix="upgrade-check-"))
    try:
        prepare(work, "oldcat")
        result = run_upgrade_bound(work, script, "check", {})
        got = verdict(work / "volume")
        side = work / "volume" / ".pg-upgrade-new"
        if result.returncode == 0 and got == "old" and not side.exists():
            print("PASS  upgrade-check (old)")
        else:
            print(f"FAIL  upgrade-check exit {result.returncode} verdict {got}", file=sys.stderr)
            status = 1
    finally:
        shutil.rmtree(work, ignore_errors=True)

    work = Path(tempfile.mkdtemp(prefix="upgrade-catalog-"))
    try:
        prepare(work, "newcat")
        result = run_upgrade_bound(work, script, "upgrade", {})
        got = verdict(work / "volume")
        side = work / "volume" / ".pg-upgrade-new"
        if result.returncode == 0 and got == "old" and not side.exists():
            print("PASS  upgrade-catalog (old)")
        else:
            print(f"FAIL  upgrade-catalog exit {result.returncode} verdict {got}", file=sys.stderr)
            sys.stderr.write(result.stderr)
            status = 1
    finally:
        shutil.rmtree(work, ignore_errors=True)

    work = Path(tempfile.mkdtemp(prefix="upgrade-lock-"))
    try:
        prepare(work, "oldcat")
        fd = hold_lock(work / "volume")
        try:
            result = run_upgrade_bound(work, script, "upgrade", {})
        finally:
            os.close(fd)
        got = verdict(work / "volume")
        if result.returncode != 0 and "running server holds the lock" in result.stderr and got == "old":
            print("PASS  upgrade-lock (refused)")
        else:
            print(
                f"FAIL  upgrade-lock exit {result.returncode} verdict {got}",
                file=sys.stderr,
            )
            sys.stderr.write(result.stderr)
            status = 1
    finally:
        shutil.rmtree(work, ignore_errors=True)

    if entry_servers(entry, broken=False) == 1:
        print("PASS  upgrade-entrypoint (one server)")
    else:
        print("FAIL  upgrade-entrypoint", file=sys.stderr)
        status = 1

    for kill_at in range(1, steps + 1):
        work = Path(tempfile.mkdtemp(prefix=f"upgrade-kill-{kill_at}-"))
        try:
            prepare(work, "oldcat")
            run_upgrade_bound(work, script, "upgrade", {"KILL_AT": str(kill_at)})
            got = verdict(work / "volume")
            if got in ("old", "new", "new-sidecar"):
                print(f"PASS  upgrade-kill {kill_at} ({got})")
            else:
                print(f"FAIL  upgrade-kill {kill_at} ({got})", file=sys.stderr)
                log = (work / "steps.log").read_text(encoding="utf-8")
                sys.stderr.write(log)
                status = 1
        finally:
            shutil.rmtree(work, ignore_errors=True)

    work = Path(tempfile.mkdtemp(prefix="upgrade-partial-"))
    try:
        prepare(work, "oldcat")
        run_upgrade_bound(work, script, "upgrade", {"PARTIAL_MV": "1"})
        got = verdict(work / "volume")
        volume = work / "volume"
        side = volume / ".pg-upgrade-new"
        root_missing = [name for name in REQUIRED if not (volume / name).exists()]
        side_missing = [name for name in REQUIRED if not (side / name).exists()]
        if got == "neither" and root_missing and side_missing:
            print(
                "EXPECTED-FAIL upgrade-move (neither) "
                f"root missing {','.join(root_missing)} "
                f"sidecar missing {','.join(side_missing)}"
            )
        else:
            print(f"UNEXPECTED upgrade-move verdict {got}", file=sys.stderr)
            status = 1
    finally:
        shutil.rmtree(work, ignore_errors=True)
    return status


def entry_servers(script: Path, broken: bool) -> int:
    import tempfile
    work = Path(tempfile.mkdtemp(prefix="upgrade-entry-"))
    try:
        stubs = work / "bin"
        stubs.mkdir()
        marker = work / "marker"
        (stubs / "docker-entrypoint.sh").write_text(
            f"#!/bin/sh\necho open >> {marker}\nsleep 30\n",
            encoding="utf-8",
        )
        (stubs / "docker-entrypoint.sh").chmod(0o755)
        target = work / "entrypoint.sh"
        text = script.read_text(encoding="utf-8")
        if broken:
            text = text.replace("if ! flock -n 9; then", "if false; then", 1)
        target.write_text(text, encoding="utf-8")
        target.chmod(0o755)
        pgdata = work / "pgdata"
        seed(pgdata, "oldcat")
        env = {**os.environ, "PGDATA": str(pgdata), "PATH": f"{stubs}:{os.environ.get('PATH', '')}"}
        first = subprocess.Popen(
            [str(target), "postgres"],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        for _ in range(50):
            if marker.exists():
                break
            time.sleep(0.05)
        else:
            first.kill()
            return -1
        second = subprocess.Popen(
            [str(target), "postgres"],
            env=env,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        refused = ""
        for _ in range(50):
            if second.poll() is not None:
                refused = second.stderr.read() if second.stderr is not None else ""
                break
            opens = marker.read_text(encoding="utf-8").count("open") if marker.exists() else 0
            if broken and opens >= 2:
                break
            time.sleep(0.05)
        opens = marker.read_text(encoding="utf-8").count("open") if marker.exists() else 0
        for proc in (second, first):
            if proc.poll() is None:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    proc.kill()
        if broken:
            return opens
        if second.returncode not in (0, None) and "another server holds the lock" in refused and opens == 1:
            return 1
        return opens
    finally:
        shutil.rmtree(work, ignore_errors=True)


def check_mutations(script: Path, entry: Path) -> int:
    status = 0
    import tempfile
    broken = Path(tempfile.mkdtemp(prefix="upgrade-broken-"))
    try:
        moved = script.read_text(encoding="utf-8").replace(
            'find "${new}" -mindepth 1 -maxdepth 1 -exec mv -t /volume {} +',
            'rm -rf "${new}"',
            1,
        )
        broken_script = broken / "upgrade-cluster.sh"
        broken_script.write_text(moved, encoding="utf-8")
        work = broken / "run"
        prepare(work, "oldcat")
        run_upgrade_bound(work, broken_script, "upgrade", {})
        got = verdict(work / "volume")
        if got == "neither":
            print("EXPECTED-FAIL m-upgrade-move (neither)")
        else:
            print(f"UNEXPECTED m-upgrade-move verdict {got}", file=sys.stderr)
            status = 1
    finally:
        shutil.rmtree(broken, ignore_errors=True)

    opens = entry_servers(entry, broken=True)
    if opens >= 2:
        print("EXPECTED-FAIL m-upgrade-lock (two servers)")
    else:
        print(f"UNEXPECTED m-upgrade-lock opens {opens}", file=sys.stderr)
        status = 1
    return status


def main() -> int:
    script = UPGRADE
    entry = ENTRY
    if not script.is_file() or not entry.is_file():
        print("MODEL DRIFT: upgrade script or entrypoint is missing", file=sys.stderr)
        return 2
    if shutil.which("bwrap") is None:
        print("bwrap not found", file=sys.stderr)
        return 2
    if len(sys.argv) > 1 and sys.argv[1] == "mutations":
        return check_mutations(script, entry)
    return check_real(script, entry)


if __name__ == "__main__":
    raise SystemExit(main())
