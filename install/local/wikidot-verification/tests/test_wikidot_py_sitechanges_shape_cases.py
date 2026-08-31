import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts" / "capture_wikidot_py_sitechanges_shape.py"
SPEC = importlib.util.spec_from_file_location("capture_wikidot_py_sitechanges_shape", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


CASES = Path(__file__).parents[1] / "fixtures" / "wikidot-py-sitechanges-shape" / "cases.json"


class WikidotPySiteChangesShapeCasesTest(unittest.TestCase):
    def test_pinned_fixture_loads(self):
        self.assertEqual(len(MODULE.load_cases(CASES)["cases"]), 9)

    def test_rejects_unauthorized_driver_and_module(self):
        cases = json.loads(CASES.read_text())
        cases["cases"][2]["driver"] = "Site.amc_request"
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as handle:
            json.dump(cases, handle)
            handle.flush()
            with self.assertRaisesRegex(ValueError, "unsupported driver"):
                MODULE.load_cases(Path(handle.name))

        cases = json.loads(CASES.read_text())
        cases["cases"][2]["body_fields_in_order"][0][1] = "admin/DeleteSiteModule"
        with tempfile.NamedTemporaryFile(mode="w+", suffix=".json") as handle:
            json.dump(cases, handle)
            handle.flush()
            with self.assertRaisesRegex(ValueError, "unexpected module"):
                MODULE.load_cases(Path(handle.name))


if __name__ == "__main__":
    unittest.main()
