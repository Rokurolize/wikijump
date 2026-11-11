# WWS

Wilson's Web Server serves the user-generated content of a Wikijump site: uploaded
files, user avatars, resized image variants, rendered text blocks, `robots.txt`,
and the `/.well-known` responses. It is a read-only content service. Every write
goes through [Deepwell](../deepwell/), which owns the database and the page
rendering.

Like the rest of Wikijump, this is licensed as AGPL 3.0 or later.

## Structure

* `src/route.rs` &mdash; The Axum router and the middleware that rejects a request whose internal site header cannot be parsed.
* `src/handler/` &mdash; One module per content kind (files, avatars, resized images, text blocks, redirects, `robots.txt`, `/.well-known`).
* `src/fetch.rs` &mdash; Reads blobs out of S3, including byte ranges.
* `src/state.rs` &mdash; The shared server state: the S3 buckets, the Redis cache, and the Deepwell client.
* `src/deepwell.rs` &mdash; The Deepwell JSON-RPC calls this service makes, and the structures they return.
* `src/cache.rs` &mdash; The Redis-backed cache of Deepwell metadata.

## Configuration

WWS reads its configuration from the environment; see `.env.example` for the
full list. The required variables are `DEEPWELL_URL`, `DEEPWELL_RPC_TOKEN`,
`REDIS_URL`, `S3_FILES_BUCKET`, `S3_TEXT_BLOCKS_BUCKET`, `S3_PATH_STYLE`, and
either the AWS region or the custom region and endpoint. The service listens on
`[::]:3466` unless `ADDRESS` or the command-line options say otherwise.

```sh
$ cargo run -- [-q] [--disable-deepwell-check] [-P <pid-file>] [-H <host>] [-p <port>]
```

## Internal headers

WWS is not meant to be reached directly. The reverse proxy resolves the site
for the request and passes that resolution on in internal headers:
`x-wikijump-site-id`, `x-wikijump-site-slug`, `x-wikijump-page-slug`,
`x-wikijump-filename`, `x-wikijump-target-server`, and `x-wikijump-basic-error`.
A request that arrives without them is not a valid Wikijump request, and the
handlers reject it instead of serving content for the wrong site.

## Testing

```sh
$ cargo test
```

Two of the tests build their state against a Redis server on `127.0.0.1:6379`;
run the project's Valkey image there first if they fail to connect.
