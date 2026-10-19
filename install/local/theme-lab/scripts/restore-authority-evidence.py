#!/usr/bin/env python3
"""Rehydrate SHA-pinned current-head authority evidence into a disposable checkout.

The inventory is a separately distributed supplement, not the signed 2026-10-07
acceptance archive. The source must be a known retained worktree; the output
must be an independent checkout. Never overwrite or follow symlinks.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile

PREFIX = 'install/local/theme-lab/ports/'
SCHEMA = 'wikijump.theme_lab_authority_archive_supplement_inventory.v1'
SHA = re.compile(r'^[a-f0-9]{64}$')


def checksum(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def safe_file(root, rel, *, existing=True):
    path = PurePosixPath(rel)
    if path.is_absolute() or not path.parts or any(part in ('', '.', '..') for part in rel.split('/')):
        raise ValueError(f'unsafe relative path: {rel}')
    current = root
    for index, part in enumerate(path.parts):
        current = current / part
        try:
            info = current.lstat()
        except FileNotFoundError:
            if existing:
                raise ValueError(f'missing evidence: {rel}') from None
            continue
        if stat.S_ISLNK(info.st_mode):
            raise ValueError(f'symlink in evidence path: {rel}')
        if index < len(path.parts) - 1 and not stat.S_ISDIR(info.st_mode):
            raise ValueError(f'non-directory ancestor: {rel}')
        if index == len(path.parts) - 1 and not stat.S_ISREG(info.st_mode):
            raise ValueError(f'non-regular evidence file: {rel}')
    return current


def ledger_roots(destination):
    ledger = json.loads(safe_file(destination, PREFIX + 'adaptation-authority.json').read_text())
    found = {}
    def walk(value):
        if isinstance(value, dict):
            rel, digest = value.get('path'), value.get('sha256')
            if isinstance(rel, str) and rel.startswith(('authority-evidence/', 'shared-fixtures/')) and isinstance(digest, str) and SHA.fullmatch(digest):
                if rel in found and found[rel] != digest:
                    raise ValueError(f'conflicting ledger authority identity: {rel}')
                found[rel] = digest
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(ledger)
    return {PREFIX + rel: digest for rel, digest in found.items()}


def restore(source, destination, inventory_path, expected_sha, *, apply=False):
    if not SHA.fullmatch(expected_sha):
        raise ValueError('expected inventory SHA-256 is required (64 lowercase hex characters)')
    if checksum(inventory_path) != expected_sha:
        raise ValueError('inventory SHA-256 mismatch')
    source, destination = source.resolve(strict=True), destination.resolve(strict=True)
    if source == destination or source in destination.parents or destination in source.parents:
        raise ValueError('source and destination checkouts must be independent')
    inventory = json.loads(inventory_path.read_text())
    if inventory.get('schema') != SCHEMA:
        raise ValueError('unsupported authority inventory schema')
    entries = inventory.get('files')
    if not isinstance(entries, list) or not entries:
        raise ValueError('empty authority inventory')
    roots = ledger_roots(destination)
    seen = set()
    inventory_roots = {}
    planned = []
    total = 0
    for entry in entries:
        rel, digest, size = entry.get('relative_path'), entry.get('sha256'), entry.get('size_bytes')
        if not isinstance(rel, str) or not rel.startswith(PREFIX) or not isinstance(digest, str) or not SHA.fullmatch(digest) or type(size) is not int or size < 0:
            raise ValueError(f'malformed authority inventory entry: {rel}')
        if rel in seen:
            raise ValueError(f'duplicate inventory path: {rel}')
        seen.add(rel)
        if entry.get('ledger_root'):
            inventory_roots[rel] = digest
            if entry.get('ledger_hash_verified') is not True:
                raise ValueError(f'ledger root not checked: {rel}')
        src = safe_file(source, rel)
        if src.stat().st_size != size or checksum(src) != digest:
            raise ValueError(f'source evidence size/SHA mismatch: {rel}')
        dst = safe_file(destination, rel, existing=False)
        if dst.exists():
            if dst.stat().st_size != size or checksum(dst) != digest:
                raise ValueError(f'existing destination differs: {rel}')
        else:
            planned.append((src, dst, rel, digest, size))
            total += size
    if inventory_roots != roots:
        missing = sorted(set(roots) - set(inventory_roots))
        extra = sorted(set(inventory_roots) - set(roots))
        raise ValueError(f'inventory/ledger authority identity mismatch: missing={missing[:3]}, extra={extra[:3]}')
    if apply:
        for src, dst, rel, digest, size in planned:
            dst.parent.mkdir(parents=True, exist_ok=True)
            safe_file(destination, rel, existing=False)
            fd, tempname = tempfile.mkstemp(prefix='.authority-restore-', dir=dst.parent)
            try:
                with os.fdopen(fd, 'wb') as out, src.open('rb') as inp:
                    while block := inp.read(1024 * 1024):
                        out.write(block)
                    out.flush()
                    os.fsync(out.fileno())
                temp = Path(tempname)
                if temp.stat().st_size != size or checksum(temp) != digest:
                    raise ValueError(f'copied evidence mismatch: {rel}')
                temp.chmod(0o444)
                # Hardlink atomically creates the target only if absent; never replace.
                os.link(temp, dst, follow_symlinks=False)
            finally:
                Path(tempname).unlink(missing_ok=True)
    return {'status': 'restored' if apply else 'verified-plan', 'inventory_sha256': expected_sha,
            'ledger_roots': len(roots), 'inventory_files': len(entries),
            'files_to_restore': len(planned), 'bytes_to_restore': total}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, required=True)
    parser.add_argument('--destination-root', type=Path, required=True)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--inventory-sha256', required=True)
    parser.add_argument('--restore', action='store_true', help='copy only after all source and ledger identities have passed')
    args = parser.parse_args()
    print(json.dumps(restore(args.source_root, args.destination_root, args.inventory,
                             args.inventory_sha256, apply=args.restore), indent=2))


if __name__ == '__main__':
    main()
