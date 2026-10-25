#!/usr/bin/env python3
"""Fetch missing SHA-pinned authority blobs BEFORE running offline acceptance.

Only explicit HTTPS content-addressed object endpoints are supported. A local
HTTP fixture is allowed solely with --allow-http-loopback for isolated tests.
No runtime browser or Wikidot access is performed by this command.
"""
import argparse
import fcntl
from http.client import IncompleteRead
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import time
from urllib import error, parse, request

SCRIPT = Path(__file__).with_name('content-addressed-authority-store.py')
spec = importlib.util.spec_from_file_location('authority_objects', SCRIPT)
objects = importlib.util.module_from_spec(spec)
spec.loader.exec_module(objects)

CONTENT_RANGE = re.compile(r'^bytes (\d+)-(\d+)/(\d+)$')


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('blob host redirects are forbidden')


def base_endpoint(value, *, allow_http_loopback=False):
    if any(ord(char) < 32 or ord(char) == 127 for char in value):
        raise ValueError('control characters in blob origin')
    endpoint = parse.urlsplit(value)
    if (endpoint.scheme != 'https' or not endpoint.netloc):
        if not (allow_http_loopback and endpoint.scheme == 'http'
                and endpoint.hostname in ('127.0.0.1', '::1')):
            raise ValueError('blob origin must be HTTPS (loopback HTTP requires an explicit test flag)')
    if (endpoint.username or endpoint.password or endpoint.query or endpoint.fragment
            or not endpoint.hostname or '%' in endpoint.path or '//' in endpoint.path
            or any(part in ('.', '..') for part in endpoint.path.split('/'))):
        raise ValueError('invalid or credential-bearing blob origin')
    return value.rstrip('/')


def partial_file(store, digest):
    return objects.authority.safe_file(store, f'partial/{digest[:2]}/{digest}.part', existing=False)


def check_capacity(store, destination, entries, missing):
    """Reserve room for acquisition AND restoration before starting transfer."""
    download = sum(missing.values())
    restored = sum(size for rel, (_, size) in entries.items()
                   if not objects.authority.safe_file(destination, rel, existing=False).exists())
    if download == 0 and restored == 0:
        return
    margin = 1024 ** 3
    if store.stat().st_dev == destination.stat().st_dev:
        if shutil.disk_usage(store).free < download + restored + margin:
            raise ValueError('insufficient free disk for blob acquisition and checkout restoration')
    else:
        if (shutil.disk_usage(store).free < download + margin
                or shutil.disk_usage(destination).free < restored + margin):
            raise ValueError('insufficient free disk for blob acquisition or checkout restoration')


def fetch_one(opener, store, base_url, digest, size, *, token=None, timeout=30, retries=3):
    target = objects.blob_path(store, digest)
    target.parent.mkdir(parents=True, exist_ok=True)
    target = objects.blob_path(store, digest)
    if target.exists():
        objects.verify_file(target, digest, size, 'cached blob')
        return False
    staging = partial_file(store, digest)
    staging.parent.mkdir(parents=True, exist_ok=True)
    staging = partial_file(store, digest)
    if size == 0 and not staging.exists():
        staging.touch(exist_ok=False)
    url = f'{base_url}/objects/{digest[:2]}/{digest}'
    for attempt in range(retries + 1):
        written = staging.stat().st_size if staging.exists() else 0
        if written > size:
            raise ValueError('partial blob exceeds its pinned byte length')
        if written == size:
            if objects.authority.checksum(staging) != digest:
                staging.unlink()
                raise ValueError('downloaded blob SHA-256 mismatch')
            staging.chmod(0o444)
            try:
                os.link(staging, target, follow_symlinks=False)
            except FileExistsError:
                objects.verify_file(target, digest, size, 'concurrent cached blob')
            staging.unlink()
            return True
        headers = {'Accept-Encoding': 'identity'}
        if written:
            headers['Range'] = f'bytes={written}-'
        if token:
            headers['Authorization'] = f'Bearer {token}'
        try:
            with opener.open(request.Request(url, headers=headers), timeout=timeout) as response:
                status = response.status
                if status not in (200, 206):
                    raise ValueError(f'unexpected blob HTTP status {status}')
                if response.headers.get('Content-Encoding', 'identity').lower() != 'identity':
                    raise ValueError('encoded blob response is forbidden')
                offset = written if status == 206 else 0
                if status == 206:
                    match = CONTENT_RANGE.fullmatch(response.headers.get('Content-Range', ''))
                    if (not match or int(match.group(1)) != written
                            or int(match.group(3)) != size
                            or int(match.group(2)) >= size):
                        raise ValueError('mismatched HTTP content-range for pinned blob')
                claimed = response.headers.get('Content-Length')
                if claimed is not None and (not claimed.isdigit() or int(claimed) > size - offset):
                    raise ValueError('response exceeds pinned blob size')
                with staging.open('ab' if offset else 'wb') as out:
                    while chunk := response.read(1024 * 1024):
                        offset += len(chunk)
                        if offset > size:
                            raise ValueError('download exceeded pinned blob size')
                        out.write(chunk)
                    out.flush()
                    os.fsync(out.fileno())
            if offset != size:
                raise OSError(f'partial blob: received {offset} of {size} bytes')
            # Publish only after an independent whole-object integrity check.
            if objects.authority.checksum(staging) != digest:
                staging.unlink()
                raise ValueError('downloaded blob SHA-256 mismatch')
            staging.chmod(0o444)
            try:
                os.link(staging, target, follow_symlinks=False)
            except FileExistsError:
                objects.verify_file(target, digest, size, 'concurrent cached blob')
            staging.unlink()
            return True
        except error.HTTPError as exc:
            if exc.code in (429, 500, 502, 503, 504) and attempt < retries:
                time.sleep(min(2 ** attempt, 4) / 10)
                continue
            raise  # 404/authorization/protocol failures must not retry.
        except ValueError:
            raise  # Integrity/protocol violations must not retry.
        except (error.URLError, OSError, TimeoutError, IncompleteRead) as exc:
            if attempt == retries:
                raise OSError(f'blob download failed after {retries + 1} attempts: {digest}') from exc
            time.sleep(min(2 ** attempt, 4) / 10)
    raise AssertionError('unreachable blob retry state')


def fetch(store_root, destination_root, inventory_path, inventory_sha, origin, *,
          apply=False, allow_http_loopback=False, token=None, retries=3, timeout=30):
    base_url = base_endpoint(origin, allow_http_loopback=allow_http_loopback)
    destination = Path(destination_root).resolve(strict=True)
    store_argument = Path(store_root)
    if store_argument.is_symlink():
        raise ValueError('store root must not be a symlink')
    if not store_argument.exists():
        if not apply:
            raise ValueError('store is missing (dry run cannot create it)')
        store_argument.mkdir(parents=True)
    store = store_argument.resolve(strict=True)
    if not store.is_dir() or store == destination or store in destination.parents or destination in store.parents:
        raise ValueError('store must be independent from checkout')
    entries, inventory = objects.inventory_files(destination, Path(inventory_path), inventory_sha)
    missing = {}
    for digest, size in sorted(inventory.items()):
        target = objects.blob_path(store, digest)
        if target.exists():
            objects.verify_file(target, digest, size, 'cached blob')
        else:
            missing[digest] = size
    if apply:
        check_capacity(store, destination, entries, missing)
        # Concurrent CI acquisition jobs must not append to the same .part
        # pathname. A cooperative whole-store lock also protects the scan of
        # pre-existing blobs from another fetch job's concurrent publication.
        lock = objects.authority.safe_file(store, '.fetch.lock', existing=False)
        fd = os.open(lock, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            opener = request.build_opener(NoRedirect())
            transferred = sum(fetch_one(opener, store, base_url, digest, size,
                                        token=token, retries=retries, timeout=timeout)
                              for digest, size in missing.items())
        finally:
            os.close(fd)
    else:
        transferred = 0
    return {'status': 'fetched' if apply else 'verified-plan',
            'inventory_sha256': inventory_sha, 'unique_blobs': len(inventory),
            'missing_before_fetch': len(missing), 'bytes_missing': sum(missing.values()),
            'objects_fetched': transferred}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--store-root', type=Path, required=True)
    parser.add_argument('--destination-root', type=Path, required=True)
    parser.add_argument('--inventory', type=Path, required=True)
    parser.add_argument('--inventory-sha256', required=True)
    parser.add_argument('--origin', required=True, help='HTTPS base URL serving objects/xx/SHA256')
    parser.add_argument('--bearer-token-env', help='environment variable name for a read-only bearer token')
    parser.add_argument('--allow-http-loopback', action='store_true', help='for isolated localhost integration tests only')
    parser.add_argument('--apply', action='store_true', help='fetch; default dry run does no network requests')
    args = parser.parse_args()
    token = None
    if args.bearer_token_env:
        token = os.getenv(args.bearer_token_env)
        if not token or '\n' in token or '\r' in token:
            parser.error('read-only bearer token environment variable is missing/invalid')
    print(json.dumps(fetch(args.store_root, args.destination_root, args.inventory,
                           args.inventory_sha256, args.origin, apply=args.apply,
                           allow_http_loopback=args.allow_http_loopback, token=token), indent=2))


if __name__ == '__main__':
    main()
