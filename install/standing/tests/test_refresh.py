from __future__ import annotations

import importlib.util
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


SCRIPT = Path(__file__).parents[1] / "refresh.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("standing_refresh", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
REFRESH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFRESH)


class RefreshStandingTest(unittest.TestCase):
    def test_default_runtime_home_is_user_state_not_wjlab(self) -> None:
        with mock.patch.dict(
            os.environ, {"XDG_STATE_HOME": "/tmp/wikijump-state"}, clear=False
        ):
            self.assertEqual(
                REFRESH.default_runtime_home(),
                Path("/tmp/wikijump-state/wikijump/standing"),
            )
        with mock.patch.dict(
            os.environ, {"XDG_STATE_HOME": "relative-state"}, clear=False
        ):
            with self.assertRaisesRegex(ValueError, "must be absolute"):
                REFRESH.default_runtime_home()

    def test_container_identity_rejects_mutable_identity(self) -> None:
        with self.assertRaisesRegex(ValueError, "immutable container ID"):
            REFRESH.normalize_container_identity(
                {
                    "Id": "container",
                    "Image": "sha256:" + "a" * 64,
                    "Name": "/wikijump-standing-caddy-1",
                    "State": {"Status": "running"},
                    "NetworkSettings": {"Ports": {}},
                }
            )

    def test_image_identity_rejects_mutable_image_id(self) -> None:
        original_command = REFRESH.command
        try:
            REFRESH.command = lambda *args, cwd, capture=True: json.dumps(
                {"Id": "latest"}
            )
            with self.assertRaisesRegex(ValueError, "immutable SHA-256 image ID"):
                REFRESH.image_identity("candidate", Path("/runtime"))
        finally:
            REFRESH.command = original_command

    def test_port_443_owner_rejects_zero_or_two_owners(self) -> None:
        owner = {
            "container_id": "a" * 64,
            "name": "wikijump-standing-caddy-1",
            "image_id": "sha256:" + "b" * 64,
            "published_ports": [
                {
                    "container_port": "443/tcp",
                    "host_ip": "127.0.0.1",
                    "host_port": "443",
                }
            ],
        }
        with self.assertRaisesRegex(ValueError, "exactly one"):
            REFRESH.port_443_owner({})
        with self.assertRaisesRegex(ValueError, "exactly one"):
            REFRESH.port_443_owner(
                {"one": owner, "two": {**owner, "container_id": "c" * 64}}
            )

    def test_atomic_receipt_does_not_replace_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            path = Path(temporary_dir) / "receipt.json"
            REFRESH.atomic_json_no_replace(path, {"status": "pass"})
            original = path.read_text(encoding="utf-8")
            with self.assertRaises(FileExistsError):
                REFRESH.atomic_json_no_replace(path, {"status": "changed"})
            self.assertEqual(path.read_text(encoding="utf-8"), original)

    def test_preflight_refuses_containerless_standing_before_promotion(self) -> None:
        running = {service: {"running": True} for service in REFRESH.SERVICES}
        with mock.patch.object(REFRESH, "runtime_containers", return_value=running):
            self.assertEqual(REFRESH.require_standing_applications_running(Path("/runtime")), running)
        for service in REFRESH.SERVICES:
            missing = {name: dict(row) for name, row in running.items()}
            missing[service]["running"] = False
            with mock.patch.object(REFRESH, "runtime_containers", return_value=missing):
                with self.assertRaisesRegex(RuntimeError, "recover the prior pinned app images"):
                    REFRESH.require_standing_applications_running(Path("/runtime"))
        with mock.patch.object(REFRESH, "runtime_containers", side_effect=subprocess.CalledProcessError(1, ["docker", "inspect"])):
            with self.assertRaisesRegex(RuntimeError, "cannot be inspected"):
                REFRESH.require_standing_applications_running(Path("/runtime"))

    def test_rollback_restores_parked_container_identity(self) -> None:
        service = REFRESH.SERVICES[0]
        original_name = f"wikijump-standing-{service}-1"
        parked_name = REFRESH.parked_container_name("run", service)
        state = {
            parked_name: {
                "container_id": "a" * 64,
                "name": parked_name,
                "image_id": "sha256:" + "b" * 64,
                "running": False,
            }
        }
        parked = {
            service: {
                "parked_name": parked_name,
                "original_name": original_name,
                "was_running": True,
                "container": state[parked_name],
            }
        }
        original_command = REFRESH.command
        original_container_identity = REFRESH.container_identity

        def fake_command(*args: str, cwd: Path, capture: bool = True) -> str:
            if args[:2] == ("docker", "rename"):
                current, target = args[2:4]
                state[target] = {**state.pop(current), "name": target, "running": False}
                return ""
            if args[:2] == ("docker", "start"):
                state[args[2]]["running"] = True
                return ""
            raise AssertionError(args)

        def fake_identity(reference: str, cwd: Path) -> dict[str, object]:
            return state[reference]

        try:
            REFRESH.command = fake_command
            REFRESH.container_identity = fake_identity
            restored = REFRESH.restore_parked_containers(parked, Path("/runtime"))
        finally:
            REFRESH.command = original_command
            REFRESH.container_identity = original_container_identity
        self.assertEqual(restored[service]["container_id"], "a" * 64)
        self.assertTrue(restored[service]["running"])
        self.assertEqual(restored[service]["name"], original_name)

    def test_parking_records_old_container_ids_and_names(self) -> None:
        state = {}
        previous = {}
        for index, service in enumerate(REFRESH.SERVICES):
            container_id = chr(97 + index) * 64
            name = f"wikijump-standing-{service}-1"
            state[container_id] = {
                "container_id": container_id,
                "name": name,
                "image_id": "sha256:" + chr(100 + index) * 64,
                "running": True,
            }
            previous[service] = state[container_id]
        original_command = REFRESH.command
        original_container_identity = REFRESH.container_identity

        def fake_command(*args: str, cwd: Path, capture: bool = True) -> str:
            if args[:2] == ("docker", "inspect"):
                reference = args[-1]
                if reference in state:
                    return "present"
                raise subprocess.CalledProcessError(1, args)
            if args[:2] == ("docker", "rename"):
                current, target = args[2:4]
                state[target] = {**state.pop(current), "name": target}
                return ""
            if args[:2] == ("docker", "stop"):
                state[args[2]]["running"] = False
                return ""
            raise AssertionError(args)

        try:
            REFRESH.command = fake_command
            REFRESH.container_identity = lambda reference, _cwd: state[reference]
            parked = REFRESH.park_containers(previous, Path("/runtime"), "run")
        finally:
            REFRESH.command = original_command
            REFRESH.container_identity = original_container_identity
        self.assertEqual(
            {
                service: entry["container"]["container_id"]
                for service, entry in parked.items()
            },
            {service: value["container_id"] for service, value in previous.items()},
        )
        self.assertTrue(all(entry["parked_name"] in state for entry in parked.values()))
        self.assertTrue(
            all(not entry["container"]["running"] for entry in parked.values())
        )


    def test_missing_parked_containers_recreate_previous_image_set_without_volumes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            runtime = Path(temporary_dir)
            images = {
                service: {"id": "sha256:" + str(index + 1) * 64}
                for index, service in enumerate(REFRESH.SERVICES)
            }
            env = {"STANDING_PROJECT_NAME": "wikijump-standing", **{
                f"STANDING_{service.upper()}_IMAGE": image["id"]
                for service, image in images.items()
            }}
            REFRESH.write_environment(runtime / ".env", env)
            parked = {service: {"parked_name": f"rollback-{service}"} for service in REFRESH.SERVICES}
            restored = {service: {"running": True, "image_id": image["id"]}
                        for service, image in images.items()}
            calls = []
            missing = subprocess.CalledProcessError(1, ["docker", "inspect", "rollback-deepwell"])
            def capture(*args, cwd):
                calls.append(args)
                return ""
            with (
                mock.patch.object(REFRESH, "restore_parked_containers", side_effect=missing),
                mock.patch.object(REFRESH, "resource_exists", return_value=False),
                mock.patch.object(REFRESH, "command", side_effect=capture),
                mock.patch.object(REFRESH, "runtime_containers", return_value=restored),
            ):
                receipt = REFRESH.restore_or_recreate_previous_containers(
                    parked, runtime, runtime / "override.yaml", images
                )
            self.assertEqual(receipt["mode"], "recreated-from-pinned-images")
            self.assertEqual(sorted(receipt["missing_parked"]), sorted(REFRESH.SERVICES))
            self.assertEqual(len(calls), 1)
            command = calls[0]
            self.assertIn("--force-recreate", command)
            self.assertIn("--no-build", command)
            self.assertIn("--no-deps", command)
            self.assertEqual(command[command.index("--pull") + 1], "never")
            self.assertNotIn("down", command)
            self.assertNotIn("--volumes", command)
            self.assertNotIn("caddy", command)
            self.assertNotIn("database", command)

    def test_missing_parked_fallback_rejects_wrong_image_or_unpinned_environment(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            images = {service: {"id": "sha256:" + str(i + 1) * 64}
                      for i, service in enumerate(REFRESH.SERVICES)}
            env = {"STANDING_PROJECT_NAME": "wikijump-standing", **{
                f"STANDING_{s.upper()}_IMAGE": image["id"] for s, image in images.items()
            }}
            parked = {s: {"parked_name": f"parked-{s}"} for s in REFRESH.SERVICES}
            previous = {s: {"running": True, "image_id": images[s]["id"]}
                        for s in REFRESH.SERVICES}
            missing = subprocess.CalledProcessError(1, ["docker", "inspect"])
            for bad_env, bad_runtime in (
                ({**env, "STANDING_DEEPWELL_IMAGE": "sha256:" + "f" * 64}, previous),
                (env, {**previous, "deepwell": {"running": True, "image_id": "sha256:" + "f" * 64}}),
            ):
                REFRESH.write_environment(home / ".env", bad_env)
                with (
                    mock.patch.object(REFRESH, "restore_parked_containers", side_effect=missing),
                    mock.patch.object(REFRESH, "resource_exists", return_value=False),
                    mock.patch.object(REFRESH, "command", return_value="") as command,
                    mock.patch.object(REFRESH, "runtime_containers", return_value=bad_runtime),
                ):
                    with self.assertRaisesRegex(RuntimeError, "rollback image|previous image"):
                        REFRESH.restore_or_recreate_previous_containers(
                            parked, home, home / "override.yaml", images
                        )
                    self.assertEqual(command.call_count, 0 if bad_env != env else 1)

    def test_parked_identity_failure_never_silently_recreates(self) -> None:
        parked = {service: {"parked_name": service} for service in REFRESH.SERVICES}
        missing = subprocess.CalledProcessError(1, ["docker", "inspect"])
        with (
            mock.patch.object(REFRESH, "restore_parked_containers", side_effect=missing),
            mock.patch.object(REFRESH, "resource_exists", return_value=True),
            mock.patch.object(REFRESH, "command") as command,
        ):
            with self.assertRaises(subprocess.CalledProcessError):
                REFRESH.restore_or_recreate_previous_containers(
                    parked, Path("/runtime"), Path("/runtime/override.yaml"), {}
                )
            command.assert_not_called()

    def test_standing_runtime_uses_supported_release_profiles(self) -> None:
        compose = (SCRIPT.parent / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn("DEEPWELL_BUILD_PROFILE: release", compose)
        self.assertIn("WWS_BUILD_PROFILE: release", compose)
        self.assertIn(
            "DEEPWELL_RPC_TOKEN: ${DEEPWELL_RPC_TOKEN:?DEEPWELL_RPC_TOKEN is required}",
            compose,
        )

    def test_standing_runtime_labels_include_lifecycle_provenance(self) -> None:
        compose = (SCRIPT.parent / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn(
            "com.rokurolize.wikijump.lifecycle: prepared-exact-merged-head",
            compose,
        )

    def test_compose_restart_is_fixed_to_app_services_without_volume_flags(
        self,
    ) -> None:
        runtime_home = Path("/srv/wikijump-standing")
        command = REFRESH.compose_command(
            runtime_home,
            "up",
            "--detach",
            "--no-deps",
            "--no-build",
            *REFRESH.SERVICES,
            override_file=Path("/src/refresh.compose.yaml"),
        )
        self.assertEqual(
            command[-7:],
            [
                "up",
                "--detach",
                "--no-deps",
                "--no-build",
                "deepwell",
                "framerail",
                "wws",
            ],
        )
        self.assertNotIn("down", command)
        self.assertNotIn("-v", command)
        self.assertNotIn("--volumes", command)
        self.assertNotIn("--remove-volumes", command)

    def test_local_development_still_uses_watch_mode(self) -> None:
        deepwell_start = (
            SCRIPT.parents[1] / "local/deepwell/deepwell-start"
        ).read_text(encoding="utf-8")
        wws_start = (SCRIPT.parents[1] / "local/wws/wws-start").read_text(
            encoding="utf-8"
        )
        framerail_start = (
            SCRIPT.parents[1] / "local/framerail/framerail-start"
        ).read_text(encoding="utf-8")
        self.assertIn("cargo watch", deepwell_start)
        self.assertIn("cargo watch", wws_start)
        self.assertIn("pnpm dev", framerail_start)

    def test_expected_compiled_generator_is_source_derived(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            cargo = root / "deepwell" / "Cargo.lock"
            cargo.parent.mkdir(parents=True)
            cargo.write_text(
                '[[package]]\nname = "ftml"\nversion = "1.2.3+test"\n',
                encoding="utf-8",
            )
            generator = root / "deepwell" / "src" / "services" / "render" / "generator.rs"
            generator.parent.mkdir(parents=True)
            generator.write_text(
                "pub(crate) const DEEPWELL_RENDERER_EPOCH: u32 = 17;\n",
                encoding="utf-8",
            )
            self.assertEqual(
                REFRESH.expected_compiled_generator(root),
                "ftml v1.2.3+test; deepwell-render/v17",
            )

    def test_standing_deepwell_migrations_are_explicit_in_the_image(self) -> None:
        dockerfile = (SCRIPT.parents[1] / "prod/deepwell/Dockerfile").read_text(
            encoding="utf-8"
        )
        start = (SCRIPT.parents[1] / "prod/deepwell/deepwell-start").read_text(
            encoding="utf-8"
        )
        self.assertIn("cargo install sqlx-cli --version 0.9.0 --locked", dockerfile)
        self.assertIn("COPY ./deepwell/migrations /opt/deepwell/migrations", dockerfile)
        self.assertIn("sqlx migrate run --source /opt/deepwell/migrations", start)
        self.assertIn("exec /usr/local/bin/deepwell", start)

    def test_standing_deepwell_uses_image_locales_without_a_host_bind(self) -> None:
        compose = (SCRIPT.parent / "compose.yaml").read_text(encoding="utf-8")
        dockerfile = (SCRIPT.parents[1] / "prod/deepwell/Dockerfile").read_text(
            encoding="utf-8"
        )
        renderer_source = (SCRIPT.parent / "render.py").read_text(encoding="utf-8")
        refresher = SCRIPT.read_text(encoding="utf-8")

        self.assertIn("COPY ./locales/fluent /opt/locales/fluent", dockerfile)
        self.assertNotIn("target: /opt/locales", compose)
        self.assertNotIn("STANDING_LOCALES_SOURCE", compose)
        self.assertNotIn("STANDING_LOCALES_SOURCE", renderer_source)
        self.assertNotIn("STANDING_LOCALES_SOURCE", refresher)

    def test_standing_framerail_keeps_csrf_origin_checks_enabled(self) -> None:
        compose = (SCRIPT.parent / "compose.yaml").read_text(encoding="utf-8")
        dockerfile = (SCRIPT.parents[1] / "prod/framerail/Dockerfile").read_text(
            encoding="utf-8"
        )
        self.assertIn('FRAMERAIL_CSRF_CHECK_ORIGIN: "true"', compose)
        self.assertIn("ARG FRAMERAIL_CSRF_CHECK_ORIGIN=true", dockerfile)

    def test_environment_rewrite_is_atomic_and_preserves_unrelated_values(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            path = Path(temporary_dir) / ".env"
            path.write_text("KEEP=value\nSTANDING_WIKIJUMP_SHA=old\n", encoding="utf-8")
            values = REFRESH.read_environment(path)
            values["STANDING_WIKIJUMP_SHA"] = "new"
            REFRESH.write_environment(path, values)
            self.assertEqual(
                path.read_text(encoding="utf-8"),
                "KEEP=value\nSTANDING_WIKIJUMP_SHA=new\n",
            )
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_environment_rewrite_rejects_multiline_values_without_replacing_file(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            path = root / ".env"
            original = "KEEP=value\nSTANDING_DEEPWELL_IMAGE=verified\n"
            path.write_text(original, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "single-line environment value"):
                REFRESH.write_environment(
                    path,
                    {
                        "KEEP": "value",
                        "STANDING_RESOURCE_EXPIRY": (
                            "2026-09-05T12:34:56+00:00\nSTANDING_DEEPWELL_IMAGE=evil"
                        ),
                    },
                )
            self.assertEqual(path.read_text(encoding="utf-8"), original)
            self.assertEqual(list(root.glob("..env.*")), [])

    def test_runtime_differential_identity_binds_lock_image_and_compose_config(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            source_root = Path(temporary_dir)
            lock_path = source_root / "deepwell" / "Cargo.lock"
            lock_path.parent.mkdir()
            lock_path.write_bytes(b"locked dependencies\n")
            source_identity = {
                "wikijump_sha": "a" * 40,
                "ftml_sha": "b" * 40,
            }
            images = {"deepwell": {"id": f"sha256:{'c' * 64}"}}
            config = "services:\n  deepwell:\n    image: candidate\n"
            identity = REFRESH.runtime_differential_identity(
                source_root, source_identity, images, config
            )
            self.assertEqual(
                identity,
                {
                    "schema": "wikijump_syntax_differential.wikijump_runtime_identity.v1",
                    **source_identity,
                    "dependency_lock_sha256": hashlib.sha256(
                        b"locked dependencies\n"
                    ).hexdigest(),
                    "executable_sha256": "c" * 64,
                    "runtime_config_sha256": hashlib.sha256(
                        config.encode("utf-8")
                    ).hexdigest(),
                },
            )

    def test_runtime_differential_identity_rejects_non_digest_image_id(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            source_root = Path(temporary_dir)
            lock_path = source_root / "deepwell" / "Cargo.lock"
            lock_path.parent.mkdir()
            lock_path.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(
                ValueError, "Deepwell image identity is not one SHA-256 digest"
            ):
                REFRESH.runtime_differential_identity(
                    source_root,
                    {"wikijump_sha": "a" * 40, "ftml_sha": "b" * 40},
                    {"deepwell": {"id": "candidate"}},
                    "services: {}",
                )


if __name__ == "__main__":
    unittest.main()
