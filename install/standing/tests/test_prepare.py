from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys


SCRIPT = Path(__file__).parents[1] / "prepare.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("standing_prepare", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


def promotion_precondition(root: Path, identity: dict[str, str]) -> dict[str, object]:
    proof_path = root / "promotion-precondition.json"
    proof_path.write_text(json.dumps({
        "schema": PREPARE.PROMOTION_PRECONDITION_SCHEMA,
        "status": "pass",
        "run_id": "candidate-test-01",
        "candidate": {"artifact_key": "a" * 64, "wikijump_commit": identity["wikijump_sha"], "wikijump_tree": identity["wikijump_tree"], "ftml_sha": identity["ftml_sha"]},
        "build": {"wikijump_commit": identity["wikijump_sha"], "wikijump_tree": identity["wikijump_tree"], "ftml_sha": identity["ftml_sha"], "images": {service: "sha256:" + "e" * 64 for service in ("deepwell", "framerail", "wws")}},
    }), encoding="utf-8")
    return {"path": str(proof_path), "sha256": hashlib.sha256(proof_path.read_bytes()).hexdigest()}


class PrepareStandingImagesTest(unittest.TestCase):
    def test_prepare_rejects_existing_output_before_identity_or_build(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            original_argv = sys.argv
            original_identity = PREPARE.repository_identity
            try:
                PREPARE.repository_identity = lambda _root: (_ for _ in ()).throw(AssertionError("identity was read"))
                for kind in ("file", "broken symlink"):
                    with self.subTest(kind=kind):
                        output = Path(temporary_dir) / f"prepared-{kind.replace(' ', '-')}.json"
                        if kind == "file":
                            output.write_text("existing", encoding="utf-8")
                        else:
                            output.symlink_to(Path(temporary_dir) / "missing.json")
                        sys.argv = [str(SCRIPT), "--output", str(output), "--promotion-precondition", str(output)]
                        with self.assertRaisesRegex(ValueError, "output already exists"):
                            PREPARE.main()
            finally:
                PREPARE.repository_identity = original_identity
                sys.argv = original_argv

    def test_build_command_uses_production_image_tier_and_iidfile(self) -> None:
        source = Path("/src/wikijump")
        iidfile = Path("/tmp/deepwell.iid")
        identity = {"wikijump_sha": "a" * 40, "ftml_sha": "b" * 40}
        for service in PREPARE.SERVICES:
            with self.subTest(service=service):
                command = PREPARE.build_command(
                    source, service, iidfile, identity, "2026-08-22T00:00:00+00:00"
                )
                self.assertIn(
                    str(source / "install" / "prod" / service / "Dockerfile"), command
                )
                self.assertIn("--iidfile", command)
                self.assertIn(str(iidfile), command)
                self.assertNotIn("--tag", command)

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
                    "id": "sha256:" + "e" * 64,
                    "reference": "sha256:" + "e" * 64,
                    "profile": PREPARE.BUILD_PROFILES[service],
                }
            proof = promotion_precondition(root, identity)
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                "run_id": "candidate-test-01",
                **identity,
                "promotion_precondition": proof,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            PREPARE.validate_prepared_receipt(receipt, root, identity)

    def test_prepared_receipt_rejects_a_different_candidate_run_id(self) -> None:
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
                    "id": "sha256:" + "e" * 64,
                    "reference": "sha256:" + "e" * 64,
                    "profile": PREPARE.BUILD_PROFILES[service],
                }
            proof = promotion_precondition(root, identity)
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                "run_id": "candidate-run-other",
                **identity,
                "promotion_precondition": proof,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            with self.assertRaisesRegex(ValueError, "run ID"):
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
                    "id": "sha256:" + "e" * 64,
                    "reference": "sha256:" + "e" * 64,
                    "profile": PREPARE.BUILD_PROFILES[service],
                }
            proof = promotion_precondition(root, identity)
            images["deepwell"]["reference"] = "local/replaceable:latest"
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                "run_id": "candidate-test-01",
                **identity,
                "promotion_precondition": proof,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            with self.assertRaisesRegex(ValueError, "immutable image ID"):
                PREPARE.validate_prepared_receipt(receipt, root, identity)


if __name__ == "__main__":
    unittest.main()
