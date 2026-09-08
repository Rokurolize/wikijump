from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest


SCRIPT = Path(__file__).parents[1] / "scripts" / "capture-open43-q1035-sitechanges-mutations.py"
SPEC = importlib.util.spec_from_file_location("q1035_sitechanges_mutation_probe", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SiteChangesMutationProbeTests(unittest.TestCase):
    def test_matching_rows_retains_only_run_owned_rows(self) -> None:
        body = """
        <div class="changes-list-item"><table><tr><td class="title"><a href="/foreign">Foreign</a></td><td class="flags"><span>N</span></td><td class="revision-no">(new)</td></tr></table></div>
        <div class="changes-list-item"><table><tr><td class="title"><a href="/run-owned:issue1035-20260908t080000z-abcd-moved">Owned</a></td><td class="flags"><span>S</span><span>T</span></td><td class="revision-no">(rev. 2)</td></tr></table><div class="comments">issue1035-20260908t080000z-abcd edit source title</div></div>
        """
        rows = MODULE.matching_rows(body, "issue1035-20260908t080000z-abcd")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["flags"], ["S", "T"])
        self.assertEqual(rows[0]["revision"], "(rev. 2)")
        self.assertIn("edit source title", rows[0]["comment"])

    def test_matching_rows_accepts_comment_marker_after_rename(self) -> None:
        body = """
        <div class="changes-list-item"><table><tr><td class="title"><a href="/renamed-without-marker">Renamed</a></td><td class="flags"><span>M</span></td><td class="revision-no">(rev. 3)</td></tr></table><div class="comments">issue1035-20260908t080000z-abcd move</div></div>
        """
        rows = MODULE.matching_rows(body, "issue1035-20260908t080000z-abcd")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["flags"], ["M"])


if __name__ == "__main__":
    unittest.main()
