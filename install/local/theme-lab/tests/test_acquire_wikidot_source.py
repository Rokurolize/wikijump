import importlib.util
import pathlib
import unittest


MODULE_PATH = (
    pathlib.Path(__file__).resolve().parents[1] / "scripts" / "acquire_wikidot_source.py"
)
SPEC = importlib.util.spec_from_file_location("acquire_wikidot_source", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AcquireWikidotSourceTests(unittest.TestCase):
    def test_url_is_restricted_to_public_https_wikidot(self):
        MODULE.validate_public_wikidot_url(
            "https://fondationscp.wikidot.com/theme:quand-le-soleil-se-couche"
        )
        for value in (
            "http://fondationscp.wikidot.com/theme:x",
            "https://127.0.0.1/theme:x",
            "https://example.com/theme:x",
            "https://user:pass@fondationscp.wikidot.com/theme:x",
            "https://fondationscp.wikidot.com:444/theme:x",
        ):
            with self.assertRaises(ValueError, msg=value):
                MODULE.validate_public_wikidot_url(value)

    def test_viewsource_decoding_preserves_source_markup_and_link_text(self):
        body = (
            '<h1>Code source</h1>\n<div class="page-source">\n\t'
            '[[include <a href="https://x.wikidot.com/component:y">:x:component:y</a>]]<br />\n'
            '&lt;div class=&quot;raw&quot;&gt;A &amp; B&lt;/div&gt;'
            "\n</div>"
        )
        self.assertEqual(
            MODULE.decode_viewsource_body(body),
            '[[include :x:component:y]]\n<div class="raw">A & B</div>',
        )

    def test_page_metadata_extracts_identity_revision_and_timestamp(self):
        page = """
        <script>
        WIKIREQUEST.info.siteId = 464696;
        WIKIREQUEST.info.pageUnixName = "theme:quand-le-soleil-se-couche";
        WIKIREQUEST.info.pageId = 1453535015;
        </script>
        <div id="page-info">révision de page: 13, édité la dernière fois:
        <span class="odate time_1754989771">12 Aug 2025 09:09</span></div>
        """
        metadata = MODULE.parse_page_metadata(page)
        self.assertEqual(metadata["site_id"], 464696)
        self.assertEqual(metadata["page_id"], 1453535015)
        self.assertEqual(metadata["slug"], "theme:quand-le-soleil-se-couche")
        self.assertEqual(metadata["revision"], 13)
        self.assertEqual(metadata["updated_at"], "2025-08-12T09:09:31Z")


if __name__ == "__main__":
    unittest.main()
