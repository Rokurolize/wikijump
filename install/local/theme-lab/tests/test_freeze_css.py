import hashlib
import json
import tempfile
import unittest
from pathlib import Path
import importlib.util

SCRIPT = Path(__file__).parents[1] / "ports" / "scripts" / "freeze-css.py"
SPEC = importlib.util.spec_from_file_location("freeze_css", SCRIPT)
freeze_css = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(freeze_css)


class PlainTextImportedCssTests(unittest.TestCase):
    def test_wikidot_text_plain_css_import_is_flattened(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / "cache"
            digest = hashlib.sha256(b".legacy { color: #123; }").hexdigest()
            object_path = cache / "objects" / digest[:2] / digest
            object_path.parent.mkdir(parents=True)
            object_path.write_bytes(b".legacy { color: #123; }")
            (cache / "manifest.json").write_text(json.dumps({"urls": {"https://local.invalid/theme-code": {"digest": digest}}, "objects": {digest: {"content_type": "text/plain"}}}))
            engine = freeze_css.CacheCSS(cache, root / "assets")
            css, receipt = engine.build('@import url("https://local.invalid/theme-code");', "https://local.invalid/page")
            self.assertIn(".legacy { color: #123; }", css)
            self.assertEqual(receipt["missing"], [])

    def test_plain_text_prose_is_not_accepted_as_css(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cache = root / "cache"
            body = b"No such page"
            digest = hashlib.sha256(body).hexdigest()
            object_path = cache / "objects" / digest[:2] / digest
            object_path.parent.mkdir(parents=True)
            object_path.write_bytes(body)
            (cache / "manifest.json").write_text(json.dumps({"urls": {"https://local.invalid/theme-code": {"digest": digest}}, "objects": {digest: {"content_type": "text/plain"}}}))
            engine = freeze_css.CacheCSS(cache, root / "assets")
            css, receipt = engine.build('@import url("https://local.invalid/theme-code");', "https://local.invalid/page")
            self.assertNotIn("No such page", css)
            self.assertEqual(receipt["missing"][0]["reason"], "import-not-css:text/plain")


if __name__ == "__main__":
    unittest.main()
