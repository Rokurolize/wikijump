import importlib.util
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "ports" / "scripts" / "backfill-import-provenance.py"
SPEC = importlib.util.spec_from_file_location("backfill_import_provenance", SCRIPT)
backfill = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backfill)


class RetrospectiveNormalizationTests(unittest.TestCase):
    def test_normalizes_crlf_and_ignores_non_provenance_comments(self):
        left = "/* upstream note */\r\n#a { color: red; }\r\n"
        right = "#a { color: red; }\n"
        self.assertEqual(
            backfill.normalize_css_for_retrospective_proof(left),
            backfill.normalize_css_for_retrospective_proof(right),
        )

    def test_retains_scp_jp_marker_comments(self):
        lines = backfill.normalize_css_for_retrospective_proof(
            "/* SCP-JP acceptance: sample */\n#a { color: red; }\n"
        )
        self.assertIn("/* SCP-JP acceptance: sample */", lines)

    def test_comment_tokens_inside_strings_are_not_removed(self):
        lines = backfill.normalize_css_for_retrospective_proof(
            'a::before { content: "/* not a comment */"; }\n'
        )
        self.assertEqual(lines, ['a::before { content: "/* not a comment */"; }'])


if __name__ == "__main__":
    unittest.main()
