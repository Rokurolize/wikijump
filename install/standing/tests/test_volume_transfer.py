from __future__ import annotations

import json
import sys
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest import mock


STANDING_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(STANDING_ROOT))

import volume_transfer as transfer  # noqa: E402


def digest(value: str = "a") -> dict[str, object]:
    return {
        "tree_sha256": value * 64,
        "entries": 12,
        "logical_file_bytes": 345,
    }


class VolumeTransferTest(unittest.TestCase):
    def test_load_migration_receipt_requires_all_canonical_equal_digests(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            receipt = root / "migration.json"
            receipt.write_text(
                json.dumps(
                    {
                        "schema": transfer.SCHEMA,
                        "status": "verified",
                        "roles": [
                            {
                                "role": role,
                                "legacy_volume": transfer.LEGACY_VOLUMES[role],
                                "durable_volume": transfer.DURABLE_VOLUMES[role],
                                "source_before": digest(role[0]),
                                "source_after": digest(role[0]),
                                "destination_after": digest(role[0]),
                            }
                            for role in transfer.ROLES
                        ],
                    }
                ),
                encoding="utf-8",
            )
            loaded = transfer.load_migration_receipt(receipt)
            self.assertEqual(loaded["status"], "verified")

            value = json.loads(receipt.read_text(encoding="utf-8"))
            value["roles"][1]["destination_after"]["entries"] = 13
            receipt.write_text(json.dumps(value), encoding="utf-8")
            with self.assertRaisesRegex(
                transfer.VolumeTransferError, "digest mismatch for files"
            ):
                transfer.load_migration_receipt(receipt)

    def test_migrate_copies_each_legacy_role_and_keeps_rollback_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary).resolve() / "migration.json"
            copies: list[tuple[str, str, str]] = []
            created: list[tuple[str, bool]] = []
            tree_calls: dict[str, int] = {}

            def tree(_image: str, volume: str) -> dict[str, object]:
                tree_calls[volume] = tree_calls.get(volume, 0) + 1
                role = next(
                    role
                    for role in transfer.ROLES
                    if volume
                    in {
                        transfer.LEGACY_VOLUMES[role],
                        transfer.DURABLE_VOLUMES[role],
                    }
                )
                return digest(role[0])

            with (
                mock.patch.object(transfer, "require_quiesced"),
                mock.patch.object(transfer, "volume_exists", return_value=True),
                mock.patch.object(
                    transfer, "resolve_helper_image", return_value="sha256:" + "f" * 64
                ),
                mock.patch.object(
                    transfer,
                    "create_durable_volume",
                    side_effect=lambda role, replace: (
                        created.append((role, replace)),
                        transfer.DURABLE_VOLUMES[role],
                    )[1],
                ),
                mock.patch.object(transfer, "tree_digest", side_effect=tree),
                mock.patch.object(
                    transfer,
                    "copy_volume",
                    side_effect=lambda image, source, destination: copies.append(
                        (image, source, destination)
                    ),
                ),
            ):
                status = transfer.migrate(
                    Namespace(
                        receipt=receipt,
                        helper_image=None,
                        replace_destinations=False,
                    )
                )

            self.assertEqual(status, 0)
            value = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(value["status"], "verified")
            self.assertTrue(value["legacy_retained"])
            self.assertEqual(created, [(role, False) for role in transfer.ROLES])
            self.assertEqual(
                [(source, destination) for _, source, destination in copies],
                [
                    (transfer.LEGACY_VOLUMES[role], transfer.DURABLE_VOLUMES[role])
                    for role in transfer.ROLES
                ],
            )
            for role in transfer.ROLES:
                self.assertEqual(tree_calls[transfer.LEGACY_VOLUMES[role]], 2)
                self.assertEqual(tree_calls[transfer.DURABLE_VOLUMES[role]], 1)

    def test_migrate_writes_failed_receipt_without_deleting_partial_destination(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            receipt = Path(temporary).resolve() / "migration.json"
            with (
                mock.patch.object(transfer, "require_quiesced"),
                mock.patch.object(transfer, "volume_exists", return_value=True),
                mock.patch.object(
                    transfer, "resolve_helper_image", return_value="sha256:" + "f" * 64
                ),
                mock.patch.object(
                    transfer,
                    "create_durable_volume",
                    return_value=transfer.DURABLE_VOLUMES["database"],
                ),
                mock.patch.object(
                    transfer, "tree_digest", side_effect=transfer.VolumeTransferError("boom")
                ),
            ):
                with self.assertRaisesRegex(transfer.VolumeTransferError, "boom"):
                    transfer.migrate(
                        Namespace(
                            receipt=receipt,
                            helper_image=None,
                            replace_destinations=False,
                        )
                    )
            value = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(value["status"], "failed")
            self.assertEqual(
                value["created_destinations"],
                [transfer.DURABLE_VOLUMES["database"]],
            )

    def test_post_cutover_requires_durable_mounts_and_retained_legacy_volumes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            receipt = root / "migration.json"
            output = root / "cutover.json"
            receipt.write_text(
                json.dumps(
                    {
                        "schema": transfer.SCHEMA,
                        "status": "verified",
                        "roles": [
                            {
                                "role": role,
                                "legacy_volume": transfer.LEGACY_VOLUMES[role],
                                "durable_volume": transfer.DURABLE_VOLUMES[role],
                                "source_before": digest(role[0]),
                                "source_after": digest(role[0]),
                                "destination_after": digest(role[0]),
                            }
                            for role in transfer.ROLES
                        ],
                    }
                ),
                encoding="utf-8",
            )
            running = [
                f"{transfer.PROJECT_NAME}-{role}-1"
                for role in ("database", "files", "cache", "deepwell", "framerail", "wws", "caddy")
            ]
            durable_consumers = [
                {
                    "name": f"{transfer.PROJECT_NAME}-{role}-1",
                    "running": True,
                    "volumes": [transfer.DURABLE_VOLUMES[role]],
                }
                for role in transfer.ROLES
            ]

            def consumers(names: set[str]) -> list[dict[str, object]]:
                return durable_consumers if names == set(transfer.DURABLE_VOLUMES.values()) else []

            with (
                mock.patch.object(
                    transfer, "running_project_containers", return_value=running
                ),
                mock.patch.object(transfer, "volume_consumers", side_effect=consumers),
                mock.patch.object(transfer, "volume_exists", return_value=True),
            ):
                status = transfer.post_cutover(
                    Namespace(receipt=receipt, output=output)
                )
            self.assertEqual(status, 0)
            value = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(value["status"], "pass")
            self.assertTrue(value["legacy_retained"])

    def test_archive_manifest_rejects_unknown_compression(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            (root / "database.tar").write_bytes(b"archive")
            rows = []
            for role in transfer.ARCHIVE_ROLES:
                archive = root / f"{role}.tar"
                archive.write_bytes(b"archive")
                rows.append(
                    {
                        "role": role,
                        "volume": transfer.ARCHIVE_VOLUMES[role],
                        "tree": digest("a"),
                        "archive": archive.name,
                        "archive_sha256": transfer.sha256_file(archive),
                        "compression": "brotli" if role == "files" else "none",
                    }
                )
            (root / "manifest.json").write_text(
                json.dumps(
                    {
                        "schema": transfer.ARCHIVE_SCHEMA,
                        "status": "sealed",
                        "roles": rows,
                    }
                ),
                encoding="utf-8",
            )
            with (
                mock.patch.object(
                    transfer, "resolve_helper_image", return_value="sha256:" + "f" * 64
                ),
                mock.patch.object(transfer, "volume_exists", return_value=False),
            ):
                with self.assertRaisesRegex(
                    transfer.VolumeTransferError, "unsupported archive compression"
                ):
                    transfer.restore(Namespace(input_dir=root, helper_image="image"))


if __name__ == "__main__":
    unittest.main()
