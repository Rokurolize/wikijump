#!/usr/bin/env python3
"""Acquire one public Wikidot page source for an explicit Theme Lab refresh.

This is a live-evidence helper, not a regression test. It accepts only public
HTTPS *.wikidot.com pages, obtains the anonymous token7 cookie from the page,
then calls the observed viewsource/ViewSourceModule boundary. The caller owns
the decision to perform the external acquisition and must follow the
repository's compatibility evidence policy.
"""

from __future__ import annotations

import argparse
import hashlib
import html.parser
import http.cookiejar
import json
import os
import re
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

USER_AGENT = "Wikijump-Theme-Lab/1.0 source-acquisition"


def validate_public_wikidot_url(value: str) -> urllib.parse.ParseResult:
    parsed = urllib.parse.urlparse(value)
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https":
        raise ValueError("source acquisition requires https")
    if parsed.username or parsed.password:
        raise ValueError("source URL must not contain credentials")
    if not host.endswith(".wikidot.com"):
        raise ValueError("source acquisition accepts only public *.wikidot.com pages")
    if parsed.port not in (None, 443):
        raise ValueError("source acquisition accepts only the normal HTTPS port")
    return parsed


class _PageSourceParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._inside = False
        self._depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if not self._inside and tag == "div" and "page-source" in (attr.get("class") or "").split():
            self._inside = True
            self._depth = 1
            return
        if self._inside:
            if tag == "div":
                self._depth += 1
            if tag == "br":
                self.parts.append("\n")

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._inside and tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if self._inside and tag == "div":
            self._depth -= 1
            if self._depth == 0:
                self._inside = False

    def handle_data(self, data: str) -> None:
        if self._inside:
            self.parts.append(data)


def decode_viewsource_body(body: str) -> str:
    # Wikidot formats every rendered <br /> with a following source newline.
    # Collapse that formatting newline before parsing so one source newline
    # remains one newline.
    body = re.sub(r"<br\s*/?>\n?", "\n", body, flags=re.IGNORECASE)
    parser = _PageSourceParser()
    parser.feed(body)
    if not parser.parts:
        raise ValueError("ViewSource response did not contain .page-source")
    source = "".join(parser.parts)
    if source.startswith("\n\t"):
        source = source[2:]
    elif source.startswith("\t"):
        source = source[1:]
    if source.endswith("\n"):
        source = source[:-1]
    return source


def _plain_html_fragment(fragment: str) -> str:
    parser = _PageSourceParser()
    wrapped = f'<div class="page-source">{fragment}</div>'
    parser.feed(wrapped)
    return "".join(parser.parts).strip()


def parse_page_metadata(page_html: str) -> dict[str, object]:
    def one(pattern: str) -> str | None:
        match = re.search(pattern, page_html)
        return match.group(1) if match else None

    page_id = one(r"WIKIREQUEST\.info\.pageId\s*=\s*([0-9]+);")
    site_id = one(r"WIKIREQUEST\.info\.siteId\s*=\s*([0-9]+);")
    slug = one(r'WIKIREQUEST\.info\.pageUnixName\s*=\s*"([^"]+)";')
    page_info_match = re.search(
        r'<div id="page-info"[^>]*>(.*?)</div>', page_html, flags=re.DOTALL | re.IGNORECASE
    )
    page_info_html = page_info_match.group(1) if page_info_match else ""
    page_info_text = _plain_html_fragment(page_info_html) if page_info_html else None
    revision = None
    if page_info_text:
        match = re.search(
            r"(?:revision|révision|리비전|リビジョン|revisión|version)\D*([0-9]+)",
            page_info_text,
            flags=re.IGNORECASE,
        )
        if match:
            revision = int(match.group(1))
    updated_unix = None
    if page_info_html:
        match = re.search(r"\bodate\s+time_([0-9]+)\b", page_info_html)
        if match:
            updated_unix = int(match.group(1))
    return {
        "page_id": int(page_id) if page_id else None,
        "site_id": int(site_id) if site_id else None,
        "slug": slug,
        "revision": revision,
        "page_info": page_info_text,
        "updated_at": (
            datetime.fromtimestamp(updated_unix, tz=timezone.utc).isoformat().replace("+00:00", "Z")
            if updated_unix is not None
            else None
        ),
    }


def acquire(url: str) -> tuple[str, dict[str, object]]:
    parsed = validate_public_wikidot_url(url)
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with opener.open(request, timeout=20) as response:
        page_html = response.read().decode("utf-8", errors="strict")
        final_url = response.geturl()
    final_parsed = validate_public_wikidot_url(final_url)
    if final_parsed.hostname != parsed.hostname:
        raise RuntimeError("source acquisition redirected to a different Wikidot site")
    metadata = parse_page_metadata(page_html)
    page_id = metadata["page_id"]
    if page_id is None:
        raise RuntimeError("rendered page did not expose WIKIREQUEST.info.pageId")
    token = next((cookie.value for cookie in jar if cookie.name == "wikidot_token7"), None)
    if not token:
        raise RuntimeError("rendered page did not set anonymous wikidot_token7")

    form = urllib.parse.urlencode(
        {
            "moduleName": "viewsource/ViewSourceModule",
            "page_id": str(page_id),
            "wikidot_token7": token,
        }
    ).encode()
    connector = urllib.parse.urlunparse(
        (parsed.scheme, parsed.netloc, "/ajax-module-connector.php", "", "", "")
    )
    request = urllib.request.Request(
        connector,
        data=form,
        headers={
            "User-Agent": USER_AGENT,
            "Content-Type": "application/x-www-form-urlencoded",
            "Referer": final_url,
        },
    )
    with opener.open(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8", errors="strict"))
    if payload.get("status") != "ok" or not isinstance(payload.get("body"), str):
        raise RuntimeError(f"ViewSource failed with status {payload.get('status')!r}")
    source = decode_viewsource_body(payload["body"])
    metadata.update(
        {
            "requested_url": url,
            "final_url": final_url,
            "source_sha256": hashlib.sha256(source.encode()).hexdigest(),
            "source_bytes": len(source.encode()),
        }
    )
    return source, metadata


def retained_source(output: Path, metadata_path: Path, url: str) -> tuple[str, dict[str, object]]:
    if not output.exists() and not metadata_path.exists():
        raise FileNotFoundError
    if not output.exists() or not metadata_path.exists():
        raise RuntimeError("retained source is partial; refuse implicit reacquisition")
    source = output.read_text(encoding="utf-8")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("requested_url") != url:
        raise RuntimeError("retained source URL does not match the requested URL")
    digest = hashlib.sha256(source.encode()).hexdigest()
    if metadata.get("source_sha256") != digest:
        raise RuntimeError("retained source hash does not match metadata")
    if metadata.get("source_bytes") != len(source.encode()):
        raise RuntimeError("retained source byte count does not match metadata")
    return source, metadata


def atomic_write(path: Path, data: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(temporary, path)
    fsync_directory(path.parent)


def fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--metadata", required=True)
    parser.add_argument(
        "--refresh",
        action="store_true",
        help="perform an explicit live refresh even when retained source evidence exists",
    )
    args = parser.parse_args()
    validate_public_wikidot_url(args.url)
    output = Path(args.output)
    metadata_path = Path(args.metadata)
    barrier = metadata_path.with_name(f"{metadata_path.name}.acquiring")
    if barrier.exists():
        raise RuntimeError(
            f"unfinished acquisition barrier exists: {barrier}; inspect the prior failure before retrying"
        )
    if not args.refresh:
        try:
            _, metadata = retained_source(output, metadata_path, args.url)
        except FileNotFoundError:
            pass
        else:
            print(json.dumps({**metadata, "acquisition_mode": "retained"}, ensure_ascii=False))
            return

    barrier.parent.mkdir(parents=True, exist_ok=True)
    with barrier.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps({"requested_url": args.url}, ensure_ascii=False) + "\n")
        handle.flush()
        os.fsync(handle.fileno())
    fsync_directory(barrier.parent)
    try:
        source, metadata = acquire(args.url)
        atomic_write(output, source)
        atomic_write(metadata_path, json.dumps(metadata, ensure_ascii=False, indent=2) + "\n")
    except Exception:
        # Leave the durable barrier in place. A later run fails closed until a
        # human/agent inspects the partial acquisition instead of guessing that
        # another network request is safe.
        raise
    else:
        barrier.unlink()
        fsync_directory(barrier.parent)
    print(json.dumps({**metadata, "acquisition_mode": "live-refresh"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
