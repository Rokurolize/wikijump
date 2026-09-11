## DEEPWELL Integration Testing

Here, we use [Rust's integration testing](https://doc.rust-lang.org/rust-by-example/testing/integration_testing.html) to check the behavior of `deepwell` as a whole. This means that these tests lack access to its internal functions and **should call its JSONRPC API to affect change and verify outputs**. However, using "service" structs for immutable operations as part of test state assertions is acceptable.

To give a simple example, we can test that basic page operations work through a test that calls the following:
1. `page_get` (assert page doesn't exist)
2. `page_create`
3. `page_get` (assert page does exist)
4. `page_edit`
5. `page_get` (assert page has new content)
6. `page_delete`
7. `page_get` (assert page doesn't exist)

### Requirements

Integration testing runs real deepwell processing code when it receives requests, and so needs a local database, Redis/Valkey instance, and S3-compatible object store. All changes to the database are reverted, but reverting changes to the remaining two are not yet implemented. The code assumes that database migrations and seeding have already been run.

Run the full integration suite with one Rust test thread and an 8 MiB test-thread
stack:

```sh
RUST_MIN_STACK=8388608 cargo test -- --test-threads 1
```

The tests deliberately share the seeded database and exercise row-locking paths,
so running stateful integration cases concurrently can deadlock otherwise. Some
renderer compatibility regressions also exceed Rust's default test-thread stack
in debug builds. The repository preflight uses the same command.

If you are running Wikijump locally, all three backing services are provided for
you. Use the serial command above rather than an unconstrained `cargo test`.
More specifically, the suite needs the local database, cache, and files
services plus completed migrations and seeding.

GitHub Actions intentionally does not execute this integration suite. The
maintained WSL preflight is the validation authority and runs the same
network-guarded serial command before merge.

### Quickstart Examples

If you're testing stateless methods (e.g. string translation, Caddyfile generation), then see [`tests/locale.rs`](./locale.rs).

If you're testing stateful methods (e.g. user creation, content filters), then see [`tests/page.rs`](./page.rs).

### Internals

Integration tests work by constructing a local `TestRunner` instance, which contains the `ServerState`, and starts a database transaction to contain all of the test's database changes. This instance can expose its `ServerContext` via the `.context()` method. This corresponds with the wrapping each JSONRPC method receives.

This database transaction is automatically rolled back when the test ends, regardless of whether or not the test itself passed. It uses the built-in configuration specified by `Config::integration_testing()`.

You can initialize this environment by running `TestRunner::setup().await` at the start of your integration test. This is found in the `common` module, which also has a series of useful helper functions and macros. It also contains `common::IP_ADDRESS` as a dummy value to pass in for JSONRPC requests which require the caller's IP address.
