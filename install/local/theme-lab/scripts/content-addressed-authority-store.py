#!/usr/bin/env python3
"""Import or restore SHA-pinned authority evidence from a portable blob store.

The independently pinned inventory and checkout-local adaptation ledger define
the permitted paths and hashes. In restore mode the original source worktree
is never read. Offline, local-only transport; a separately backed-up copy of
the store and inventory is required for durable operational availability.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

restore_path = Path(__file__).with_name('restore-authority-evidence.py')
spec = importlib.util.spec_from_file_location('authority_restore', restore_path)
authority = importlib.util.module_from_spec(spec)
spec.loader.exec_module(authority)


def inventory_files(destination, inventory_path, expected_sha):
    if not authority.SHA.fullmatch(expected_sha) or authority.checksum(inventory_path) != expected_sha:
        raise ValueError('inventory SHA-256 mismatch')
    doc = json.loads(inventory_path.read_text())
    if doc.get('schema') != authority.SCHEMA or not isinstance(doc.get('files'), list) or not doc['files']:
        raise ValueError('invalid authority inventory schema/files')
    entries, roots = {}, {}
    for row in doc['files']:
        if not isinstance(row, dict):
            raise ValueError('invalid authority inventory entry')
        rel, digest, size = row.get('relative_path'), row.get('sha256'), row.get('size_bytes')
        if (not isinstance(rel, str) or not rel.startswith(authority.PREFIX)
                or not isinstance(digest, str) or not authority.SHA.fullmatch(digest)
                or type(size) is not int or size < 0 or rel in entries):
            raise ValueError('invalid or duplicate inventory entry')
        authority.safe_file(destination, rel, existing=False)
        entries[rel] = (digest, size)
        if row.get('ledger_root'):
            if row.get('ledger_hash_verified') is not True:
                raise ValueError(f'unverified ledger root: {rel}')
            roots[rel] = digest
    if roots != authority.ledger_roots(destination):
        raise ValueError('inventory/ledger authority identity mismatch')
    objects = {}
    for digest, size in entries.values():
        if digest in objects and objects[digest] != size:
            raise ValueError(f'inconsistent size for content-addressed object: {digest}')
        objects[digest] = size
    return entries, objects


def blob_path(store, digest):
    return authority.safe_file(store, f'objects/{digest[:2]}/{digest}', existing=False)


def verify_file(file, digest, size, label):
    if not file.is_file() or file.stat().st_size != size or authority.checksum(file) != digest:
        raise ValueError(f'{label} size/SHA-256 mismatch: {file}')


def install_file(source, destination, digest, size):
    """Byte-check while copying; atomic, non-overwriting and crash-resumable."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix='.theme-lab-blob-', dir=destination.parent)
    try:
        checksum = hashlib.sha256()
        copied = 0
        with os.fdopen(fd, 'wb') as out, source.open('rb') as inp:
            while chunk := inp.read(1024 * 1024):
                copied += len(chunk)
                checksum.update(chunk)
                out.write(chunk)
            out.flush()
            os.fsync(out.fileno())
        if copied != size or checksum.hexdigest() != digest:
            raise ValueError(f'input changed during copy: {source}')
        Path(tmp).chmod(0o444)
        os.link(tmp, destination, follow_symlinks=False)
    finally:
        Path(tmp).unlink(missing_ok=True)


def transfer(store_root, destination_root, inventory_path, expected_sha, *, mode, source_root=None, apply=False):
    if mode not in ('ingest', 'restore'):
        raise ValueError('mode must be ingest or restore')
    destination = Path(destination_root).resolve(strict=True)
    store_input = Path(store_root)
    if store_input.is_symlink():
        raise ValueError('store root cannot be a symlink')
    if not store_input.exists():
        if apply and mode == 'ingest':
            store_input.mkdir(parents=True)
        else:
            raise ValueError('store root is unavailable')
    store = store_input.resolve(strict=True)
    if not store.is_dir() or store == destination or store in destination.parents or destination in store.parents:
        raise ValueError('store and checkout must be independent directories')
    source = None
    if mode == 'ingest':
        if source_root is None:
            raise ValueError('ingest requires the source checkout')
        source = Path(source_root).resolve(strict=True)
        for other in (destination, store):
            if source == other or source in other.parents or other in source.parents:
                raise ValueError('source, store and destination must be independent')
    elif source_root is not None:
        raise ValueError('restore must not depend on the original source worktree')

    entries, objects = inventory_files(destination, Path(inventory_path), expected_sha)
    missing_objects = {}
    verified_objects = set()
    for rel, (digest, size) in entries.items():
        if mode == 'ingest':
            src = authority.safe_file(source, rel)
            verify_file(src, digest, size, 'source evidence')
        if digest in missing_objects:
            continue
        # Rechecking the same blob once per path can multiply multi-GB read
        # costs for deduplicated manifests. Verify each distinct SHA once.
        if digest in verified_objects:
            continue
        target = blob_path(store, digest)
        if target.exists():
            verify_file(target, digest, size, 'stored blob')
            verified_objects.add(digest)
        else:
            missing_objects[digest] = (rel, size)
    if mode == 'restore' and missing_objects:
        raise ValueError(f'missing SHA-pinned blob objects: {len(missing_objects)}; example {next(iter(missing_objects))}')

    missing_files = []
    for rel, (digest, size) in entries.items():
        target = authority.safe_file(destination, rel, existing=False)
        if target.exists():
            verify_file(target, digest, size, 'existing checkout evidence')
        else:
            missing_files.append((rel, digest, size))

    if apply:
        if mode == 'ingest':
            for digest, (rel, size) in missing_objects.items():
                target = blob_path(store, digest)
                target.parent.mkdir(parents=True, exist_ok=True)
                target = blob_path(store, digest)
                install_file(authority.safe_file(source, rel), target, digest, size)
        else:
            for rel, digest, size in missing_files:
                target = authority.safe_file(destination, rel, existing=False)
                target.parent.mkdir(parents=True, exist_ok=True)
                target = authority.safe_file(destination, rel, existing=False)
                install_file(blob_path(store, digest), target, digest, size)

    return {'status': 'applied' if apply else 'verified-plan', 'mode': mode,
            'inventory_sha256': expected_sha, 'inventory_files': len(entries),
            'unique_blobs': len(objects), 'missing_blobs': len(missing_objects),
            'bytes_to_ingest': sum(size for _, size in missing_objects.values()),
            'checkout_files_missing': len(missing_files),
            'checkout_bytes_missing': sum(size for _, _, size in missing_files)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', required=True, choices=('ingest', 'restore'))
    parser.add_argument('--source-root', type=Path)
    parser.add_argument('--destination-root', type=Path, required=True)
    parser.add_argument('--store-root', type=Path, required=True)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--inventory-sha256', required=True)
    parser.add_argument('--apply', action='store_true', help='default is read-only verification')
    args = parser.parse_args()
    print(json.dumps(transfer(args.store_root, args.destination_root, args.inventory,
                              args.inventory_sha256, mode=args.mode,
                              source_root=args.source_root, apply=args.apply), indent=2))


if __name__ == '__main__':
    main()
