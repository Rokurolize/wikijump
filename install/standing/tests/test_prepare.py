from __future__ import annotations

import hashlib
import importlib.util
import json
from contextlib import contextmanager
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


def promotion_precondition(
    root: Path,
    identity: dict[str, str],
    candidate_identity: dict[str, str] | None = None,
) -> dict[str, object]:
    candidate = candidate_identity or {
        "wikijump_sha": "9" * 40,
        "wikijump_tree": identity["wikijump_tree"],
        "ftml_sha": identity["ftml_sha"],
    }
    proof_path = root / "promotion-precondition.json"
    proof_path.write_text(json.dumps({
        "schema": PREPARE.PROMOTION_PRECONDITION_SCHEMA,
        "status": "pass",
        "run_id": "candidate-test-01",
        "candidate": {"artifact_key": "a" * 64, "wikijump_commit": candidate["wikijump_sha"], "wikijump_tree": candidate["wikijump_tree"], "ftml_sha": candidate["ftml_sha"]},
        "build": {"wikijump_commit": candidate["wikijump_sha"], "wikijump_tree": candidate["wikijump_tree"], "ftml_sha": candidate["ftml_sha"], "images": {service: "sha256:" + "e" * 64 for service in ("deepwell", "framerail", "wws")}},
    }), encoding="utf-8")
    return {"path": str(proof_path), "sha256": hashlib.sha256(proof_path.read_bytes()).hexdigest()}


@contextmanager
def merged_candidate(identity: dict[str, str], candidate_commit: str = "9" * 40):
    original_command = PREPARE.command
    PREPARE.command = lambda *args, cwd, capture=True: candidate_commit if args[1] == "merge-base" else " ".join((identity["wikijump_sha"], "8" * 40, candidate_commit))
    try:
        yield
    finally:
        PREPARE.command = original_command


class PrepareStandingImagesTest(unittest.TestCase):
    def test_promotion_precondition_accepts_a_candidate_ancestor_of_the_merged_tree(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            identity = {
                "wikijump_sha": "1" * 40,
                "wikijump_tree": "2" * 40,
                "ftml_sha": "3" * 40,
                "dependency_lock_sha256": "4" * 64,
            }
            candidate = {
                "wikijump_sha": "5" * 40,
                "wikijump_tree": identity["wikijump_tree"],
                "ftml_sha": identity["ftml_sha"],
            }
            proof_ref = promotion_precondition(root, identity, candidate)
            original_command = PREPARE.command
            try:
                PREPARE.command = lambda *args, cwd, capture=True: candidate["wikijump_sha"] if args[1] == "merge-base" else " ".join((identity["wikijump_sha"], "6" * 40, candidate["wikijump_sha"]))
                proof, actual_ref = PREPARE.load_promotion_precondition(
                    Path(proof_ref["path"]), root, identity
                )
                self.assertEqual(actual_ref, proof_ref)
                self.assertEqual(
                    proof["candidate"]["wikijump_commit"], candidate["wikijump_sha"]
                )
            finally:
                PREPARE.command = original_command

    def test_promotion_precondition_rejects_a_candidate_that_is_not_an_ancestor(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_dir:
            root = Path(temporary_dir)
            identity = {
                "wikijump_sha": "1" * 40,
                "wikijump_tree": "2" * 40,
                "ftml_sha": "3" * 40,
                "dependency_lock_sha256": "4" * 64,
            }
            candidate = {
                "wikijump_sha": "5" * 40,
                "wikijump_tree": identity["wikijump_tree"],
                "ftml_sha": identity["ftml_sha"],
            }
            proof_ref = promotion_precondition(root, identity, candidate)
            original_command = PREPARE.command
            try:
                PREPARE.command = lambda *args, cwd, capture=True: "7" * 40 if args[1] == "merge-base" else " ".join((identity["wikijump_sha"], "6" * 40, "7" * 40))
                with self.assertRaisesRegex(ValueError, "candidate is not an ancestor"):
                    PREPARE.load_promotion_precondition(
                        Path(proof_ref["path"]), root, identity
                    )
            finally:
                PREPARE.command = original_command

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

    def test_prepare_reuses_the_sealed_candidate_application_images(self) -> None:
        source = Path("/src/wikijump")
        candidate = {
            "wikijump_commit": "a" * 40,
            "wikijump_tree": "b" * 40,
            "ftml_sha": "c" * 40,
        }
        proof = {
            "candidate": candidate,
            "build": {
                **candidate,
                "images": {
                    service: "sha256:" + str(index) * 64
                    for index, service in enumerate(PREPARE.SERVICES, start=1)
                },
            },
        }
        original_identity = PREPARE.image_identity
        try:
            PREPARE.image_identity = lambda reference, cwd: {
                "reference": reference,
                "id": reference,
                "repo_digests": [],
                "labels": {
                    "com.rokurolize.wikijump.owner": "promotion-candidate-build",
                    "com.rokurolize.wikijump.sha": candidate["wikijump_commit"],
                    "com.rokurolize.wikijump.tree": candidate["wikijump_tree"],
                    "com.rokurolize.wikijump.ftml_sha": candidate["ftml_sha"],
                    "com.rokurolize.wikijump.profile": "production-build",
                },
            }
            images = PREPARE.prepare_candidate_images(proof, source)
        finally:
            PREPARE.image_identity = original_identity
        self.assertEqual(
            {service: image["id"] for service, image in images.items()},
            proof["build"]["images"],
        )
        self.assertEqual(
            {service: image["profile"] for service, image in images.items()},
            PREPARE.BUILD_PROFILES,
        )

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
            with merged_candidate(identity):
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
            with merged_candidate(identity):
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
            with merged_candidate(identity):
                with self.assertRaisesRegex(ValueError, "immutable image ID"):
                    PREPARE.validate_prepared_receipt(receipt, root, identity)


if __name__ == "__main__":
    unittest.main()
