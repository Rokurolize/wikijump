from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest


ROOT = Path(__file__).parents[1]
MODULE_PATH = ROOT / "scripts" / "open43_a1037_run_owned.py"
SPEC = importlib.util.spec_from_file_location("open43_a1037_run_owned", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

PREP_PATH = ROOT / "scripts" / "prepare_open43_a1037_run_owned.py"
PREP_SPEC = importlib.util.spec_from_file_location("prepare_open43_a1037_run_owned", PREP_PATH)
assert PREP_SPEC is not None and PREP_SPEC.loader is not None
sys.path.insert(0, str(ROOT / "scripts"))
PREP = importlib.util.module_from_spec(PREP_SPEC)
PREP_SPEC.loader.exec_module(PREP)


class FakeSource:
    def __init__(self, value: str) -> None:
        self.wiki_text = value


class FakePage:
    def __init__(self, identity: int, title: str, source: str) -> None:
        self.id = identity
        self.title = title
        self.source = FakeSource(source)
        self.destroyed = False

    def refresh_source(self) -> FakeSource:
        return self.source

    def destroy(self) -> None:
        self.destroyed = True


class FakePages:
    def __init__(self, page: FakePage | None) -> None:
        self.page = page

    def get(self, _slug: str, *, raise_when_not_found: bool = False) -> FakePage | None:
        if self.page is not None and self.page.destroyed:
            return None
        return self.page


class FakeSite:
    def __init__(self, page: FakePage | None) -> None:
        self.page = FakePages(page)


class RunOwnedContractTests(unittest.TestCase):
    def test_sources_are_run_bound_and_mailform_requires_controlled_recipient(self) -> None:
        run_id = "a1037-mailform-20260915t120000z-abcd"
        value = MODULE.descriptor(run_id=run_id, recipient_username="codex_sink")
        self.assertEqual(value["slug"], "run-owned:a1037-mailform-abcd")
        self.assertIn('MailForm to="codex_sink"', value["source"])
        self.assertEqual(value["source_sha256"], MODULE.sha256_text(value["source"]))
        with self.assertRaises(ValueError):
            MODULE.descriptor(run_id=run_id, recipient_username="sink@example.test")

    def test_simpletodo_descriptor_cannot_cross_lane(self) -> None:
        run_id = "a1037-simpletodo-20260915t120000z-abcd"
        value = MODULE.descriptor(run_id=run_id)
        self.assertEqual(value["lane"], "simpletodo")
        self.assertIn('SimpleToDo id="a1037-simpletodo-abcd"', value["source"])
        with self.assertRaises(ValueError):
            MODULE.descriptor(run_id=run_id, recipient_username="codex_sink")

    def test_cleanup_deletes_only_exact_identity_and_proves_absence(self) -> None:
        run_id = "a1037-simpletodo-20260915t120000z-abcd"
        plan = MODULE.descriptor(run_id=run_id)
        plan["identity"] = 2
        page = FakePage(plan["identity"], plan["title"], plan["source"])
        result = MODULE.remove_exact_page(FakeSite(page), plan, attempts=1)
        self.assertEqual(result["status"], "removed")
        self.assertTrue(page.destroyed)

    def test_cleanup_refuses_changed_source(self) -> None:
        run_id = "a1037-simpletodo-20260915t120000z-abcd"
        plan = MODULE.descriptor(run_id=run_id)
        plan["identity"] = 2
        page = FakePage(plan["identity"], plan["title"], "foreign source")
        with self.assertRaises(RuntimeError):
            MODULE.remove_exact_page(FakeSite(page), plan, attempts=1)
        self.assertFalse(page.destroyed)

    def test_descriptor_is_no_replace_and_validates_identity(self) -> None:
        run_id = "a1037-simpletodo-20260915t120000z-abcd"
        value = MODULE.descriptor(run_id=run_id)
        value["identity"] = 2
        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "descriptor.json"
            MODULE.write_no_replace(path, value)
            self.assertEqual(json.loads(path.read_text())["schema"], "wikijump.open43_a1037_run_owned_page.v1")
            with self.assertRaises(FileExistsError):
                MODULE.write_no_replace(path, value)
            with self.assertRaises(ValueError):
                MODULE.validate_descriptor({**value, "source_sha256": "0" * 64})
            with self.assertRaises(ValueError):
                MODULE.validate_descriptor({**value, "cleanup_contract": {}})

    def test_producer_cannot_reach_the_client_without_both_live_gates(self) -> None:
        with tempfile.TemporaryDirectory() as root:
            with self.assertRaises(RuntimeError):
                PREP.main([
                    "--run-id", "a1037-simpletodo-20260915t120000z-abcd",
                    "--output", str(Path(root) / "descriptor.json"),
                ])

    def test_positive_mutation_verifiers_require_delivery_and_exact_cleanup(self) -> None:
        mailform = {
            "schema": "wikijump.open43_a1037_mailform_mutation_receipt.v1",
            "run_id": "a1037-mailform-20260915t120000z-abcd",
            "lane": "mailform",
            "status": "pass",
            "positive_controls": ["C_DELIVERY_VALID_A"],
            "delivery_count": 1,
            "cleanup": {
                "status": "pass",
                "page_absent": True,
                "sink_baseline_zero": True,
                "sink_final_zero": True,
                "run_messages_deleted": True,
                "unexpected_message_count": 0,
            },
        }
        self.assertEqual(MODULE.validate_mailform_cleanup(mailform, run_id=mailform["run_id"])["verified"], True)
        mailform["cleanup"]["sink_final_zero"] = False
        with self.assertRaises(ValueError):
            MODULE.validate_mailform_cleanup(mailform, run_id=mailform["run_id"])

        todo = {
            "schema": "wikijump.open43_a1037_simpletodo_mutation_receipt.v1",
            "run_id": "a1037-simpletodo-20260915t120000z-abcd",
            "lane": "simpletodo",
            "status": "pass",
            "positive_controls": ["D_ADD_EDITOR_A"],
            "run_task_count_created": 1,
            "cleanup": {
                "status": "pass",
                "page_absent": True,
                "run_tasks_absent": True,
                "list_restored": True,
                "actor_readback_verified": True,
                "list_level_purge_verified": True,
                "baseline_list_sha256": "a" * 64,
                "final_list_sha256": "a" * 64,
            },
        }
        self.assertEqual(MODULE.validate_simpletodo_cleanup(todo, run_id=todo["run_id"])["verified"], True)
        todo["cleanup"]["final_list_sha256"] = "b" * 64
        with self.assertRaises(ValueError):
            MODULE.validate_simpletodo_cleanup(todo, run_id=todo["run_id"])

    def test_positive_mutation_verifiers_reject_private_material(self) -> None:
        receipt = {
            "schema": "wikijump.open43_a1037_mailform_mutation_receipt.v1",
            "run_id": "a1037-mailform-20260915t120000z-abcd",
            "lane": "mailform",
            "status": "pass",
            "positive_controls": ["C_DELIVERY_VALID_A"],
            "delivery_count": 1,
            "email": "not-to-be-recorded@example.test",
            "cleanup": {
                "status": "pass",
                "page_absent": True,
                "sink_baseline_zero": True,
                "sink_final_zero": True,
                "run_messages_deleted": True,
                "unexpected_message_count": 0,
            },
        }
        with self.assertRaises(ValueError):
            MODULE.validate_mailform_cleanup(receipt, run_id=receipt["run_id"])


if __name__ == "__main__":
    unittest.main()
