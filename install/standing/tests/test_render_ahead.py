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


class FakeSite:
    """Pages and the links each render writes.

    `links` maps a page to a function of the current links and the render
    count; `readers` are the pages whose render reads the link graph.
    `deadline` maps a page to how hard it misses the render deadline: 1
    renders alone, 2 needs the extended deadline, 3 never renders."""

    def __init__(self, links, readers=(), deadline=()):
        self.produce = links
        self.readers = set(readers)
        self.deadline = dict(deadline)
        self.links = {str(page): "old" for page in links}
        self.renders = 0
        self.calls = []

    def render(self, name, cutoff, pages=None, *, serial=False, extended=False, dry_run=False):
        self.calls.append((name, cutoff, pages, serial, extended))
        selected = list(pages) if pages is not None else sorted(self.produce)
        failed = []
        for page in selected:
            misses = self.deadline.get(page, 0)
            if misses >= 3 or (misses == 2 and not extended) or (misses == 1 and not serial):
                failed.append(page)
                continue
            self.renders += 1
            self.links[str(page)] = self.produce[page](self.links, self.renders)
        return {
            "candidates": len(selected),
            "failed_page_ids": failed,
            "failed": len(failed),
            "failures": [{"error": "deadline has elapsed"} for _ in failed],
            "link_reader_page_ids": sorted(set(selected) & self.readers - set(failed)),
        }

    def settle(self):
        return RENDER_AHEAD.render_until_links_settle(
            self.render, lambda: dict(self.links), "t-start"
        )

    def names(self):
        return [call[0] for call in self.calls]


class RenderUntilLinksSettleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.clock = iter(f"t{index}" for index in range(100))
        self.original_now = RENDER_AHEAD.utc_now
        RENDER_AHEAD.utc_now = lambda: next(self.clock)

    def tearDown(self) -> None:
        RENDER_AHEAD.utc_now = self.original_now

    def test_one_full_pass_suffices_without_link_readers(self) -> None:
        site = FakeSite({1: lambda links, n: "new", 2: lambda links, n: f"random-{n}"})
        self.assertEqual(site.settle(), ([], []))
        self.assertEqual(site.names(), ["full"])

    def test_readers_render_again_after_the_links_they_read_moved(self) -> None:
        # Page 3 lists page 1's links: rendered before page 1 in the full
        # pass, it read the old ones.
        site = FakeSite(
            {3: lambda links, n: "reads-" + links["1"], 1: lambda links, n: "new"},
            readers=[3],
        )
        site.produce = dict(sorted(site.produce.items()))
        site.links = {"1": "old", "3": "old"}
        order = [3, 1]
        original = site.render
        def render(name, cutoff, pages=None, **flags):
            return original(name, cutoff, pages if pages is not None else order, **flags)
        site.render = render
        readers, nondeterministic = site.settle()
        self.assertEqual((readers, nondeterministic), ([3], []))
        self.assertEqual(site.links["3"], "reads-new")
        self.assertEqual(site.names(), ["full", "link-readers-1", "link-readers-2"])
        self.assertEqual(site.calls[1][2], [3], "a reader round renders only the readers")
        self.assertNotEqual(site.calls[1][1], "t-start", "a reader round needs its own cutoff")

    def test_unchanged_links_need_no_reader_round(self) -> None:
        site = FakeSite({1: lambda links, n: "old", 2: lambda links, n: "reads-" + links["1"]}, readers=[2])
        site.links["2"] = "reads-old"
        self.assertEqual(site.settle(), ([2], []))
        self.assertEqual(site.names(), ["full"])

    def test_a_reader_chain_settles_one_level_per_round(self) -> None:
        # 4 reads 3, 3 reads 2, 2 reads 1; the full pass renders readers first.
        site = FakeSite(
            {
                4: lambda links, n: "4<" + links["3"],
                3: lambda links, n: "3<" + links["2"],
                2: lambda links, n: "2<" + links["1"],
                1: lambda links, n: "new",
            },
            readers=[2, 3, 4],
        )
        readers, nondeterministic = site.settle()
        self.assertEqual((readers, nondeterministic), ([2, 3, 4], []))
        self.assertEqual(site.links["4"], "4<3<2<new")

    def test_readers_that_move_on_every_render_block_promotion(self) -> None:
        site = FakeSite(
            {1: lambda links, n: "new", 5: lambda links, n: f"random-{n}"},
            readers=[5],
        )
        with self.assertRaisesRegex(RuntimeError, "did not settle"):
            site.settle()
        self.assertEqual(site.names()[-1], f"link-readers-{RENDER_AHEAD.MAX_READER_ROUNDS}")

    def test_stochastic_reader_makes_another_reader_stale(self) -> None:
        # A random-order ListPages can change its saved links every time.
        # Another link-reading page may render before it in every concurrent
        # pass, leaving an ahead row that reflects a previous link snapshot.
        site = FakeSite(
            {1: lambda links, n: f"random-{n}", 2: lambda links, n: "reads-" + links["1"]},
            readers=[1, 2],
        )
        original = site.render

        def render(name, cutoff, pages=None, **flags):
            selected = set(pages) if pages is not None else {1, 2}
            ordered = [page for page in (2, 1) if page in selected]
            return original(name, cutoff, ordered, **flags)

        site.render = render
        with self.assertRaisesRegex(RuntimeError, "did not settle"):
            site.settle()
        self.assertNotEqual(site.links["2"], "reads-" + site.links["1"])

    def test_deep_reader_chain_is_not_mistaken_for_random_movement(self) -> None:
        # The last reader needs five propagation rounds. Four rounds change
        # overlapping page IDs, but each page is fully deterministic. They
        # still cannot be accepted with an output depending on older links.
        links = {page: (lambda values, _n, page=page: f"{page}<" + values[str(page - 1)])
                 for page in range(2, 7)}
        links[1] = lambda _values, _n: "new"
        site = FakeSite(links, readers=range(2, 7))
        original = site.render

        def render(name, cutoff, pages=None, **flags):
            selected = pages if pages is not None else links
            return original(name, cutoff, sorted(selected, reverse=True), **flags)

        site.render = render
        with self.assertRaisesRegex(RuntimeError, "did not settle"):
            site.settle()
        self.assertNotEqual(site.links["6"], "6<" + site.links["5"])

    def test_links_that_still_settle_after_the_last_round_fail_the_run(self) -> None:
        # Page 6 moves on every render; page 8 first moves in the last round,
        # so it has not been shown to settle.
        site = FakeSite(
            {
                1: lambda links, n: "new",
                6: lambda links, n: f"move-{n}",
                8: lambda links, n: "late" if n >= 11 else "stable",
            },
            readers=[6, 8],
        )
        with self.assertRaisesRegex(RuntimeError, "did not settle"):
            site.settle()

    def test_deadline_misses_are_retried_before_links_are_compared(self) -> None:
        site = FakeSite(
            {1: lambda links, n: "new", 2: lambda links, n: "reads-" + links["1"]},
            readers=[2],
            deadline={1: 2},
        )
        readers, _ = site.settle()
        self.assertEqual(readers, [2])
        self.assertEqual(
            site.names()[:3], ["full", "full-tail-serial", "full-tail-extended-deadline"]
        )
        self.assertEqual(site.calls[1][2], [1])
        self.assertTrue(site.calls[1][3], "the first retry renders alone")
        self.assertTrue(site.calls[2][4], "the second retry uses the extended deadline")
        self.assertFalse(site.calls[2][3], "extended-deadline renders do not race the deadline")
        self.assertEqual(site.links["2"], "reads-new")

    def test_other_failures_stop_the_run(self) -> None:
        site = FakeSite({1: lambda links, n: "new"}, deadline={1: 1})
        original = site.render
        def render(*args, **flags):
            summary = original(*args, **flags)
            summary["failures"] = [{"error": "include limit"} for _ in summary["failed_page_ids"]]
            return summary
        site.render = render
        with self.assertRaisesRegex(RuntimeError, "other than the render deadline"):
            site.settle()

    def test_pages_that_never_render_stop_the_run(self) -> None:
        site = FakeSite({1: lambda links, n: "new"}, deadline={1: 3})
        with self.assertRaisesRegex(RuntimeError, "even with the extended deadline"):
            site.settle()

    def test_reader_round_must_select_every_reader(self) -> None:
        site = FakeSite(
            {1: lambda links, n: "new", 2: lambda links, n: "reads-" + links["1"]},
            readers=[2],
        )
        site.links["2"] = "stale"
        original = site.render
        def render(name, cutoff, pages=None, **flags):
            summary = original(name, cutoff, pages, **flags)
            if name.startswith("link-readers"):
                summary["candidates"] = 0
            return summary
        site.render = render
        with self.assertRaisesRegex(RuntimeError, r"selected 0 of 1 reader pages"):
            site.settle()

    def test_an_image_without_link_readers_is_refused(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "does not report link readers"):
            RENDER_AHEAD.link_readers({"candidates": 1})


if __name__ == "__main__":
    unittest.main()
