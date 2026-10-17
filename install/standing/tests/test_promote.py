from __future__ import annotations

import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


sys.path.insert(0, str(Path(__file__).parents[1]))
import promote  # noqa: E402


TREE = "a" * 40
OTHER = "b" * 40
NOTHING = {group: False for group in promote.GROUPS}


def receipt(tree: str, groups: dict[str, bool], **overrides) -> dict[str, object]:
    return {
        "schema": promote.VALIDATION_SCHEMA,
        "status": "pass",
        "mode": "final",
        "wikijump_tree": tree,
        "groups": groups,
        "checks": [{"name": "deepwell full tests", "status": "ok"}],
        **overrides,
    }


class ValidationCoverageTest(unittest.TestCase):
    def coverage(self, required, receipts, delta=NOTHING):
        calls = []

        def delta_groups(other):
            calls.append(other)
            return delta

        covered, missing = promote.validation_coverage(
            required, TREE, [(Path(f"/store/{i}.json"), r) for i, r in enumerate(receipts)], delta_groups
        )
        return covered, missing, calls

    def test_a_receipt_for_the_same_tree_covers_its_groups(self) -> None:
        covered, missing, calls = self.coverage(
            {**NOTHING, "deepwell": True}, [receipt(TREE, {"deepwell": True})]
        )
        self.assertEqual(missing, [])
        self.assertEqual(covered["deepwell"]["tree"], TREE)
        self.assertEqual(calls, [], "the same tree needs no diff")

    def test_another_tree_covers_a_group_its_difference_does_not_select(self) -> None:
        covered, missing, _ = self.coverage(
            {**NOTHING, "deepwell": True, "framerail": True},
            [receipt(OTHER, {"deepwell": True, "framerail": True})],
            delta={**NOTHING, "framerail": True},
        )
        self.assertEqual(sorted(covered), ["deepwell"])
        self.assertEqual(missing, ["framerail"])

    def test_a_receipt_that_did_not_run_a_group_does_not_cover_it(self) -> None:
        _, missing, _ = self.coverage(
            {**NOTHING, "deepwell": True}, [receipt(TREE, {"deepwell": False, "verification": True})]
        )
        self.assertEqual(missing, ["deepwell"])

    def test_groups_the_change_does_not_select_need_nothing(self) -> None:
        covered, missing, _ = self.coverage(NOTHING, [])
        self.assertEqual((covered, missing), ({}, []))

    def test_only_passing_final_receipts_with_every_check_ok_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory)
            rows = {
                "good": receipt(TREE, {"deepwell": True}),
                "failed": receipt(TREE, {"deepwell": True}, status="fail"),
                "checkpoint": receipt(TREE, {"deepwell": True}, mode="checkpoint"),
                "failed-check": receipt(TREE, {"deepwell": True}, checks=[{"name": "x", "status": "failed"}]),
                "no-checks": receipt(TREE, {"deepwell": True}, checks=[]),
                "other-schema": receipt(TREE, {"deepwell": True}, schema="x"),
            }
            for name, row in rows.items():
                (store / f"{name}.json").write_text(json.dumps(row), encoding="utf-8")
            (store / "broken.json").write_text("{", encoding="utf-8")
            self.assertEqual([path.stem for path, _ in promote.validation_receipts(store)], ["good"])

    def test_a_missing_store_has_no_receipts(self) -> None:
        self.assertEqual(promote.validation_receipts(Path("/nonexistent/store")), [])


class RehearsalReasonTest(unittest.TestCase):
    def test_new_migrations_are_rehearsed_because_they_cannot_be_undone(self) -> None:
        self.assertEqual(
            promote.rehearsal_reason("auto", ["deepwell/migrations/x.sql"]),
            "the schema migrations change",
        )

    def test_an_undoable_activation_is_not_rehearsed_unless_requested(self) -> None:
        self.assertIsNone(promote.rehearsal_reason("auto", []))
        self.assertEqual(promote.rehearsal_reason("always", []), "requested")


class BrowserReferenceTest(unittest.TestCase):
    def reference(self, directory: Path, ledger_bytes: bytes, recorded: str | None = None) -> None:
        (directory / "ledger.json").write_bytes(ledger_bytes)
        (directory / "reference.json").write_text(
            json.dumps(
                {
                    "schema": promote.BROWSER_REFERENCE_SCHEMA,
                    "live_completion_policy": "policy.json",
                    "live_reference_ledger": "ledger.json",
                    "live_reference_sha256": recorded or hashlib.sha256(ledger_bytes).hexdigest(),
                    "source_response_cache_dir": "/cache",
                    "source_response_cache_identity": "cache-v1",
                    "browser_executable": "/usr/bin/google-chrome",
                }
            ),
            encoding="utf-8",
        )

    def test_the_retained_reference_resolves_relative_to_its_home(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.reference(home, b"{}")
            reference = promote.browser_reference(home)
            self.assertEqual(reference["ledger"], str(home / "ledger.json"))
            self.assertEqual(reference["policy"], str(home / "policy.json"))

    def test_a_changed_reference_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.reference(home, b"{}", recorded="0" * 64)
            with self.assertRaisesRegex(ValueError, "does not match"):
                promote.browser_reference(home)


class ActivationSafetyTest(unittest.TestCase):
    def test_the_cli_has_no_volume_removal_spelling(self) -> None:
        script = Path(promote.__file__)
        for forbidden in ("-v", "--volumes", "--remove-volumes"):
            with self.subTest(forbidden=forbidden):
                result = subprocess.run(
                    (sys.executable, str(script), forbidden), text=True, capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unrecognized arguments", result.stderr)

    def test_activation_starts_built_images_without_building_or_touching_volumes(self) -> None:
        source = inspect.getsource(promote.activate)
        self.assertIn('"up", "--detach", "--no-deps", "--no-build", *SERVICES', source)
        self.assertNotIn("docker\", \"build", source)
        self.assertNotIn('"down"', source)
        self.assertNotIn("--volumes", source)

    def test_activation_requires_fresh_saved_pages_before_the_canary(self) -> None:
        source = inspect.getsource(promote.activate)
        self.assertLess(
            source.index("saved_page_staleness(STANDING_DATABASE"),
            source.index("http_canary(refresh.CANARY_URL)"),
        )
        self.assertIn("standing serves {stale} stale saved pages", source)

    def test_rehearsal_teardown_only_names_rehearsal_resources(self) -> None:
        source = inspect.getsource(promote.rehearse)
        self.assertIn('project = f"wjcand-rehearsal-{target[:12]}"', source)
        self.assertIn('"down", "--volumes"', source)
        self.assertNotIn("wikijump-standing", source)


if __name__ == "__main__":
    unittest.main()
