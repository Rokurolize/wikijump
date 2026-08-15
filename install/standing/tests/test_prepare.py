from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).parents[1] / "prepare.py"
SPEC = importlib.util.spec_from_file_location("standing_prepare", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
PREPARE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREPARE)


def candidate_proof(root: Path, identity: dict[str, str]) -> dict[str, object]:
    identity_path = root / "candidate-identity.json"
    identity_path.write_text(
        json.dumps({
            "schema": "wikijump.standing_candidate_parity_identity.v1",
            "status": "sealed",
            "candidate": {
                "run_id": "candidate-test-01",
                "wikijump_commit": identity["wikijump_sha"],
                "wikijump_tree": identity["wikijump_tree"],
                "ftml_sha": identity["ftml_sha"],
            },
        }),
        encoding="utf-8",
    )
    identity_sha = hashlib.sha256(identity_path.read_bytes()).hexdigest()
    proof_path = root / "activation-receipt.json"
    proof_path.write_text(
        json.dumps({
            "schema": "wikijump.merge_build_candidate_activation.v1",
            "status": "pass",
            "run_id": "candidate-test-01",
            "candidate_identity": {"path": str(identity_path), "sha256": identity_sha},
        }),
        encoding="utf-8",
    )
    return {
        "path": str(proof_path),
        "sha256": hashlib.sha256(proof_path.read_bytes()).hexdigest(),
        "run_id": "candidate-test-01",
        "candidate_identity": {"path": str(identity_path), "sha256": identity_sha},
    }


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
            proof = candidate_proof(root, identity)
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                "run_id": proof["run_id"],
                **identity,
                "candidate_proof": proof,
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
            proof = candidate_proof(root, identity)
            images["deepwell"]["reference"] += ":latest"
            receipt = {
                "schema_version": 1,
                "kind": "standing-image-preparation",
                "status": "pass",
                "run_id": proof["run_id"],
                **identity,
                "candidate_proof": proof,
                "dockerfiles": dockerfiles,
                "images": images,
            }
            with self.assertRaisesRegex(ValueError, "exact SHA-derived reference"):
                PREPARE.validate_prepared_receipt(receipt, root, identity)


if __name__ == "__main__":
    unittest.main()
