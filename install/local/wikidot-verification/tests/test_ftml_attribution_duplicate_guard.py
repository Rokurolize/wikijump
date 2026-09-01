import json
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).parents[1] / "scripts/capture_pr1334_ftml_lexical_text_attribution.py"
NAMESPACE = {}
exec(compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec"), NAMESPACE)


class FtmlAttributionDuplicateGuardTest(unittest.TestCase):
    def test_guard_scans_worktree_artifacts_not_only_git_index(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact_root = root / "install/local/wikidot-verification/artifacts"
            artifact_root.mkdir(parents=True)
            (artifact_root / "newer.json").write_text(
                json.dumps({
                    "schema": "wikijump.pr1334.ftml_lexical_text_attribution.v1",
                    "surface_ids": ["catalog-feature:syntax-paragraphs-and-newline"],
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "newer.json"):
                NAMESPACE["validate_prior_artifacts"](
                    root, ["catalog-feature:syntax-paragraphs-and-newline"]
                )


if __name__ == "__main__":
    unittest.main()
