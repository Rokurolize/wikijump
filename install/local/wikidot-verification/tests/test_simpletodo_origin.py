import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts/capture_wikidot_simpletodo_mutation.py"
SPEC = importlib.util.spec_from_file_location("simpletodo_capture", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SimpleTodoOriginTest(unittest.TestCase):
    def test_only_the_sandbox_origin_is_accepted(self):
        self.assertEqual(MODULE.validate_public_origin(MODULE.EXPECTED_PUBLIC_ORIGIN), MODULE.EXPECTED_PUBLIC_ORIGIN)
        for origin in ("http://127.0.0.1", "http://[::1]", "https://sandbox-for-codex.wikidot.com"):
            with self.assertRaises(SystemExit):
                MODULE.validate_public_origin(origin)


if __name__ == "__main__":
    unittest.main()
