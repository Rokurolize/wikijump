from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "prepare.py"
SPEC = importlib.util.spec_from_file_location("standing_prepare", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


class PrepareStandingImagesTest(unittest.TestCase):
    def test_build_command_uses_production_image_tier_and_exact_sha_reference(self) -> None:
        source = Path("/src/wikijump")
        identity = {"wikijump_sha": "a" * 40, "ftml_sha": "b" * 40}
        for service in PREPARE.SERVICES:
            with self.subTest(service=service):
                reference = PREPARE.image_reference(identity["wikijump_sha"], service)
                command = PREPARE.build_command(
                    source, service, reference, identity, "2026-08-22T00:00:00+00:00"
                )
                self.assertIn(
                    str(source / "install" / "prod" / service / "Dockerfile"), command
                )
                self.assertIn("--tag", command)
                self.assertIn(reference, command)
                self.assertNotIn(":latest", command)

    def test_prepared_receipt_binds_profiles_and_dockerfiles(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            identity = {
                "wikijump_sha": "a" * 40,
                "wikijump_tree": "b" * 40,
                "ftml_sha": "c" * 40,
                "dependency_lock_sha256": "d" * 64,
            }
            dockerfiles = {}
            images = {}
            for service in PREPARE.SERVICES:
                path = root / "install/prod" / service / "Dockerfile"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(service, encoding="utf-8")
                dockerfiles[service] = hashlib.sha256(service.encode()).hexdigest()
                images[service] = {
                    "reference": PREPARE.image_reference(identity["wikijump_sha"], service),
                    "id": "sha256:" + "e" * 64,
                    "profile": PREPARE.BUILD_PROFILES[service],
                }
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                **identity,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            PREPARE.validate_prepared_receipt(receipt, root, identity)

    def test_prepared_receipt_rejects_a_mutable_tag(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            identity = {
                "wikijump_sha": "a" * 40,
                "wikijump_tree": "b" * 40,
                "ftml_sha": "c" * 40,
                "dependency_lock_sha256": "d" * 64,
            }
            dockerfiles = {}
            images = {}
            for service in PREPARE.SERVICES:
                path = root / "install/prod" / service / "Dockerfile"
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(service, encoding="utf-8")
                dockerfiles[service] = hashlib.sha256(service.encode()).hexdigest()
                images[service] = {
                    "reference": PREPARE.image_reference(identity["wikijump_sha"], service),
                    "id": "sha256:" + "e" * 64,
                    "profile": PREPARE.BUILD_PROFILES[service],
                }
            images["deepwell"]["reference"] += ":latest"
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                **identity,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            with self.assertRaisesRegex(ValueError, "exact SHA-derived reference"):
                PREPARE.validate_prepared_receipt(receipt, root, identity)


if __name__ == "__main__":
    unittest.main()
