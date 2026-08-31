#!/usr/bin/env python3
"""Exercise AMC response controls through a loopback HTTP server."""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs

from wikidot.common.exceptions import (
    ResponseDataException,
    WikidotStatusCodeException,
    WikidotTransportSecurityException,
)
from wikidot.connector.ajax import AjaxModuleConnectorClient, AjaxModuleConnectorConfig


class _AmcFixtureHandler(BaseHTTPRequestHandler):
    post_counts: dict[str, int] = {}
    get_count = 0

    def do_GET(self) -> None:
        type(self).get_count += 1
        self._send(200, b"fixture GET")

    def do_POST(self) -> None:
        if self.path != "/ajax-module-connector.php":
            self._send(404, b"")
            return

        body_length = int(self.headers.get("Content-Length", "0"))
        fields = parse_qs(self.rfile.read(body_length).decode("ascii"), keep_blank_values=True)
        case = fields.get("fixture_case", ["unknown"])[0]
        type(self).post_counts[case] = type(self).post_counts.get(case, 0) + 1

        if case == "redirect":
            self._send(302, b"", {"Location": "/followed"})
        elif case == "malformed":
            self._send(200, b"not-json")
        elif case == "empty":
            self._send_json(200, {})
        elif case in {"missing", "missing-side-effect"}:
            self._send_json(200, {"body": ""})
        elif case == "non-string":
            self._send_json(200, {"status": 503})
        elif case == "try-again":
            self._send_json(200, {"status": "try_again"})
        else:
            self._send_json(200, {"status": "ok"})

    def _send_json(self, status: int, value: object) -> None:
        self._send(status, json.dumps(value).encode("ascii"), {"Content-Type": "application/json"})

    def _send(self, status: int, body: bytes, headers: dict[str, str] | None = None) -> None:
        self.send_response(status)
        for name, value in (headers or {}).items():
            self.send_header(name, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format: str, *_args: object) -> None:
        return


class _LocalAmcFixture:
    def __enter__(self) -> "_LocalAmcFixture":
        _AmcFixtureHandler.post_counts = {}
        _AmcFixtureHandler.get_count = 0
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), _AmcFixtureHandler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_address[1]}"
        return self

    def __exit__(self, _type: object, _value: object, _traceback: object) -> None:
        self.server.shutdown()
        self.thread.join(timeout=5)
        self.server.server_close()


class WikidotPyAmcLocalControlsTest(unittest.TestCase):
    def test_public_connector_closes_local_redirect_and_response_controls(self) -> None:
        controls = [
            ("redirect", {"moduleName": "FixtureRead"}, WikidotTransportSecurityException, None, 1),
            ("malformed", {"moduleName": "FixtureRead"}, ResponseDataException, None, 2),
            ("empty", {"moduleName": "FixtureRead"}, ResponseDataException, None, 2),
            ("missing", {"moduleName": "FixtureRead"}, ResponseDataException, None, 2),
            (
                "missing-side-effect",
                {"action": "FixtureAction", "event": "FixtureEvent"},
                ResponseDataException,
                None,
                1,
            ),
            ("non-string", {"moduleName": "FixtureRead"}, ResponseDataException, None, 2),
            ("try-again", {"moduleName": "FixtureRead"}, WikidotStatusCodeException, "try_again", 2),
        ]

        with _LocalAmcFixture() as fixture:
            client = AjaxModuleConnectorClient(
                site_name="sandbox-for-codex",
                config=AjaxModuleConnectorConfig(
                    local_base_url=fixture.base_url,
                    attempt_limit=2,
                    retry_interval=0,
                    backoff_factor=0,
                    max_backoff=0,
                    semaphore_limit=1,
                ),
            )

            for case, body, expected_exception, expected_status, expected_posts in controls:
                with self.subTest(case=case):
                    with self.assertRaises(expected_exception) as raised:
                        client.request([{"fixture_case": case, **body}])
                    if expected_status is not None:
                        self.assertEqual(raised.exception.status_code, expected_status)
                    self.assertEqual(_AmcFixtureHandler.post_counts[case], expected_posts)

            self.assertEqual(_AmcFixtureHandler.get_count, 0)


if __name__ == "__main__":
    unittest.main()
