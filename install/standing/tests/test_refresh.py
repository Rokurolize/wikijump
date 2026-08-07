from __future__ import annotations

import importlib.util
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "refresh.py"
SPEC = importlib.util.spec_from_file_location("standing_refresh", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
REFRESH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REFRESH)


class RefreshStandingTest(unittest.TestCase):
    def prepared_receipt_fixture(
        self, root: Path, *, expiry: object = "2026-09-05T12:34:56.123456+00:00"
    ) -> tuple[dict[str, object], dict[str, str]]:
        for service in REFRESH.SERVICES:
            path = root / "install/prod" / service / "Dockerfile"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(service, encoding="utf-8")
        identity = {
            "wikijump_sha": "a" * 40,
            "wikijump_tree": "b" * 40,
            "ftml_sha": "c" * 40,
            "dependency_lock_sha256": "d" * 64,
        }
        receipt: dict[str, object] = {
            "schema_version": 1,
            "kind": "standing-image-preparation",
            "status": "pass",
            **identity,
            "dockerfiles": {
                service: hashlib.sha256(service.encode()).hexdigest()
                for service in REFRESH.SERVICES
            },
            "images": {
                service: {
                    "reference": REFRESH.image_reference(
                        identity["wikijump_sha"], service
                    ),
                    "id": "sha256:" + "e" * 64,
                    "profile": "release" if service != "framerail" else "built",
                }
                for service in REFRESH.SERVICES
            },
            "resource_disposition": {
                "owner": "standing-image-preparation",
                "expiry": expiry,
            },
        }
        return receipt, identity

    def test_standing_runtime_uses_supported_release_profiles(self) -> None:
        compose = (SCRIPT.parent / "compose.yaml").read_text(encoding="utf-8")
        self.assertIn("DEEPWELL_BUILD_PROFILE: release", compose)
        self.assertIn("WWS_BUILD_PROFILE: release", compose)
        self.assertIn("DEEPWELL_RPC_TOKEN: ${DEEPWELL_RPC_TOKEN:?DEEPWELL_RPC_TOKEN is required}", compose)

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

    def test_cli_rejects_every_volume_removal_spelling(self) -> None:
        for forbidden in ("-v", "--volumes", "--remove-volumes"):
            with self.subTest(forbidden=forbidden):
                result = subprocess.run(
                    (sys.executable, str(SCRIPT), "--prepared-receipt", "/tmp/absent", forbidden),
                    text=True,
                    capture_output=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unrecognized arguments", result.stderr)

    def test_activation_has_no_build_path_and_uses_prepared_references(self) -> None:
        source = SCRIPT.read_text(encoding="utf-8")
        self.assertNotIn("docker\", \"build", source)
        self.assertIn("--prepared-receipt", source)
        self.assertIn("--no-build", source)
        prepare = (SCRIPT.parent / "prepare.py").read_text(encoding="utf-8")
        self.assertIn('"install" / "prod" / service / "Dockerfile"', prepare)

    def test_local_development_still_uses_watch_mode(self) -> None:
        deepwell_start = (SCRIPT.parents[1] / "local/deepwell/deepwell-start").read_text(
            encoding="utf-8"
        )
        wws_start = (SCRIPT.parents[1] / "local/wws/wws-start").read_text(encoding="utf-8")
        framerail_start = (SCRIPT.parents[1] / "local/framerail/framerail-start").read_text(
            encoding="utf-8"
        )
        self.assertIn("cargo watch", deepwell_start)
        self.assertIn("cargo watch", wws_start)
        self.assertIn("pnpm dev", framerail_start)

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

    def test_prepared_receipt_rejects_mutable_or_wrong_image_reference(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            receipt, identity = self.prepared_receipt_fixture(root)
            images = receipt["images"]
            assert isinstance(images, dict)
            deepwell = images["deepwell"]
            assert isinstance(deepwell, dict)
            deepwell["reference"] = f'{deepwell["reference"]}:latest'
            path = root / "prepared.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "exact SHA-derived reference"):
                REFRESH.load_prepared_receipt(path, root, identity)

    def test_prepared_receipt_rejects_unsafe_resource_expiry(self) -> None:
        invalid_expiries: tuple[object, ...] = (
            "2026-09-05T12:34:56+00:00\nSTANDING_DEEPWELL_IMAGE=evil",
            "2026-09-05T12:34:56+00:00\rSTANDING_NETWORK_NAME=evil",
            "2026-09-05T12:34:56+00:00\x00suffix",
            "2026-09-05T12:34:56+00:00\tsuffix",
            " 2026-09-05T12:34:56+00:00",
            "2026-09-05T12:34:56+00:00 ",
            "2026-09-05T12:34:56",
            "not-a-timestamp",
            None,
            7,
        )
        for expiry in invalid_expiries:
            with self.subTest(expiry=expiry), tempfile.TemporaryDirectory() as temporary_dir:
                root = Path(temporary_dir)
                receipt, identity = self.prepared_receipt_fixture(root, expiry=expiry)
                path = root / "prepared.json"
                path.write_text(json.dumps(receipt), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "resource expiry"):
                    REFRESH.load_prepared_receipt(path, root, identity)

    def test_prepared_receipt_accepts_canonical_resource_expiry(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            receipt, identity = self.prepared_receipt_fixture(root)
            path = root / "prepared.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            loaded, _ = REFRESH.load_prepared_receipt(path, root, identity)
            self.assertEqual(
                loaded["resource_disposition"], receipt["resource_disposition"]
            )

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
                            "2026-09-05T12:34:56+00:00\n"
                            "STANDING_DEEPWELL_IMAGE=evil"
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
