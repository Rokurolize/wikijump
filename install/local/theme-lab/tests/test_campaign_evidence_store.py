"""Campaign evidence inventory: build, pinned restore, and fail-closed refusals (#2506)."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts' / 'campaign-evidence-store.py'
spec = importlib.util.spec_from_file_location('campaign_evidence_store', SCRIPT)
campaign = importlib.util.module_from_spec(spec)
spec.loader.exec_module(campaign)
authority = campaign.authority
LAB = 'install/local/theme-lab'
PASS = lambda theme_lab, sigma9, sigma10: {'status': 'pass', 'failures': []}


class CampaignEvidenceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='theme-lab-campaign-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.checkout = self.root / 'checkout'
        self.theme_lab = self.checkout / LAB
        self.store = self.root / 'store'
        self.restored = self.root / 'restored'
        self.output = self.root / 'manifest.json'
        self.files = {
            'current-campaign-acceptance.json': b'{"schema":"theme_lab_current_campaign_acceptance.v1"}\n',
            'ports/current-acceptance/run-contract.json': b'{"schema":"scp_jp_interactive_acceptance_run.v1"}\n',
            'sigma10-migration/current-campaign/run-contract.json': b'{"schema":"scp_jp_sigma10_migration_run.v1"}\n',
            'ports/current-acceptance/audit/a.json': b'{"row":"first"}\n',
            'evidence/search-controls-20261022/receipt.json': b'{"row":"second"}\n',
        }
        for rel, body in self.files.items():
            target = self.theme_lab / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(body)
        self.store.mkdir()
        (self.restored / LAB).mkdir(parents=True)

    def build(self, checker=PASS):
        self.output.unlink(missing_ok=True)
        result = campaign.build_inventory(self.checkout, self.store, self.output, checker=checker)
        self.inventory_sha = authority.checksum(self.output)
        return result

    def rewrite(self, mutate):
        doc = json.loads(self.output.read_text())
        mutate(doc)
        self.output.write_text(json.dumps(doc, indent=2) + '\n')
        self.inventory_sha = authority.checksum(self.output)

    def restore(self, *, apply=False, link=False, sha=None, destination=None):
        return campaign.restore(destination or self.restored, self.store, self.output,
                                sha or self.inventory_sha, apply=apply, link=link)

    def blob(self, rel):
        digest = authority.checksum(self.theme_lab / rel)
        return campaign.store.blob_path(self.store, digest)

    def test_build_restore_roundtrip_verifies_receipt_and_run_contracts(self):
        built = self.build()
        self.assertEqual((built['status'], built['inventory_files'], built['checker_status']), ('built', 5, 'pass'))
        doc = json.loads(self.output.read_text())
        self.assertEqual(doc['schema'], campaign.SCHEMA)
        self.assertEqual(doc['checker']['status'], 'pass')
        self.assertEqual(doc['receipt']['path'], 'current-campaign-acceptance.json')
        self.assertEqual(doc['run_contracts']['sigma9']['path'], 'ports/current-acceptance/run-contract.json')
        self.assertEqual(doc['run_contracts']['sigma10']['path'], 'sigma10-migration/current-campaign/run-contract.json')

        planned = self.restore()
        self.assertEqual((planned['status'], planned['checkout_files_missing'], planned['bindings_verified']), ('verified-plan', 5, 0))
        applied = self.restore(apply=True, link=True)
        self.assertEqual((applied['status'], applied['bindings_verified']), ('applied', 3))
        for rel, body in self.files.items():
            restored = self.restored / LAB / rel
            self.assertEqual(restored.read_bytes(), body)
            self.assertFalse(restored.stat().st_mode & 0o222)
            self.assertEqual(restored.stat().st_ino, self.blob(rel).stat().st_ino)
        again = self.restore(apply=True, link=True)
        self.assertEqual((again['checkout_files_missing'], again['bindings_verified']), (0, 3))

    def test_builder_refuses_when_checker_is_not_pass_and_writes_nothing(self):
        for status in ('fail', 'inconclusive', 'error'):
            with self.subTest(status=status):
                with self.assertRaisesRegex(ValueError, 'not pass'):
                    self.build(checker=lambda *_: {'status': status, 'failures': ['x']})
                self.assertFalse(self.output.exists())
        self.assertFalse((self.store / 'objects').exists())

    def test_builder_refuses_symlink_in_campaign_source(self):
        target = self.theme_lab / 'ports/current-acceptance/audit/a.json'
        (self.theme_lab / 'ports/current-acceptance/audit/link.json').symlink_to(target)
        with self.assertRaisesRegex(ValueError, 'symlink in campaign source'):
            self.build()
        self.assertFalse(self.output.exists())
        # A symlinked tree root is refused as well.
        shutil.rmtree(self.theme_lab / 'sigma10-migration/sources', ignore_errors=True)
        (self.theme_lab / 'sigma10-migration/sources').symlink_to(self.theme_lab / 'ports')
        with self.assertRaisesRegex(ValueError, 'symlink in campaign source'):
            self.build()

    def test_builder_refuses_case_colliding_and_duplicate_candidates(self):
        (self.theme_lab / 'ports/current-acceptance/Audit.json').write_bytes(b'x')
        (self.theme_lab / 'ports/current-acceptance/audit.json').write_bytes(b'y')
        with self.assertRaisesRegex(ValueError, 'case-colliding'):
            self.build()

    def test_inventory_sha_mismatch_fails_closed(self):
        self.build()
        with self.assertRaisesRegex(ValueError, 'inventory SHA-256 mismatch'):
            self.restore(sha='0' * 64)
        with self.assertRaisesRegex(ValueError, 'inventory SHA-256 mismatch'):
            self.restore(sha='not-a-sha')
        # Tampering with the inventory after pinning must not be accepted.
        self.output.write_text(self.output.read_text() + '\n')
        with self.assertRaisesRegex(ValueError, 'inventory SHA-256 mismatch'):
            self.restore(apply=True)
        self.assertFalse((self.restored / LAB / 'ports/current-acceptance/audit/a.json').exists())

    def test_missing_blob_fails_before_any_link(self):
        self.build()
        self.blob('current-campaign-acceptance.json').unlink()
        with self.assertRaisesRegex(ValueError, 'missing SHA-pinned blob'):
            self.restore(apply=True, link=True)
        self.assertFalse((self.restored / LAB / 'current-campaign-acceptance.json').exists())

    def test_size_mismatch_fails_closed(self):
        self.build()
        self.rewrite(lambda doc: doc['files'][0].__setitem__('size_bytes', doc['files'][0]['size_bytes'] + 1))
        with self.assertRaisesRegex(ValueError, 'size/SHA-256 mismatch'):
            self.restore(apply=True)
        self.assertEqual(list((self.restored / LAB).rglob('*.json')), [])

    def test_differing_existing_destination_is_never_overwritten(self):
        self.build()
        self.restore(apply=True, link=True)
        receipt = self.restored / LAB / 'current-campaign-acceptance.json'
        # Replace the hardlink rather than writing through it: writing through
        # would corrupt the shared store blob, which the transfer also refuses.
        receipt.unlink()
        receipt.write_bytes(b'{"forged":true}\n')
        with self.assertRaisesRegex(ValueError, 'existing checkout evidence size/SHA-256 mismatch'):
            self.restore(apply=True, link=True)
        self.assertEqual(receipt.read_bytes(), b'{"forged":true}\n')

    def test_symlink_ancestor_in_destination_is_refused(self):
        self.build()
        elsewhere = self.root / 'elsewhere'
        elsewhere.mkdir()
        (self.restored / LAB / 'ports').symlink_to(elsewhere)
        with self.assertRaisesRegex(ValueError, 'symlink in evidence path'):
            self.restore(apply=True, link=True)
        self.assertEqual(list(elsewhere.iterdir()), [])

    def test_disallowed_prefix_and_traversal_entries_are_rejected(self):
        self.build()
        def add(rel):
            def mutate(doc):
                doc['files'].append({'relative_path': rel, 'sha256': '1' * 64, 'size_bytes': 1})
            return mutate
        for rel in ('ports/black-highlighter-theme/candidate.css', 'publication/frozen-candidate-set.json',
                    'ports/current-acceptance/../../escape.json', 'current-campaign-acceptance.json.bak'):
            with self.subTest(rel=rel):
                self.rewrite(add(rel))
                with self.assertRaisesRegex(ValueError, 'disallowed or duplicate campaign inventory entry'):
                    self.restore()
                self.build()

    def test_receipt_and_run_contract_bindings_must_name_inventoried_bytes(self):
        self.build()
        self.rewrite(lambda doc: doc['receipt'].__setitem__('sha256', '2' * 64))
        with self.assertRaisesRegex(ValueError, 'receipt binding'):
            self.restore()
        self.build()
        self.rewrite(lambda doc: doc['run_contracts']['sigma10'].__setitem__('path', 'sigma10-migration/current-campaign/other.json'))
        with self.assertRaisesRegex(ValueError, 'sigma10 run contract binding'):
            self.restore()

    def test_inventory_from_a_non_passing_check_is_refused(self):
        self.build()
        self.rewrite(lambda doc: doc['checker'].__setitem__('status', 'fail'))
        with self.assertRaisesRegex(ValueError, 'passing completion check'):
            self.restore()

    def test_restore_is_independent_of_the_source_checkout(self):
        self.build()
        shutil.rmtree(self.checkout)
        restored = self.restore(apply=True, link=True)
        self.assertEqual(restored['status'], 'applied')
        self.assertEqual((self.restored / LAB / 'current-campaign-acceptance.json').read_bytes(), self.files['current-campaign-acceptance.json'])


if __name__ == '__main__':
    unittest.main()
