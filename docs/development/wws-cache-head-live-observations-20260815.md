# WWS cache, HEAD, and range live observations

This note records anonymous, read-only Wikidot observations for issue #1370. No Wikidot page, file, account, or local runtime state was changed.

## Capture identity

- Capture window: 2026-08-14T17:09:38Z through 2026-08-14T17:11:46Z.
- Historical Wikijump source at capture (not the current denominator commit): `776ea0bf5d4be01d24226765e9c144313f00de46`.
- WWS route denominator: 30 registrations, 17 `ANY` and 13 `GET`, SHA-256 `f8e81d91f75b77a26a394e588c99485039cb844a0691205d1c342bcac650687a`.
- Client: `curl` with `--noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error`.

## Public file controls

The two positive controls were:

- `https://scp-wiki.wdfiles.com/local--files/nav:side/social-facebook.png`: 200, `image/png; charset=utf-8`, length 1453, `Last-Modified: Thu, 23 Jul 2020 06:38:39 GMT`, `ETag: "7fb65eb89b83d065f61660a440a9a9c5"`, and `Accept-Ranges: bytes`.
- `https://scp-wiki.wdfiles.com/local--files/nav:side/icon-Discord-2023.png`: 200, `image/png; charset=utf-8`, length 15031, `Last-Modified: Sun, 02 Jul 2023 23:21:33 GMT`, `ETag: "0393610695258e3ec8c7ca990039edd1"`, and `Accept-Ranges: bytes`.

Neither response included `Cache-Control`.

For both controls:

- Exact `If-None-Match` returned 304. A wrong ETag returned the full 200 response.
- `If-None-Match` plus `Range` returned 304, so conditional evaluation preceded range evaluation.
- `Range: bytes=0-15` returned 206 with 16 bytes and the exact total in `Content-Range`.
- Matching `If-Range` preserved 206. Wrong `If-Range` returned the full 200 response.
- HEAD returned the same selected metadata as GET, including 206 and `Content-Range` for a range request, with no body.

## Public code-block controls

The two positive controls were:

- `https://scp-wiki.wdfiles.com/local--code/scp-8822/1`: 200, `text/html; charset=utf-8`, `ETag: "8b6efb16d1eeb24cade043537ab7959b"`.
- `https://scp-jp.wdfiles.com/local--code/theme%3Aad-abyssum/1`: 200, `text/css; charset=utf-8`, `ETag: "c24834c01f898c30a31fc3ae6fc8a064"`.

Neither response included `Content-Length`, `Last-Modified`, `Accept-Ranges`, or `Cache-Control`.

For both controls:

- Exact `If-None-Match` returned a bare 304. A wrong ETag returned the baseline 200 response.
- HEAD used the same conditional behavior and returned no body.
- `Range`, matching `If-Range`, and wrong `If-Range` all returned the full 200 response. Code-block range requests were ignored.

## Public HTML-block controls

A supplemental anonymous capture on 2026-08-15 verified two positive controls:

- `scp-wiki` page `the-significant-others-part-b`, page ID `1260799294`, revision ID `1543488342`, live/corpus source SHA-256 `1a827468a5323227b60d67f4996d677fc3e8224c25c824b40861f9770e64d19f`: `https://scp-wiki.wdfiles.com/local--html/the-significant-others-part-b/ce7f19fcbd96efe6128fc7a5366475fbccde48e5-11264642292013236711/scp-wiki.wikidot.com/` returned 200 `text/html`, ETag `"b45c861ec9e800b5eff9a0e08529d325"`, and 502 body bytes with SHA-256 `83f071c542fd5629c5cb7d1f9861cb68b5344015bf6f9dbbbb7521b68235b045`.
- `scp-int` page `sangredereptil`, page ID `52188988`, revision ID `86479563`, live/corpus source SHA-256 `524066deea618069e2d4c9af3dfa70197be7ca1fcf1fca71bcbed778f39e423a`: `https://scp-int.wdfiles.com/local--html/sangredereptil/10e9b84cbc7189d8aaf0a8520a49adcb44ad45e8-884256985228152597/scp-int.wikidot.com/` returned 200 `text/html`, ETag `"63d4c87b205311a571f39f4c4cde87c8"`, and 1764 body bytes with SHA-256 `8381f14d79a2def324f7dcba5272f5424637973a45fccfcbf931c8734551f951`.

For both controls, HEAD returned 200 with no body, exact `If-None-Match` returned 304, a wrong ETag returned the full 200 response, and `Range`, matching `If-Range`, and wrong `If-Range` were ignored with the full 200 response. The responses included no `Content-Length`, `Last-Modified`, `Accept-Ranges`, or `Cache-Control`.

These controls establish terminal HTML-block HTTP semantics, not exact Wikijump route identity. Wikijump's numeric `/local--html/{page_slug}/{id}` route remains a compatibility redirect to `/-/html/{page_slug}/{id}` because the shipped iframe script's numeric fallback recognizes only the latter shape; the live hash/domain path needs a separate evidenced identity contract.

## Initial host transition

The Wikidot front door did not serve these representations directly. At 2026-08-14T17:11:45Z and 2026-08-14T17:11:46Z:

- `https://scp-wiki.wikidot.com/local--files/nav:side/social-facebook.png` returned 302 to `https://scp-wiki.wdfiles.com/local--files/nav%3Aside/social-facebook.png`.
- `https://scp-wiki.wikidot.com/local--code/scp-8822/1` returned 302 to `https://scp-wiki.wdfiles.com/local--code/scp-8822/1`.

The initial redirect and terminal WDFiles response are separate observable intervals.

## Evidence gaps

- `https://scp-wiki.wdfiles.com/local--html/scp-8822/1` remains an invalid control because it returned a missing-file-style 200 HTML page. The two positive controls above, rather than this negative control, support the HTML-block behavior.
- Missing `Cache-Control` on these four representations proves only these captures, not a universal policy for every site or resource.
- The historical route artifact `install/local/wikidot-verification/artifacts/pr1334-wws-route-attribution-no-thumbnails-20260810.json` is source attribution only and records `compatibility_verdict: not_evaluated`.

## Reproduction examples

```sh
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--files/nav:side/social-facebook.png'
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error -H 'If-None-Match: "7fb65eb89b83d065f61660a440a9a9c5"' --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--files/nav:side/social-facebook.png'
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error -H 'Range: bytes=0-15' -H 'If-Range: "7fb65eb89b83d065f61660a440a9a9c5"' --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--files/nav:side/social-facebook.png'
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error --head -H 'Range: bytes=0-15' --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--files/nav:side/social-facebook.png'
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error -H 'If-None-Match: "8b6efb16d1eeb24cade043537ab7959b"' --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--code/scp-8822/1'
curl --noproxy '*' --connect-timeout 10 --max-time 20 --silent --show-error -H 'Range: bytes=0-15' --dump-header - --output /dev/null 'https://scp-wiki.wdfiles.com/local--code/scp-8822/1'
```
