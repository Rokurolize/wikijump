"""Local HTTP fixture tests for a separately acquired authority blob store."""
import hashlib
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import socket
from types import SimpleNamespace
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
spec = importlib.util.spec_from_file_location('fetch_authority_objects', SCRIPTS / 'fetch-authority-objects.py')
fetcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetcher)
PREFIX = 'install/local/theme-lab/ports/'


class ObjectServer(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass

    def do_GET(self):
        self.server.requests.append((self.path, self.headers.get('Range'), self.headers.get('Authorization')))
        if self.server.redirect:
            self.send_response(302)
            self.send_header('Location', 'https://example.invalid/objects/private')
            self.end_headers()
            return
        expected_path = '/objects/' + self.server.digest[:2] + '/' + self.server.digest
        if self.path != expected_path:
            self.send_error(404)
            return
        body = self.server.payload
        if self.server.transient_failure:
            self.server.transient_failure = False
            self.send_error(503)
            return
        content_range = self.headers.get('Range')
        if content_range and self.server.allow_ranges:
            start = int(content_range.removeprefix('bytes=').removesuffix('-'))
            self.send_response(206)
            self.send_header('Content-Range', f'bytes {start}-{len(body)-1}/{len(body)}')
            body = body[start:]
        else:
            self.send_response(200)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        if self.server.interrupt_once:
            self.server.interrupt_once = False
            self.wfile.write(body[:1024])
            self.wfile.flush()
            self.connection.shutdown(socket.SHUT_RDWR)
            self.connection.close()
            return
        self.wfile.write(body)


class FetchAuthorityObjectTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='theme-lab-remote-store-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.destination = self.root / 'checkout'
        self.store = self.root / 'blob-store'
        self.destination.mkdir()
        self.store.mkdir()
        self.body = b'Immutable upstream reference bytes' * 8000
        self.digest = hashlib.sha256(self.body).hexdigest()
        name = PREFIX + 'authority-evidence/sample/receipt.json'
        ledger = self.destination / PREFIX / 'adaptation-authority.json'
        ledger.parent.mkdir(parents=True)
        ledger.write_text(json.dumps({'packages': {'theme': {'source': {
            'path': 'authority-evidence/sample/receipt.json', 'sha256': self.digest
        }}}}))
        self.manifest = self.root / 'inventory.json'
        self.manifest.write_text(json.dumps({'schema': fetcher.objects.authority.SCHEMA, 'files': [
            {'relative_path': name, 'sha256': self.digest, 'size_bytes': len(self.body),
             'ledger_root': True, 'ledger_hash_verified': True}
        ]}))
        self.inventory_sha = hashlib.sha256(self.manifest.read_bytes()).hexdigest()

        self.httpd = ThreadingHTTPServer(('127.0.0.1', 0), ObjectServer)
        self.httpd.digest = self.digest
        self.httpd.payload = self.body
        self.httpd.requests = []
        self.httpd.redirect = False
        self.httpd.allow_ranges = True
        self.httpd.interrupt_once = False
        self.httpd.transient_failure = False
        self.thread = Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.httpd.server_close)
        self.addCleanup(self.httpd.shutdown)
        self.endpoint = f'http://127.0.0.1:{self.httpd.server_port}'

    def run_fetch(self, *, apply=False, base=None, **options):
        return fetcher.fetch(self.store, self.destination, self.manifest,
                             options.get('sha', self.inventory_sha),
                             self.endpoint if base is None else base,
                             apply=apply,
                             allow_http_loopback=options.get('allow_loopback', True),
                             token=options.get('token'), retries=0)

    def test_readonly_plan_then_acquire_and_skip_existing_blob(self):
        self.assertEqual(self.run_fetch()['missing_before_fetch'], 1)
        self.assertEqual(self.httpd.requests, [])
        result = self.run_fetch(apply=True, token='read-only-test-token')
        self.assertEqual((result['objects_fetched'], result['status']), (1, 'fetched'))
        self.assertEqual(self.httpd.requests[-1][2], 'Bearer read-only-test-token')
        blob = self.store / 'objects' / self.digest[:2] / self.digest
        self.assertEqual(blob.read_bytes(), self.body)
        self.assertFalse(blob.stat().st_mode & 0o222)
        self.assertEqual(self.run_fetch(apply=True)['objects_fetched'], 0)
        self.assertEqual(len(self.httpd.requests), 1)

    def test_resume_partial_by_range_and_restart_if_server_ignores_range(self):
        partial = self.store / 'partial' / self.digest[:2] / (self.digest + '.part')
        partial.parent.mkdir(parents=True)
        partial.write_bytes(self.body[:4096])
        self.run_fetch(apply=True)
        self.assertEqual(self.httpd.requests[-1][1], 'bytes=4096-')
        self.assertFalse(partial.exists())
        self.assertEqual((self.store / 'objects' / self.digest[:2] / self.digest).read_bytes(), self.body)

        (self.store / 'objects' / self.digest[:2] / self.digest).unlink()
        partial.write_bytes(self.body[:512])
        self.httpd.allow_ranges = False
        self.run_fetch(apply=True)
        self.assertEqual(self.httpd.requests[-1][1], 'bytes=512-')
        self.assertEqual((self.store / 'objects' / self.digest[:2] / self.digest).read_bytes(), self.body)

    def test_server_corruption_and_redirect_are_blocked(self):
        self.httpd.payload = b'forged!' * 2000
        # Protocol rejects a declared oversized or truncated response, and
        # never commits it as a content-addressed object.
        with self.assertRaises((ValueError, OSError)):
            self.run_fetch(apply=True)
        self.assertFalse((self.store / 'objects' / self.digest[:2] / self.digest).exists())
        self.httpd.redirect = True
        with self.assertRaisesRegex(ValueError, 'redirects are forbidden'):
            self.run_fetch(apply=True)
        self.assertEqual(len(self.httpd.requests), 2)

    def test_transient_failure_then_interrupted_transfer_resumes_at_byte_offset(self):
        self.httpd.transient_failure = True
        self.httpd.interrupt_once = True
        result = fetcher.fetch(self.store, self.destination, self.manifest,
                               self.inventory_sha, self.endpoint, apply=True,
                               allow_http_loopback=True, retries=3)
        self.assertEqual(result['objects_fetched'], 1)
        requests = self.httpd.requests
        self.assertEqual(len(requests), 3)
        self.assertEqual([item[1] for item in requests], [None, None, 'bytes=1024-'])
        self.assertEqual((self.store / 'objects' / self.digest[:2] / self.digest).read_bytes(), self.body)
        self.assertFalse((self.store / 'partial' / self.digest[:2] / (self.digest + '.part')).exists())

    def test_same_length_corruption_is_detected_by_full_sha(self):
        self.httpd.payload = b'?' * len(self.body)
        with self.assertRaisesRegex(ValueError, 'downloaded blob SHA-256 mismatch'):
            self.run_fetch(apply=True)
        self.assertFalse((self.store / 'objects' / self.digest[:2] / self.digest).exists())
        self.httpd.payload = self.body
        self.assertEqual(self.run_fetch(apply=True)['objects_fetched'], 1)

    def test_origin_policy_and_manifest_binding_fail_closed(self):
        for origin in ('http://example.com', 'ftp://example.com',
                       'https://username:pass@example.com',
                       'https://example.com/../objects',
                       'https://example.com/objects?token=secret'):
            with self.assertRaises(ValueError):
                self.run_fetch(base=origin)
        with self.assertRaisesRegex(ValueError, 'HTTPS'):
            self.run_fetch(allow_loopback=False)
        with self.assertRaisesRegex(ValueError, 'inventory SHA-256 mismatch'):
            self.run_fetch(sha='a' * 64, apply=True)
        self.assertEqual(self.httpd.requests, [])

    def test_concurrent_acquisition_shares_one_atomic_download(self):
        with ThreadPoolExecutor(max_workers=2) as pool:
            runs = list(pool.map(lambda _: self.run_fetch(apply=True), range(2)))
        self.assertEqual(sum(r['objects_fetched'] for r in runs), 1)
        self.assertEqual(len(self.httpd.requests), 1)
        self.assertEqual((self.store / 'objects' / self.digest[:2] / self.digest).read_bytes(), self.body)

    def test_disk_preflight_blocks_download_without_mutating_objects(self):
        with patch.object(fetcher.shutil, 'disk_usage', return_value=SimpleNamespace(free=0)):
            with self.assertRaisesRegex(ValueError, 'insufficient free disk'):
                self.run_fetch(apply=True)
        self.assertEqual(self.httpd.requests, [])
        self.assertFalse((self.store / 'objects').exists())

    def test_existing_tamper_and_unsafe_partial_are_not_overwritten(self):
        object_file = self.store / 'objects' / self.digest[:2] / self.digest
        object_file.parent.mkdir(parents=True)
        object_file.write_bytes(b'forged')
        with self.assertRaisesRegex(ValueError, 'cached blob size/SHA-256 mismatch'):
            self.run_fetch(apply=True)
        self.assertEqual(object_file.read_bytes(), b'forged')
        object_file.unlink()
        partial = self.store / 'partial' / self.digest[:2] / (self.digest + '.part')
        partial.parent.mkdir(parents=True)
        partial.symlink_to(self.manifest)
        with self.assertRaisesRegex(ValueError, 'symlink in evidence path'):
            self.run_fetch(apply=True)
        self.assertEqual(self.httpd.requests, [])


if __name__ == '__main__':
    unittest.main()
