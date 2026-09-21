import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "capture-issue1383-live-evidence.py"
sys.path.insert(0, str(SCRIPT.parent))
SPEC = importlib.util.spec_from_file_location("capture_issue1383_live_evidence", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CaptureIssue1383LiveEvidenceTest(unittest.TestCase):
    def test_mutating_capture_is_scoped_to_the_task_owned_disposable_site(self):
        import json

        self.assertEqual(MODULE.SITE, "wjc260907a1f7")
        self.assertEqual(MODULE.DOMAIN, "wjc260907a1f7.wikidot.com")
        self.assertEqual(MODULE.SAVED_SITE, "scpaiueouiuiuiui")
        self.assertEqual(MODULE.SAVED_DOMAIN, "scpaiueouiuiuiui.wikidot.com")
        plan = json.loads((Path(__file__).parents[1] / "fixtures" / "issue1383-live-evidence-plan.json").read_text(encoding="utf-8"))
        self.assertEqual(plan["site"], MODULE.SITE)
        self.assertEqual(plan["saved_site"], MODULE.SAVED_SITE)

    def test_run_owned_target_uses_exact_fullname_filter(self):
        source = MODULE.source_for(
            {
                "label": "section-zero",
                "section": 0,
                "opener": "html",
                "marker": "SECTION_ZERO_HTML",
            },
            "run-owned:issue-1383-example-target",
        )

        self.assertIn(
            '[[module ListPages category="*" fullname="run-owned:issue-1383-example-target" separate="no" wrapper="no"]]',
            source,
        )
        self.assertNotIn('ListPages name="run-owned:', source)

    def test_saved_control_uses_the_observed_self_selection_boundary(self):
        cases = [
            {
                "label": "section-zero",
                "section": 0,
                "opener": "html",
                "marker": "SECTION_ZERO_HTML",
            },
            {
                "label": "section-one",
                "section": 1,
                "opener": "html",
                "marker": "SECTION_ONE_HTML",
            },
        ]

        source = MODULE.saved_self_selection_source(cases)

        self.assertEqual(source.count('[[module ListPages limit="1" range="."]]'), 2)
        self.assertNotIn("fullname=", source)
        self.assertIn('[[%%content{0}%%html]]\n<b>SECTION_ZERO_HTML</b>', source)
        self.assertIn('[[%%content{1}%%html]]\n<b>SECTION_ONE_HTML</b>', source)

    def test_preview_only_receipt_marks_non_preview_surfaces_unresolved(self):
        rows = MODULE.preview_only_unresolved_rows(False, False)

        self.assertEqual(
            rows,
            [
                {
                    "surface": "listpages-target",
                    "status": "unresolved",
                    "reason": "preview-only capture does not create or read the target page for generated-row controls",
                },
                {
                    "surface": "saved-page",
                    "status": "unresolved",
                    "reason": "preview-only capture performs no saved-page read or mutation",
                },
                {
                    "surface": "actor",
                    "status": "unresolved",
                    "reason": "anonymous PagePreview capture does not observe actor behavior",
                },
                {
                    "surface": "browser",
                    "status": "unresolved",
                    "reason": "preview-only capture does not launch a browser",
                },
                {
                    "surface": "scanner",
                    "status": "unresolved",
                    "reason": "scanner result artifacts are unavailable",
                },
                {
                    "surface": "browser-dependency-tree",
                    "status": "unresolved",
                    "reason": "installed browser dependency tree is unavailable",
                },
            ],
        )


class CaptureIssue1383PlanFreshnessTest(unittest.TestCase):
    def test_plan_preserves_its_historical_source_identity(self):
        import json
        import re
        import subprocess

        repo_root = Path(__file__).parents[4]
        plan_path = (
            repo_root
            / "install/local/wikidot-verification/fixtures/issue1383-live-evidence-plan.json"
        )
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        source = plan["source"]
        self.assertRegex(source["owner_commit"], r"^[0-9a-f]{40}$")
        self.assertEqual(source["public_regression_commit"], source["owner_commit"])
        self.assertRegex(source["owner_tree"], r"^[0-9a-f]{40}$")
        self.assertRegex(source["owner_blob_sha1"], r"^[0-9a-f]{40}$")
        for value in (
            source["test_sha256"],
            source["test_body_sha256"],
            *(
                item["sha256"]
                for item in plan["authority"]["specifications"]
            ),
            plan["dependencies"]["cargo_manifest_sha256"],
            plan["dependencies"]["cargo_lock_sha256"],
            plan["browser"]["package_sha256"],
            plan["browser"]["lock_sha256"],
        ):
            self.assertIsNotNone(re.fullmatch(r"[0-9a-f]{64}", value))

        def git(*args: str) -> str:
            return subprocess.run(
                ["/usr/bin/git", "-C", str(repo_root), *args],
                check=True,
                text=True,
                stdout=subprocess.PIPE,
            ).stdout.strip()

        self.assertEqual(
            git("rev-parse", f'{source["owner_commit"]}^{{tree}}'),
            source["owner_tree"],
        )
        self.assertEqual(
            git("rev-parse", f'{source["owner_commit"]}:{source["owner_path"]}'),
            source["owner_blob_sha1"],
        )

    def test_plan_is_complete_only_with_retained_terminal_evidence(self):
        import json
        import hashlib

        repo_root = Path(__file__).parents[4]
        plan = json.loads(
            (
                repo_root
                / "install/local/wikidot-verification/fixtures/issue1383-live-evidence-plan.json"
            ).read_text(encoding="utf-8")
        )

        self.assertEqual(
            plan["current_result"],
            {
                "status": "complete",
                "reason": "source-bound preview, saved self-selection browser, iframe payload, scanner, and cleanup evidence is retained",
            },
        )
        self.assertEqual(
            [item["status"] for item in plan["scanner_checks"]],
            ["captured", "captured"],
        )
        self.assertEqual(
            plan["browser"]["installed_dependency_tree"]["status"],
            "captured",
        )
        terminal = plan["terminal_evidence"]
        terminal_path = repo_root / terminal["path"]
        self.assertTrue(terminal_path.is_file())
        self.assertEqual(hashlib.sha256(terminal_path.read_bytes()).hexdigest(), terminal["sha256"])
        receipt = json.loads(terminal_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "pass")
        self.assertEqual(receipt["wikijump_head"], terminal["wikijump_head"])


if __name__ == "__main__":
    unittest.main()
