import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "capture_wikidot_py_forum_revisions.py"
SPEC = importlib.util.spec_from_file_location("capture_wikidot_py_forum_revisions", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class CaptureWikidotPyForumRevisionsSiteTest(unittest.TestCase):
    def test_accepts_only_the_run_owned_sandbox(self):
        self.assertEqual(MODULE.validate_site("sandbox-for-codex"), "sandbox-for-codex")

    def test_rejects_manifest_selected_external_sites(self):
        for site in ("scp-wiki", "scp-jp", "attacker.example"):
            with self.subTest(site=site), self.assertRaisesRegex(ValueError, "allowlist"):
                MODULE.validate_site(site)


if __name__ == "__main__":
    unittest.main()
