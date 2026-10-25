"""Fail-closed current-head Theme Lab evidence restoration tests."""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[1] / 'scripts' / 'restore-authority-evidence.py'
spec = importlib.util.spec_from_file_location('restore_authority_evidence', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
PREFIX = 'install/local/theme-lab/ports/'


class RestoreAuthorityEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='theme-lab-restore-test-')
        self.addCleanup(self.tmp.cleanup)
        root = pathlib.Path(self.tmp.name)
        self.source, self.destination = root / 'source', root / 'destination'
        self.source.mkdir()
        self.destination.mkdir()
        self.rel = PREFIX + 'authority-evidence/sample/receipt.json'
        self.data = b'{"schema":"test-receipt"}\n'
        self.digest = hashlib.sha256(self.data).hexdigest()
        self.src = self.source / self.rel
        self.src.parent.mkdir(parents=True)
        self.src.write_bytes(self.data)
        ledger = self.destination / PREFIX / 'adaptation-authority.json'
        ledger.parent.mkdir(parents=True)
        ledger.write_text(json.dumps({'packages': {'sample': {'evidence': [
            {'path': 'authority-evidence/sample/receipt.json', 'sha256': self.digest}
        ]}}}))
        self.inventory = root / 'inventory.json'
        self.entries = [dict(relative_path=self.rel, sha256=self.digest, size_bytes=len(self.data),
                             ledger_root=True, ledger_hash_verified=True, missing_in_clean_head=True)]
        self.write_inventory()

    def write_inventory(self):
        self.inventory.write_text(json.dumps({'schema': module.SCHEMA, 'files': self.entries}))
        self.inventory_sha = module.checksum(self.inventory)

    def run_restore(self, *, apply=False, digest=None):
        return module.restore(self.source, self.destination, self.inventory,
                              digest or self.inventory_sha, apply=apply)

    def test_plan_and_restore_are_source_bound_and_do_not_overwrite(self):
        planned = self.run_restore()
        self.assertEqual((planned['status'], planned['ledger_roots'], planned['files_to_restore']),
                         ('verified-plan', 1, 1))
        self.assertFalse((self.destination / self.rel).exists())
        copied = self.run_restore(apply=True)
        self.assertEqual(copied['status'], 'restored')
        self.assertEqual((self.destination / self.rel).read_bytes(), self.data)
        self.assertFalse(bool((self.destination / self.rel).stat().st_mode & 0o222))
        self.assertEqual(self.run_restore(apply=True)['files_to_restore'], 0)
        (self.destination / self.rel).chmod(0o644)
        (self.destination / self.rel).write_bytes(b'changed')
        with self.assertRaisesRegex(ValueError, 'existing destination differs'):
            self.run_restore(apply=True)

    def test_inventory_hash_and_source_hash_fail_closed(self):
        pinned = self.inventory_sha
        self.entries[0]['size_bytes'] += 1
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'inventory SHA-256 mismatch'):
            self.run_restore(digest=pinned)
        self.entries[0]['size_bytes'] -= 1
        self.write_inventory()
        self.src.write_bytes(b'forged source')
        with self.assertRaisesRegex(ValueError, 'source evidence size/SHA mismatch'):
            self.run_restore(apply=True)
        self.assertFalse((self.destination / self.rel).exists())

    def test_missing_root_and_unverified_ledger_identity_fail_closed(self):
        self.entries[0]['ledger_root'] = False
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'inventory/ledger authority identity mismatch'):
            self.run_restore()
        self.entries[0]['ledger_root'] = True
        self.entries[0]['ledger_hash_verified'] = None
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'ledger root not checked'):
            self.run_restore()

    def test_path_escape_duplicate_symlink_and_non_independent_roots_rejected(self):
        self.entries.append(dict(self.entries[0]))
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'duplicate inventory path'):
            self.run_restore()
        self.entries.pop()
        self.entries[0]['relative_path'] = PREFIX + 'authority-evidence/../escape/receipt.json'
        self.write_inventory()
        with self.assertRaisesRegex(ValueError, 'unsafe relative path'):
            self.run_restore()
        self.entries[0]['relative_path'] = self.rel
        self.write_inventory()
        (self.destination / PREFIX / 'authority-evidence').symlink_to(self.src.parent)
        with self.assertRaisesRegex(ValueError, 'symlink in evidence path'):
            self.run_restore(apply=True)
        with self.assertRaisesRegex(ValueError, 'independent'):
            module.restore(self.source, self.source, self.inventory, self.inventory_sha)


if __name__ == '__main__':
    unittest.main()
