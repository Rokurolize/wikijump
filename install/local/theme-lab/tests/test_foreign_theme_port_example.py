import hashlib
import json
import pathlib
import subprocess
import tempfile
import unittest


REPO = pathlib.Path(__file__).resolve().parents[4]
PORT = REPO / "install/local/theme-lab/ports/quand-le-soleil-se-couche"


def sha256(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ForeignThemePortExampleTests(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads((PORT / "manifest.json").read_text())
        self.receipt = json.loads((PORT / "receipt.json").read_text())

    def test_frozen_source_and_asset_provenance_matches_manifest(self):
        self.assertEqual(
            sha256(PORT / "upstream-fr.wikidot.txt"),
            self.manifest["source_sha256"],
        )
        self.assertEqual(
            sha256(PORT / "upstream-ko.wikidot.txt"),
            self.manifest["cross_branch_reference"]["source_sha256"],
        )
        self.assertEqual(
            sha256(PORT / "current-jp-hub.wikidot.txt"),
            self.manifest["current_jp_usage"]["source_sha256"],
        )
        for row in self.manifest["showcase_dependency_evidence"]:
            self.assertEqual(sha256(PORT / row["file"]), row["sha256"])
        for row in self.manifest["assets"]:
            path = PORT / "assets" / row["name"]
            self.assertEqual(path.stat().st_size, row["bytes"])
            self.assertEqual(sha256(path), row["sha256"])

    def test_publish_template_validation_css_and_build_stay_bound(self):
        template = (PORT / "candidate-template.css").read_text()
        validation = (PORT / "candidate.css").read_text()
        self.assertIn('{$sous-titre}', template)
        self.assertEqual(
            validation,
            template.replace('{$sous-titre}', '夜明けまで忘れるな'),
        )

        with tempfile.TemporaryDirectory() as temp_dir:
            output = pathlib.Path(temp_dir) / "demo.wikidot.txt"
            completed = subprocess.run(
                ["node", str(PORT / "build.mjs"), str(output)],
                cwd=REPO,
                check=True,
                text=True,
                capture_output=True,
            )
            build = json.loads(completed.stdout)
            theme = output.with_name("demo-theme.wikidot.txt")
            self.assertEqual(theme.read_bytes(), (PORT / "publishable-theme.wikidot.txt").read_bytes())
            self.assertEqual(build["theme"]["sha256"], sha256(theme))
            self.assertEqual(
                build["assets"],
                ["header-logo.png", "body_bg_grey.png"],
            )
            published = theme.read_text()
            self.assertNotIn("fondationscp.wdfiles", published)
            self.assertNotIn("fonts.googleapis.com", published)
            self.assertIn(
                "https://scp-jp.wdfiles.com/local--files/theme:quand-le-soleil-se-couche/header-logo.png",
                published,
            )
            self.assertIn(
                "https://scp-jp.wdfiles.com/local--files/theme:quand-le-soleil-se-couche/body_bg_grey.png",
                published,
            )

    def test_surface_contract_binds_runtime_and_theme_specific_coverage(self):
        contract_path = PORT / self.manifest["surface_contract"]
        contract = json.loads(contract_path.read_text())
        self.assertEqual(contract["schema"], "theme_lab_surface_contract.v1")
        self.assertTrue(contract["strict"])
        self.assertIn(
            "h2 .flickering",
            [row["selector"] for row in contract["custom_selectors"]],
        )
        self.assertTrue(contract["reviewed_exceptions"])
        self.assertEqual(
            self.receipt["candidate"]["surface_contract_sha256"],
            sha256(contract_path),
        )
        self.assertEqual(self.receipt["surface_contract"]["issue_count"], 0)
        self.assertEqual(
            {(row["id"], row["viewport"], row["count"]) for row in self.receipt["surface_contract"]["custom_selectors"]},
            {
                ("theme.flickering-heading", "desktop", 1),
                ("theme.flickering-heading", "mobile", 1),
            },
        )

    def test_retained_acceptance_closes_the_initial_actionable_failure(self):
        initial = json.loads((PORT / "initial-verdict.json").read_text())["result"]
        final = json.loads((PORT / "acceptance-verdict.json").read_text())["result"]
        mobile_issue = next(
            issue
            for issue in initial["top_issues"]
            if issue.get("kind") == "viewport_overflow" and issue.get("viewport") == "mobile"
        )
        self.assertEqual(mobile_issue["overflow_px"], 13)
        self.assertEqual(initial["viewport_status"]["mobile"]["status"], "fail")
        self.assertEqual(final["verdict"], "warn")
        self.assertEqual(final["next_actions"], [])
        for viewport in ("desktop", "laptop", "tablet", "mobile"):
            self.assertEqual(final["viewport_status"][viewport], {"status": "pass", "document_overflow_px": 0})
        self.assertEqual(final["torture"]["verdict"], "pass")
        self.assertEqual(final["surface_contract"]["issue_count"], 0)
        self.assertEqual(final["assets"]["external_requests"], 0)
        self.assertEqual(final["assets"]["candidate"]["missing"], [])
        self.assertEqual(self.receipt["state"], "verified-local-candidate-not-published")
        self.assertEqual(self.receipt["final_check"]["verdict"], "warn")
        self.assertEqual(
            self.receipt["final_check"]["raw_result_sha256"],
            sha256(PORT / "acceptance-verdict.json"),
        )
        self.assertEqual(
            self.receipt["cross_branch_evidence"]["current_scp_jp_usage"]["local_theme_page"]["http_status"],
            404,
        )
        self.assertEqual(
            self.receipt["cross_branch_evidence"]["current_scp_jp_usage"]["active_theme_include"],
            ":scpko:theme:quand-le-soleil-se-couche",
        )
        for filename, expected in self.receipt["screenshots"].items():
            self.assertEqual(sha256(PORT / "artifacts" / filename), expected)


if __name__ == "__main__":
    unittest.main()
