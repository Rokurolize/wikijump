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


if __name__ == "__main__":
    unittest.main()
