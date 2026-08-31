import importlib.util
import sys
import types
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts/capture_wikidot_py_membership_applications.py"


class MembershipApplicationsCaptureSecurityTest(unittest.TestCase):
    def test_normalization_removes_profile_slug(self) -> None:
        httpx = types.ModuleType("httpx")
        wikidot = types.ModuleType("wikidot")
        wikidot.Client = object
        connector = types.ModuleType("wikidot.connector")
        ajax = types.ModuleType("wikidot.connector.ajax")
        ajax.AjaxModuleConnectorConfig = object
        sys.modules.update(
            {
                "httpx": httpx,
                "wikidot": wikidot,
                "wikidot.connector": connector,
                "wikidot.connector.ajax": ajax,
            }
        )
        spec = importlib.util.spec_from_file_location("capture", SCRIPT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)

        normalized = module.normalize_populated_body(
            'href="http://www.wikidot.com/user:info/bnhagzdn"',
            "marker",
            "Applicant",
            41,
        )

        self.assertIn("http://www.wikidot.com/user:info/RUN_OWNED_APPLICANT", normalized)
        self.assertNotIn("bnhagzdn", normalized)


if __name__ == "__main__":
    unittest.main()
