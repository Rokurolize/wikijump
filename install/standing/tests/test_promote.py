from __future__ import annotations

import hashlib
import inspect
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


sys.path.insert(0, str(Path(__file__).parents[1]))
import promote  # noqa: E402


TREE = "a" * 40
OTHER = "b" * 40
NOTHING = {group: False for group in promote.GROUPS}


def receipt(tree: str, groups: dict[str, bool], **overrides) -> dict[str, object]:
    return {
        "schema": promote.VALIDATION_SCHEMA,
        "status": "pass",
        "mode": "final",
        "wikijump_tree": tree,
        "groups": groups,
        "checks": [{"name": "deepwell full tests", "status": "ok"}],
        **overrides,
    }


class ValidationCoverageTest(unittest.TestCase):
    def coverage(self, required, receipts, delta=NOTHING):
        calls = []

        def delta_groups(other):
            calls.append(other)
            return delta

        covered, missing = promote.validation_coverage(
            required, TREE, [(Path(f"/store/{i}.json"), r) for i, r in enumerate(receipts)], delta_groups
        )
        return covered, missing, calls

    def test_a_receipt_for_the_same_tree_covers_its_groups(self) -> None:
        covered, missing, calls = self.coverage(
            {**NOTHING, "deepwell": True}, [receipt(TREE, {"deepwell": True})]
        )
        self.assertEqual(missing, [])
        self.assertEqual(covered["deepwell"]["tree"], TREE)
        self.assertEqual(calls, [], "the same tree needs no diff")

    def test_another_tree_covers_a_group_its_difference_does_not_select(self) -> None:
        covered, missing, _ = self.coverage(
            {**NOTHING, "deepwell": True, "framerail": True},
            [receipt(OTHER, {"deepwell": True, "framerail": True})],
            delta={**NOTHING, "framerail": True},
        )
        self.assertEqual(sorted(covered), ["deepwell"])
        self.assertEqual(missing, ["framerail"])

    def test_a_receipt_that_did_not_run_a_group_does_not_cover_it(self) -> None:
        _, missing, _ = self.coverage(
            {**NOTHING, "deepwell": True}, [receipt(TREE, {"deepwell": False, "verification": True})]
        )
        self.assertEqual(missing, ["deepwell"])

    def test_groups_the_change_does_not_select_need_nothing(self) -> None:
        covered, missing, _ = self.coverage(NOTHING, [])
        self.assertEqual((covered, missing), ({}, []))

    def test_only_passing_final_receipts_with_every_check_ok_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            store = Path(directory)
            rows = {
                "good": receipt(TREE, {"deepwell": True}),
                "failed": receipt(TREE, {"deepwell": True}, status="fail"),
                "checkpoint": receipt(TREE, {"deepwell": True}, mode="checkpoint"),
                "failed-check": receipt(TREE, {"deepwell": True}, checks=[{"name": "x", "status": "failed"}]),
                "no-checks": receipt(TREE, {"deepwell": True}, checks=[]),
                "other-schema": receipt(TREE, {"deepwell": True}, schema="x"),
            }
            for name, row in rows.items():
                (store / f"{name}.json").write_text(json.dumps(row), encoding="utf-8")
            (store / "broken.json").write_text("{", encoding="utf-8")
            self.assertEqual([path.stem for path, _ in promote.validation_receipts(store)], ["good"])

    def test_a_missing_store_has_no_receipts(self) -> None:
        self.assertEqual(promote.validation_receipts(Path("/nonexistent/store")), [])


class RehearsalReasonTest(unittest.TestCase):
    def test_new_migrations_are_rehearsed_because_they_cannot_be_undone(self) -> None:
        self.assertEqual(
            promote.rehearsal_reason("auto", ["deepwell/migrations/x.sql"]),
            "the schema migrations change",
        )

    def test_an_undoable_activation_is_not_rehearsed_unless_requested(self) -> None:
        self.assertIsNone(promote.rehearsal_reason("auto", []))
        self.assertEqual(promote.rehearsal_reason("always", []), "requested")


class BrowserReferenceTest(unittest.TestCase):
    def reference(self, directory: Path, ledger_bytes: bytes, recorded: str | None = None) -> None:
        (directory / "ledger.json").write_bytes(ledger_bytes)
        (directory / "reference.json").write_text(
            json.dumps(
                {
                    "schema": promote.BROWSER_REFERENCE_SCHEMA,
                    "live_completion_policy": "policy.json",
                    "live_reference_ledger": "ledger.json",
                    "live_reference_sha256": recorded or hashlib.sha256(ledger_bytes).hexdigest(),
                    "source_response_cache_dir": "/cache",
                    "source_response_cache_identity": "cache-v1",
                    "browser_executable": "/usr/bin/google-chrome",
                    "candidate_public_port": 18560,
                }
            ),
            encoding="utf-8",
        )

    def test_the_retained_reference_resolves_relative_to_its_home(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.reference(home, b"{}")
            reference = promote.browser_reference(home)
            self.assertEqual(reference["ledger"], str(home / "ledger.json"))
            self.assertEqual(reference["policy"], str(home / "policy.json"))
            self.assertEqual(reference["candidate_port"], 18560)

    def test_a_changed_reference_is_refused(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            self.reference(home, b"{}", recorded="0" * 64)
            with self.assertRaisesRegex(ValueError, "does not match"):
                promote.browser_reference(home)


class FakeStanding:
    """Containers and calls of a standing runtime for `promote.activate`."""

    IDENTITY = {"wikijump_sha": "1" * 40, "wikijump_tree": "2" * 40, "ftml_sha": "3" * 40, "dependency_lock_sha256": "4" * 64}

    def __init__(self, home: Path):
        self.home = home
        (home / ".env").write_text(
            "STANDING_PROJECT_NAME=wikijump-standing\nSTANDING_NETWORK_NAME=net\n"
            "STANDING_DEEPWELL_IMAGE=sha256:" + "a" * 64 + "\n",
            encoding="utf-8",
        )
        self.calls: list[tuple] = []
        self.switched = False

    def containers(self, _home=None):
        generation = "new" if self.switched else "old"
        result = {}
        for index, service in enumerate(("deepwell", "framerail", "wws", "caddy")):
            image = ("b" if self.switched and service != "caddy" else "a") + str(index)
            result[service] = {
                "container_id": (generation if service != "caddy" else "old") + service,
                "image_id": "sha256:" + image * 32,
                "name": f"wikijump-standing-{service}-1",
                "running": True,
                "published_ports": [{"host_port": "443"}] if service == "caddy" else [],
            }
        return result

    def image(self, reference, _home=None):
        return {
            "reference": reference, "id": reference, "repo_digests": [],
            "labels": {
                "com.rokurolize.wikijump.sha": self.IDENTITY["wikijump_sha"],
                "com.rokurolize.wikijump.tree": self.IDENTITY["wikijump_tree"],
                "com.rokurolize.wikijump.ftml_sha": self.IDENTITY["ftml_sha"],
            },
        }

    def command(self, *args, cwd=None):
        self.calls.append(("command",) + args)
        if "up" in args:
            self.switched = True
        return "config: {}"

    def run(self, evidence: Path, render_ahead: dict, proof=None):
        new_images = {service: "sha256:" + ("b" + str(index)) * 32 for index, service in enumerate(("deepwell", "framerail", "wws"))}
        (evidence / "build").mkdir(parents=True, exist_ok=True)
        (evidence / "build" / "seal.json").write_text("{}", encoding="utf-8")
        patches = [
            mock.patch.object(promote.refresh, "runtime_containers", side_effect=self.containers),
            mock.patch.object(promote.refresh, "image_identity", side_effect=self.image),
            mock.patch.object(promote.refresh, "command", side_effect=self.command),
            mock.patch.object(promote.refresh, "wait_for_health", side_effect=lambda *a: (self.calls.append(("health",)), {s: "healthy" for s in promote.SERVICES})[1]),
            mock.patch.object(promote.refresh, "park_containers", side_effect=lambda previous, home, run_id: (self.calls.append(("park",)), {s: {"parked_name": f"parked-{s}"} for s in promote.SERVICES})[1]),
            mock.patch.object(promote.refresh, "restore_parked_containers", side_effect=lambda parked, home: (self.calls.append(("restore-parked",)), setattr(self, "switched", False))[0]),
            mock.patch.object(promote, "saved_page_staleness", return_value=0),
            mock.patch.object(promote, "http_canary", return_value={"url": "u", "status": "pass", "required_markers": ["scp-9506", "page-content"]}),
            mock.patch.object(promote, "snapshot_saved_page_output", side_effect=lambda path: (self.calls.append(("snapshot",)), path.write_text("rows", encoding="utf-8"), 24573)[2]),
            mock.patch.object(promote, "restore_saved_page_output", side_effect=lambda path, generator: (self.calls.append(("restore-pages", generator)), 24573)[1]),
            mock.patch.object(promote, "browser_parity", side_effect=proof or (lambda *a: {"status": "pass"})),
            mock.patch.object(promote.subprocess, "run", side_effect=lambda args, **k: self.calls.append(("subprocess",) + tuple(args))),
        ]
        for patch in patches:
            patch.start()
        try:
            return promote.activate(
                Path(promote.__file__).parents[2], self.home, Path("/src/refresh.compose.yaml"), self.IDENTITY, evidence,
                promote.Stages(), new_images, render_ahead, {}, 1,
            )
        finally:
            for patch in reversed(patches):
                patch.stop()


GENERATION_CHANGE = {"status": "pass", "expected_compiled_generator": "ftml v1; deepwell-render/v26", "stale_pages_before": 24573, "receipt": {"path": "/r", "sha256": "0" * 64}}
NO_RENDER = {"status": "not-needed", "expected_compiled_generator": "ftml v1; deepwell-render/v25", "stale_pages_before": 0}


class ActivationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)
        (self.root / "home").mkdir()
        self.standing = FakeStanding(self.root / "home")

    def tearDown(self) -> None:
        self.directory.cleanup()

    def test_a_passing_activation_removes_the_parked_containers_and_binds_the_build(self) -> None:
        result = self.standing.run(self.root / "evidence", NO_RENDER)
        receipt = json.loads(Path(result["refresh_receipt"]).read_text(encoding="utf-8"))
        self.assertEqual(receipt["schema_version"], 4)
        self.assertEqual(receipt["build_evidence"]["path"], str(self.root / "evidence" / "build" / "seal.json"))
        removed = [call for call in self.standing.calls if call[:3] == ("subprocess", "docker", "rm")]
        self.assertEqual([call[-1] for call in removed], [f"parked-{s}" for s in promote.SERVICES])
        self.assertNotIn(("snapshot",), self.standing.calls, "no generator change, nothing to keep")
        env = (self.standing.home / ".env").read_text(encoding="utf-8")
        self.assertIn("STANDING_WIKIJUMP_SHA=" + "1" * 40, env)

    def test_a_failed_standing_proof_restores_the_old_runtime_and_its_saved_pages(self) -> None:
        def failing_proof(*args):
            raise RuntimeError("parity differs")

        with self.assertRaisesRegex(RuntimeError, "activation failed .*parity differs.*'status': 'pass'"):
            self.standing.run(self.root / "evidence", GENERATION_CHANGE, failing_proof)
        names = [call[0] for call in self.standing.calls]
        self.assertLess(names.index("snapshot"), names.index("park"), "the snapshot precedes the switch")
        self.assertLess(names.index("restore-pages"), names.index("restore-parked"), "pages are put back before the old build starts")
        self.assertIn(("restore-pages", GENERATION_CHANGE["expected_compiled_generator"]), self.standing.calls)
        new_containers_removed = [call for call in self.standing.calls if call[:4] == ("subprocess", "docker", "rm", "--force")]
        self.assertEqual(len(new_containers_removed), 3)
        env = (self.standing.home / ".env").read_text(encoding="utf-8")
        self.assertIn("STANDING_DEEPWELL_IMAGE=sha256:" + "a0" * 32, env)
        self.assertNotIn("STANDING_WIKIJUMP_SHA=" + "1" * 40, env)

    def test_a_standing_change_before_the_switch_touches_nothing(self) -> None:
        original = self.standing.containers

        def drifting(_home=None, calls=[0]):
            calls[0] += 1
            value = original()
            if calls[0] > 1:
                value["deepwell"]["container_id"] = "someone-else"
            return value

        self.standing.containers = drifting
        with self.assertRaisesRegex(RuntimeError, "standing changed"):
            self.standing.run(self.root / "evidence", NO_RENDER)
        self.assertNotIn(("park",), self.standing.calls)
        self.assertFalse(any(call[0] == "subprocess" for call in self.standing.calls))


class PromotionCheckoutTest(unittest.TestCase):
    def git(self, *args, cwd):
        return subprocess.run(["git", *args], cwd=cwd, check=True, text=True, capture_output=True).stdout.strip()

    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.origin = root / "origin.git"
        self.repository = root / "repository"
        self.checkout = root / "state" / "promotion-checkout"
        self.git("init", "--quiet", "--bare", "--initial-branch=develop", str(self.origin), cwd=root)
        self.git("clone", "--quiet", str(self.origin), str(self.repository), cwd=root)
        for key, value in (("user.email", "test@example.invalid"), ("user.name", "Test")):
            self.git("config", key, value, cwd=self.repository)
        self.commit("first")

    def tearDown(self) -> None:
        self.directory.cleanup()

    def commit(self, text: str) -> str:
        (self.repository / "file.txt").write_text(text, encoding="utf-8")
        self.git("add", "file.txt", cwd=self.repository)
        self.git("commit", "--quiet", "-m", text, cwd=self.repository)
        self.git("push", "--quiet", "origin", "HEAD:develop", cwd=self.repository)
        return self.git("rev-parse", "HEAD", cwd=self.repository)

    def test_the_checkout_is_created_once_and_follows_origin_develop(self) -> None:
        promote.prepare_promotion_checkout(self.repository, self.checkout)
        first = self.git("rev-parse", "HEAD", cwd=self.checkout)
        second = self.commit("second")
        promote.prepare_promotion_checkout(self.repository, self.checkout)
        self.assertNotEqual(first, second)
        self.assertEqual(self.git("rev-parse", "HEAD", cwd=self.checkout), second)

    def test_a_changed_checkout_is_refused_not_reset(self) -> None:
        promote.prepare_promotion_checkout(self.repository, self.checkout)
        (self.checkout / "file.txt").write_text("local edit", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "has local changes"):
            promote.prepare_promotion_checkout(self.repository, self.checkout)
        self.assertEqual((self.checkout / "file.txt").read_text(encoding="utf-8"), "local edit")

    def test_a_foreign_directory_is_refused(self) -> None:
        self.checkout.mkdir(parents=True)
        self.git("init", "--quiet", str(self.checkout), cwd=self.checkout.parent)
        with self.assertRaisesRegex(ValueError, "is not a worktree of"):
            promote.prepare_promotion_checkout(self.repository, self.checkout)

    def test_the_command_runs_from_the_promoted_source(self) -> None:
        own_root = Path(promote.__file__).resolve().parents[2]
        with mock.patch.object(promote.os, "execv") as execv:
            promote.run_from_source_root(own_root)
            execv.assert_not_called()
            with mock.patch.object(promote.sys, "argv", ["promote.py", "--rehearse", "always"]):
                promote.run_from_source_root(self.repository)
        executable, argv = execv.call_args.args
        self.assertEqual(argv[1], str(self.repository / "install" / "standing" / "promote.py"))
        self.assertEqual(argv[2:], ["--source-root", str(self.repository), "--rehearse", "always"])


class SavedPageStalenessTest(unittest.TestCase):
    def query(self, *args):
        with mock.patch.object(promote, "run", return_value="0") as run:
            promote.saved_page_staleness("db", "ftml v1; deepwell-render/v2", *args)
        return run.call_args.args[-1]

    def test_the_whole_site_is_counted_by_default(self) -> None:
        sql = self.query()
        self.assertIn("compiled_generator <> 'ftml v1; deepwell-render/v2'", sql)
        self.assertNotIn("p.slug IN", sql)

    def test_a_rehearsal_after_a_generator_change_counts_only_its_own_pages(self) -> None:
        sql = self.query(["scp-9506", "theme:it's"])
        self.assertIn("slug = 'scp-wiki'", sql)
        self.assertIn("p.slug IN ('scp-9506', 'theme:it''s')", sql)


class ActivationSafetyTest(unittest.TestCase):
    def test_the_cli_has_no_volume_removal_spelling(self) -> None:
        script = Path(promote.__file__)
        for forbidden in ("-v", "--volumes", "--remove-volumes"):
            with self.subTest(forbidden=forbidden):
                result = subprocess.run(
                    (sys.executable, str(script), forbidden), text=True, capture_output=True
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("unrecognized arguments", result.stderr)

    def test_activation_starts_built_images_without_building_or_touching_volumes(self) -> None:
        source = inspect.getsource(promote.activate)
        self.assertIn('"up", "--detach", "--no-deps", "--no-build", *SERVICES', source)
        self.assertNotIn("docker\", \"build", source)
        self.assertNotIn('"down"', source)
        self.assertNotIn("--volumes", source)

    def test_activation_requires_fresh_saved_pages_before_the_canary(self) -> None:
        source = inspect.getsource(promote.activate)
        self.assertLess(
            source.index("saved_page_staleness(STANDING_DATABASE"),
            source.index("http_canary(refresh.CANARY_URL)"),
        )
        self.assertIn("standing serves {stale} stale saved pages", source)

    def test_rehearsal_teardown_only_names_rehearsal_resources(self) -> None:
        source = inspect.getsource(promote.rehearse)
        self.assertIn('project = f"wjcand-rehearsal-{target[:12]}"', source)
        self.assertIn('"down", "--volumes"', source)
        self.assertNotIn("wikijump-standing", source)


if __name__ == "__main__":
    unittest.main()
