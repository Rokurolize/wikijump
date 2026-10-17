from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import unittest


ROOT = Path(__file__).parents[3]
SCRIPT = Path(__file__).parents[1] / "render_ahead.py"
SPEC = importlib.util.spec_from_file_location("standing_render_ahead", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
RENDER_AHEAD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RENDER_AHEAD)


class RenderAheadMigrationTest(unittest.TestCase):
    def test_the_shipped_migration_is_idempotent(self) -> None:
        migration = ROOT / "deepwell" / "migrations" / Path(RENDER_AHEAD.MIGRATION_PATH).name
        RENDER_AHEAD.require_idempotent_migration(migration.read_text(encoding="utf-8"))

    def test_non_idempotent_statements_are_rejected(self) -> None:
        for sql in (
            "CREATE TABLE page_revision_render_ahead (revision_id BIGINT);",
            "CREATE TABLE IF NOT EXISTS a (b INT);\nALTER TABLE page DROP COLUMN slug;",
            "-- comment only\n",
        ):
            with self.subTest(sql=sql), self.assertRaises(ValueError):
                RENDER_AHEAD.require_idempotent_migration(sql)

    def test_comments_are_not_statements(self) -> None:
        self.assertEqual(
            RENDER_AHEAD.sql_statements(
                "-- a; b\nCREATE TABLE IF NOT EXISTS a (\n  b INT -- c\n);\n"
            ),
            ["CREATE TABLE IF NOT EXISTS a (\n  b INT -- c\n)"],
        )


class RenderAheadRuntimeTest(unittest.TestCase):
    def test_environment_drops_inherited_runtime_actions(self) -> None:
        inspected = {
            "Config": {
                "Env": [
                    "DATABASE_URL=postgres://db",
                    "REDIS_URL=redis://cache",
                    "DEEPWELL_RPC_TOKEN=" + "0" * 64,
                    "DEEPWELL_RUNTIME_ACTION=render-finalize",
                    "DEEPWELL_RENDER_PASS=pass2",
                    "PATH=/usr/bin",
                ]
            }
        }
        self.assertEqual(
            RENDER_AHEAD.runtime_environment(inspected),
            {
                "DATABASE_URL": "postgres://db",
                "REDIS_URL": "redis://cache",
                "DEEPWELL_RPC_TOKEN": "0" * 64,
                "PATH": "/usr/bin",
            },
        )

    def test_environment_requires_backing_services(self) -> None:
        with self.assertRaises(RuntimeError):
            RENDER_AHEAD.runtime_environment({"Config": {"Env": ["REDIS_URL=x"]}})

    def test_config_mount_is_required(self) -> None:
        self.assertEqual(
            RENDER_AHEAD.config_mount(
                {"Mounts": [{"Destination": "/etc/deepwell.toml", "Source": "/srv/config.toml"}]}
            ),
            "/srv/config.toml",
        )
        with self.assertRaises(RuntimeError):
            RENDER_AHEAD.config_mount({"Mounts": []})

    def test_settings_only_name_not_before_for_a_second_pass(self) -> None:
        first = RENDER_AHEAD.render_ahead_settings(8, 100, None)
        self.assertEqual(first["DEEPWELL_RUNTIME_ACTION"], "render-ahead")
        self.assertEqual(first["DEEPWELL_RENDER_AHEAD_DRY_RUN"], "false")
        self.assertNotIn("DEEPWELL_RENDER_AHEAD_NOT_BEFORE", first)
        second = RENDER_AHEAD.render_ahead_settings(8, 100, "2026-10-14T00:00:00Z")
        self.assertEqual(second["DEEPWELL_RENDER_AHEAD_NOT_BEFORE"], "2026-10-14T00:00:00Z")

    def test_link_digest_ignores_row_timestamps(self) -> None:
        for timestamp in ("created_at", "updated_at", "rendered_at"):
            self.assertNotIn(timestamp, RENDER_AHEAD.LINK_DIGEST_QUERY)
        for table in ("page_connection", "page_connection_missing", "page_link"):
            self.assertIn(f"FROM {table}", RENDER_AHEAD.LINK_DIGEST_QUERY)

    def test_link_digest_only_considers_renderable_live_source_pages(self) -> None:
        query = RENDER_AHEAD.LINK_DIGEST_QUERY
        self.assertIn("JOIN page AS source_page ON source_page.page_id = links.page_id", query)
        self.assertIn("source_page.deleted_at IS NULL", query)
        self.assertIn("source_page.latest_revision_id IS NOT NULL", query)

    def test_scoped_link_probe_pushes_filters_into_all_link_sources(self) -> None:
        query = RENDER_AHEAD.link_digest_query([9, 3, 9])
        for source in (
            "FROM page_connection WHERE from_page_id IN (3,9)",
            "FROM page_connection_missing WHERE from_page_id IN (3,9)",
            "FROM page_link WHERE page_id IN (3,9)",
        ):
            self.assertIn(source, query)
        self.assertIn("source_page.deleted_at IS NULL", query)
        self.assertEqual(RENDER_AHEAD.link_digest_query(), RENDER_AHEAD.LINK_DIGEST_QUERY)
        self.assertIsNone(RENDER_AHEAD.link_digest_query([]))
        for bad in ([-1], [0], ["1"], [True], ["1); DROP TABLE page;"]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                RENDER_AHEAD.link_digest_query(bad)

    def test_literal_link_proof_is_sql_scoped_and_denies_dynamic_markup(self) -> None:
        sql = []
        original = RENDER_AHEAD.psql
        try:
            RENDER_AHEAD.psql = lambda container, query: sql.append(query) or "3\n8"
            self.assertEqual(RENDER_AHEAD.certified_literal_link_pages("db", [8, 3, 8]), {3, 8})
            query = sql[0]
            self.assertIn("p.page_id IN (3,8)", query)
            self.assertIn("p.deleted_at IS NULL", query)
            self.assertIn("POSITION('[[' IN source.contents) = 0", query)
            self.assertIn("POSITION('%%' IN source.contents) = 0", query)
            self.assertIn("POSITION('{' IN source.contents) = 0", query)
            self.assertIn("template_page.slug = CASE", query)
            self.assertIn("regexp_replace(p.slug, ':[^:]*$', ':_template')", query)
            self.assertIn("template_page.page_id <> p.page_id", query)
            self.assertIn("POSITION('%%content%%' IN template_source.contents) > 0", query)
            self.assertIn("length(replace(template_source.contents, '%%', '')) = 4", query)
            self.assertIn("POSITION('[[' IN template_source.contents) > 0", query)
            RENDER_AHEAD.psql = lambda container, query: "9"
            with self.assertRaisesRegex(RuntimeError, "unrequested"):
                RENDER_AHEAD.certified_literal_link_pages("db", [8])
            for bad in ([0], [-2], ["3"], [True]):
                with self.subTest(bad=bad), self.assertRaises(ValueError):
                    RENDER_AHEAD.certified_literal_link_pages("db", bad)
            self.assertEqual(RENDER_AHEAD.certified_literal_link_pages("db", []), set())
        finally:
            RENDER_AHEAD.psql = original

    def test_changed_pages_include_added_and_removed_link_sets(self) -> None:
        self.assertEqual(
            RENDER_AHEAD.changed_pages({"1": "a", "2": "b", "3": "c"}, {"1": "a", "2": "x", "4": "d"}),
            [2, 3, 4],
        )

    def test_settings_limit_pages_and_dry_runs(self) -> None:
        settings = RENDER_AHEAD.render_ahead_settings(1, 100, None, [5, 9], dry_run=True)
        self.assertEqual(settings["DEEPWELL_RENDER_AHEAD_PAGE_IDS"], "5,9")
        self.assertEqual(settings["DEEPWELL_RENDER_AHEAD_DRY_RUN"], "true")
        with self.assertRaises(ValueError):
            RENDER_AHEAD.render_ahead_settings(1, 100, None, [])

    def test_only_deadline_failures_are_retried(self) -> None:
        deadline = {"error": "failed to render\n`-- deadline has elapsed, at service.rs"}
        other = {"error": "include expansion exceeded maximum total includes 256"}
        self.assertTrue(RENDER_AHEAD.deadline_only({"failed": 1, "failures": [deadline]}))
        self.assertFalse(
            RENDER_AHEAD.deadline_only({"failed": 2, "failures": [deadline, other]})
        )
        self.assertFalse(
            RENDER_AHEAD.deadline_only({"failed": 51, "failures": [deadline] * 50}),
            "truncated failure details cannot prove every failure is a deadline",
        )

    def test_extended_deadline_replaces_exactly_one_setting(self) -> None:
        config = "[main]\nrender-timeout-ms = 2000\nother = 1\n"
        self.assertEqual(
            RENDER_AHEAD.config_with_render_timeout(config, 300000),
            "[main]\nrender-timeout-ms = 300000\nother = 1\n",
        )
        for bad in ("[main]\n", "render-timeout-ms = 1\nrender-timeout-ms = 2\n"):
            with self.subTest(config=bad), self.assertRaises(ValueError):
                RENDER_AHEAD.config_with_render_timeout(bad, 300000)

    def test_summary_must_be_one_real_run(self) -> None:
        summary = {"action": "render-ahead", "dry_run": False, "failed": 0}
        output = "log line\n" + json.dumps(summary) + "\n"
        self.assertEqual(RENDER_AHEAD.parse_summary(output), summary)
        dry = {**summary, "dry_run": True}
        self.assertEqual(RENDER_AHEAD.parse_summary(json.dumps(dry), dry_run=True), dry)
        for bad in (
            "no summary\n",
            json.dumps(summary) + "\n" + json.dumps(summary) + "\n",
            json.dumps(dry) + "\n",
        ):
            with self.subTest(output=bad), self.assertRaises(RuntimeError):
                RENDER_AHEAD.parse_summary(bad)


class RenderUntilLinksSettleTest(unittest.TestCase):
    """Fake site: page 1 is stable, page 2 links differently on every render,
    page 3 reads page 1's links and changes once they move."""

    def setUp(self) -> None:
        self.clock = iter(f"t{index}" for index in range(100))
        self.original_now = RENDER_AHEAD.utc_now
        RENDER_AHEAD.utc_now = lambda: next(self.clock)
        self.links = {"1": "old", "2": "r0", "3": "old"}
        self.renders = 0
        self.calls = []

    def tearDown(self) -> None:
        RENDER_AHEAD.utc_now = self.original_now

    def test_recovery_merges_render_and_random_provenance(self) -> None:
        initial = {
            "rendered_page_ids": [1, 2],
            "executed_random_list_pages_page_ids": [2],
            "nondeterministic_link_producer_kinds": ["list_pages_order_random"],
        }
        recovered = {
            "rendered_page_ids": [3],
            "executed_random_list_pages_page_ids": [3],
            "nondeterministic_link_producer_kinds": ["list_pages_order_random"],
        }
        merged = RENDER_AHEAD.merge_recovered_render_observations(initial, recovered)
        self.assertEqual(merged["rendered_page_ids"], [1, 2, 3])
        self.assertEqual(merged["executed_random_list_pages_page_ids"], [2, 3])
        self.assertEqual(
            merged["nondeterministic_link_producer_kinds"],
            ["list_pages_order_random"],
        )

    def render(self, name, cutoff, pages=None):
        self.calls.append((name, cutoff, pages))
        selected = pages or [1, 2, 3]
        self.renders += 1
        for page in selected:
            if page == 1:
                self.links["1"] = "new"
            elif page == 2:
                self.links["2"] = f"r{self.renders}"
            elif page == 3 and self.renders > 1:
                self.links["3"] = "new"
        return {"candidates": len(selected), "failed_page_ids": []}

    def settle(self, not_before=None):
        passes = [{}]
        def render(name, cutoff, pages=None):
            passes.append({})
            return self.render(name, cutoff, pages)
        return RENDER_AHEAD.render_until_links_settle(
            render,
            lambda page_ids=None: {
                page: digest for page, digest in self.links.items()
                if page_ids is None or int(page) in page_ids
            },
            passes,
            not_before,
        )

    def test_probe_digests_only_its_current_changed_page_frontier(self) -> None:
        queried = []
        def digests(page_ids=None):
            queried.append(None if page_ids is None else list(page_ids))
            return {
                page: digest for page, digest in self.links.items()
                if page_ids is None or int(page) in page_ids
            }
        passes = [{}]
        def render(name, cutoff, pages=None):
            passes.append({})
            return self.render(name, cutoff, pages)
        RENDER_AHEAD.render_until_links_settle(render, digests, passes, None)
        self.assertIn(None, queried, "all full passes must compare all source links")
        self.assertTrue(any(group for group in queried if group is not None))
        self.assertTrue(
            all(len(group) <= 3 for group in queried if group is not None),
            "probing must only aggregate links for its changed page frontier",
        )

    def test_literal_certification_shortcuts_only_proven_pages(self) -> None:
        calls = []
        links = {"1": "old", "2": "old"}
        def render(name, cutoff, page_ids=None):
            calls.append((name, page_ids))
            if name.startswith("full"):
                links["1"] = "new"
                links["2"] = "new"
            return {
                "candidates": 2 if page_ids is None else len(page_ids),
                "failed": 0,
                "failed_page_ids": [],
                "failures": [],
            }
        def digests(page_ids=None):
            return {id: digest for id, digest in links.items()
                    if page_ids is None or int(id) in page_ids}
        passes = [{}]
        def captured(name, cutoff, page_ids=None):
            passes.append({})
            return render(name, cutoff, page_ids)
        RENDER_AHEAD.render_until_links_settle(
            captured, digests, passes, None, certify_literal=lambda pending: {1}
        )
        probes = [(name, selected) for name, selected in calls if name.startswith("link-probe")]
        self.assertTrue(probes)
        self.assertTrue(all(selected == [2] for _, selected in probes))
        self.assertTrue(any(name == "full-2" for name, _ in calls))

    def test_complete_runtime_provenance_probes_only_random_link_pages(self) -> None:
        calls = []
        links = {"1": "old", "2": "r0"}
        random_counter = 0

        def render(name, cutoff, page_ids=None):
            nonlocal random_counter
            calls.append((name, page_ids))
            selected = [1, 2] if page_ids is None else page_ids
            if name.startswith("full"):
                links["1"] = "new"
            if 2 in selected:
                random_counter += 1
                links["2"] = f"r{random_counter}"
            return {
                "candidates": len(selected),
                "failed_page_ids": [],
                "rendered_page_ids": selected,
                "executed_random_list_pages_page_ids": [2] if 2 in selected else [],
                "nondeterministic_link_producer_kinds": ["list_pages_order_random"],
            }

        passes = [{}]
        def captured(name, cutoff, page_ids=None):
            passes.append({})
            return render(name, cutoff, page_ids)

        RENDER_AHEAD.render_until_links_settle(
            captured,
            lambda page_ids=None: {
                page: digest for page, digest in links.items()
                if page_ids is None or int(page) in page_ids
            },
            passes,
            None,
        )
        probes = [(name, pages) for name, pages in calls if name.startswith("link-probe")]
        self.assertEqual(
            len(probes), 1, "a changed random digest is proven by one observation"
        )
        self.assertTrue(all(pages == [2] for _, pages in probes))
        self.assertIn(
            ("full-2", None), calls, "non-random changes still require convergence"
        )
        self.assertNotIn(("link-probe-1.1", [1, 2]), calls)

    def test_large_complete_trace_scopes_eight_probes_to_random_frontier(self) -> None:
        page_ids = list(range(1, 3_701))
        random_ids = list(range(1, 15))
        links = {str(page): "old" for page in page_ids}
        calls = []

        def render(name, cutoff, selected=None):
            chosen = page_ids if selected is None else selected
            calls.append((name, chosen))
            if name.startswith("full"):
                for page in page_ids:
                    links[str(page)] = "new"
            return {
                "candidates": len(chosen),
                "failed_page_ids": [],
                "rendered_page_ids": chosen,
                "executed_random_list_pages_page_ids": [
                    page for page in random_ids if page in chosen
                ],
                "nondeterministic_link_producer_kinds": ["list_pages_order_random"],
            }

        passes = [{}]
        def captured(name, cutoff, selected=None):
            passes.append({})
            return render(name, cutoff, selected)

        RENDER_AHEAD.render_until_links_settle(
            captured,
            lambda selected=None: dict(links),
            passes,
            None,
        )
        probes = [selected for name, selected in calls if name.startswith("link-probe")]
        self.assertEqual(len(probes), RENDER_AHEAD.LINK_PROBES)
        self.assertTrue(all(selected == random_ids for selected in probes))
        self.assertEqual(sum(map(len, probes)), 112)
        self.assertEqual(passes[1]["random_link_probe_candidates"], 14)
        self.assertEqual(passes[1]["nonrandom_changed_pages"], 3_686)
        self.assertEqual(
            len(page_ids) * RENDER_AHEAD.LINK_PROBES,
            29_600,
            "legacy behavior would render the entire 3,700-page frontier eight times",
        )

    def test_unknown_random_producer_registry_fails_closed(self) -> None:
        calls = []
        links = {"1": "old"}

        def render(name, cutoff, page_ids=None):
            calls.append((name, page_ids))
            if name.startswith("full"):
                links["1"] = "new"
            selected = [1] if page_ids is None else page_ids
            return {
                "candidates": len(selected),
                "failed_page_ids": [],
                "rendered_page_ids": selected,
                "executed_random_list_pages_page_ids": [],
                "nondeterministic_link_producer_kinds": ["future_unknown_producer"],
            }

        passes = [{}]
        def captured(name, cutoff, page_ids=None):
            passes.append({})
            return render(name, cutoff, page_ids)

        RENDER_AHEAD.render_until_links_settle(
            captured,
            lambda page_ids=None: dict(links),
            passes,
            None,
        )
        self.assertEqual(
            sum(name.startswith("link-probe") for name, _ in calls),
            RENDER_AHEAD.LINK_PROBES,
        )
        self.assertTrue(any(name == "full-2" for name, _ in calls))

    def test_entirely_literal_changed_frontier_skips_all_probe_processes(self) -> None:
        calls = []
        links = {"1": "old"}
        def render(name, cutoff, selected=None):
            calls.append(name)
            if name.startswith("full"):
                links["1"] = "new"
            if name.startswith("link-probe"):
                raise AssertionError("no empty probe invocation is permitted")
            return {"failed": 0, "failed_page_ids": []}
        passes = [{}]
        def captured(name, cutoff, selected=None):
            passes.append({})
            return render(name, cutoff, selected)
        RENDER_AHEAD.render_until_links_settle(
            captured, lambda selected=None: dict(links), passes, None,
            certify_literal=lambda pending: set(pending),
        )
        self.assertEqual(calls, ["full-1", "full-2"])

    def test_unknown_or_falsely_certified_page_cannot_bypass_probes(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "noncandidate"):
            self.settle_with_certifier(lambda pending: {999})

    def settle_with_certifier(self, certifier):
        passes = [{}]
        def captured(name, cutoff, page_ids=None):
            passes.append({})
            return self.render(name, cutoff, page_ids)
        return RENDER_AHEAD.render_until_links_settle(
            captured,
            lambda page_ids=None: {
                page: digest for page, digest in self.links.items()
                if page_ids is None or int(page) in page_ids
            },
            passes,
            None,
            certify_literal=certifier,
        )

    def test_deadline_recovery_happens_before_link_probe_or_convergence(self) -> None:
        events = []
        links = {"1": "old"}
        def digests(page_ids=None):
            events.append("digests")
            return dict(links)
        def render(name, cutoff, page_ids=None):
            events.append(name)
            return {
                "candidates": 1,
                "failed": 1,
                "failed_page_ids": [1],
                "failures": [{"error": "deadline has elapsed"}],
            }
        def recover(summary, cutoff):
            events.append("tail-serial")
            links["1"] = "new"
            return {"candidates": 1, "failed": 0, "failed_page_ids": [], "failures": []}
        passes = [{}]
        def captured(name, cutoff, page_ids=None):
            passes.append({})
            if name.startswith("link-probe"):
                events.append(name)
                return {"candidates": len(page_ids), "failed_page_ids": []}
            return render(name, cutoff, page_ids)
        RENDER_AHEAD.render_until_links_settle(captured, digests, passes, None, recover)
        self.assertEqual(events[:4], ["digests", "full-1", "tail-serial", "digests"])
        self.assertIn("link_changed_page_ids", passes[1])
        self.assertEqual(passes[1]["link_changed_page_ids"], [1])
        self.assertNotIn("link_changed_pages", passes[2], "a tail must not own its parent full-pass proof")

    def test_non_deadline_failure_stops_before_expensive_probing(self) -> None:
        calls = []
        def render(name, cutoff, page_ids=None):
            calls.append(name)
            return {"failed": 1, "failed_page_ids": [4], "failures": [{"error": "invalid syntax"}]}
        with self.assertRaisesRegex(RuntimeError, "non-deadline failures"):
            RENDER_AHEAD.render_until_links_settle(render, lambda page_ids=None: {}, [{}], None)
        self.assertEqual(calls, ["full-1"])

    def test_dependency_changes_render_everything_again(self) -> None:
        not_before, _, nondeterministic = self.settle()
        self.assertEqual(nondeterministic, [2])
        self.assertEqual(
            [call[0] for call in self.calls],
            [
                "full-1", "link-probe-1.1", "link-probe-1.2", "link-probe-1.3",
                "link-probe-1.4", "link-probe-1.5", "link-probe-1.6", "link-probe-1.7",
                "link-probe-1.8", "full-2", "link-probe-2.1", "link-probe-2.2",
                "link-probe-2.3", "link-probe-2.4", "link-probe-2.5", "link-probe-2.6",
                "link-probe-2.7", "link-probe-2.8", "full-3",
            ],
        )
        self.assertIsNotNone(not_before, "the second pass must not accept rows from the first")

    def test_probe_uses_a_fresh_cutoff(self) -> None:
        self.settle(not_before="t-start")
        probe_cutoffs = [cutoff for name, cutoff, _ in self.calls if name.startswith("link-probe")]
        full_cutoffs = {cutoff for name, cutoff, _ in self.calls if name.startswith("full")}
        self.assertTrue(probe_cutoffs)
        self.assertTrue(full_cutoffs.isdisjoint(probe_cutoffs))

    def test_stable_links_need_one_pass(self) -> None:
        self.links["1"] = "new"
        self.render = lambda name, cutoff, pages=None: (
            self.calls.append((name, cutoff, pages)) or {"candidates": 3, "failed_page_ids": []}
        )
        _, _, nondeterministic = self.settle()
        self.assertEqual(nondeterministic, [])
        self.assertEqual([call[0] for call in self.calls], ["full-1"])

    def test_links_that_keep_moving_fail_the_run(self) -> None:
        render = self.render
        def moving(name, cutoff, pages=None):
            result = render(name, cutoff, pages)
            if not pages:
                # Page 4's links move on every full pass but are stable when
                # page 4 is rendered alone: a dependency that never settles.
                self.links["4"] = f"moved-{self.renders}"
            return result
        self.render = moving
        with self.assertRaises(RuntimeError):
            self.settle()

    def test_a_random_choice_that_repeats_is_not_settled(self) -> None:
        # Page 5 picks between two link sets; the first probe repeats the
        # pass's pick, the second does not.
        picks = iter(["a", "a", "b"] + ["a"] * 50)
        render = self.render
        def choosing(name, cutoff, pages=None):
            result = render(name, cutoff, pages)
            if pages is None or 5 in pages:
                self.links["5"] = next(picks)
            return result
        self.links["5"] = "start"
        self.render = choosing
        _, _, nondeterministic = self.settle()
        self.assertIn(5, nondeterministic)

    def test_probe_must_select_every_changed_page(self) -> None:
        render = self.render
        self.render = lambda name, cutoff, pages=None: (
            {"candidates": 0, "failed_page_ids": []} if pages else render(name, cutoff, pages)
        )
        with self.assertRaisesRegex(RuntimeError, r"selected 0 of 2 changed active page IDs"):
            self.settle()


if __name__ == "__main__":
    unittest.main()
