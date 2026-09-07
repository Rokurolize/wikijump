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
    def test_plan_source_and_dependency_identities_match_head(self):
        import hashlib
        import json

        repo_root = Path(__file__).parents[4]
        plan_path = (
            repo_root
            / "install/local/wikidot-verification/fixtures/issue1383-live-evidence-plan.json"
        )
        plan = json.loads(plan_path.read_text(encoding="utf-8"))

        def sha256_bytes(path):
            return hashlib.sha256(Path(path).read_bytes()).hexdigest()

        # General identity binding: the plan must pin the exact current bytes
        # for the source owner, public regression, specs, and dependencies.
        # This guards against closing #1383 on a stale plan, not page content.
        expected = {
            "spec_listpages": sha256_bytes(
                repo_root
                / "docs/wikidot-specifications/specifications/module/module-listpages.md"
            ),
            "cargo_manifest": sha256_bytes(repo_root / "deepwell/Cargo.toml"),
            "cargo_lock": sha256_bytes(repo_root / "deepwell/Cargo.lock"),
            "browser_package": sha256_bytes(repo_root / "framerail/package.json"),
            "browser_lock": sha256_bytes(repo_root / "framerail/pnpm-lock.yaml"),
            "regression_test": sha256_bytes(
                repo_root / plan["source"]["test_path"]
            ),
        }
        actual = {
            "spec_listpages": plan["authority"]["specifications"][0]["sha256"],
            "cargo_manifest": plan["dependencies"]["cargo_manifest_sha256"],
            "cargo_lock": plan["dependencies"]["cargo_lock_sha256"],
            "browser_package": plan["browser"]["package_sha256"],
            "browser_lock": plan["browser"]["lock_sha256"],
            "regression_test": plan["source"]["test_sha256"],
        }
        self.assertEqual(actual, expected)

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
        terminal_path = Path(terminal["path"])
        self.assertTrue(terminal_path.is_file())
        self.assertEqual(hashlib.sha256(terminal_path.read_bytes()).hexdigest(), terminal["sha256"])
        receipt = json.loads(terminal_path.read_text(encoding="utf-8"))
        self.assertEqual(receipt["status"], "pass")
        self.assertEqual(receipt["wikijump_head"], terminal["wikijump_head"])


if __name__ == "__main__":
    unittest.main()
