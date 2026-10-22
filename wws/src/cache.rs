/*
 * cache.rs
 *
 * Wilson's Web Server - Serves a zoo of user-generated content
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

//! Manages cached data in Redis.
//!
//! Whenever you make changes to this module, make sure that the code is
//! compatible with DEEPWELL's Redis code.

use crate::error::Result;
use redis::{AsyncCommands, AsyncConnectionConfig};
use std::future::Future;
use std::time::Duration;

/// The reply and connection timeouts DEEPWELL uses (`deepwell/src/redis.rs`):
/// a saturated host can hold a Valkey reply past the client library's 500 ms
/// default, while a reply this late means Valkey is unreachable.
const REDIS_TIMEOUT: Duration = Duration::from_secs(5);

/// How long a cached avatar hash is trusted. DEEPWELL deletes the entry when a
/// user's avatar changes; the expiry bounds a re-cache that races that commit
/// and any write path that bypasses it, so a removed avatar stops being served
/// (#2556).
pub const AVATAR_CACHE_TTL: Duration = Duration::from_secs(60);

/// How long a cached preferred domain is trusted. WWS has no write path for
/// preferred domains: DEEPWELL changes them (the site's `preferred_domain`
/// update, and custom-domain create and remove) and does not delete this key
/// yet (see the TODO in `deepwell/src/services/site/service.rs`). The expiry is
/// therefore the only bound on a redirect to a changed or removed domain. It
/// matches the avatar bound, and a site costs each WWS instance about one
/// DEEPWELL lookup a minute.
pub const SITE_DOMAIN_CACHE_TTL: Duration = Duration::from_secs(60);

fn connection_config() -> AsyncConnectionConfig {
    AsyncConnectionConfig::new()
        .set_connection_timeout(Some(REDIS_TIMEOUT))
        .set_response_timeout(Some(REDIS_TIMEOUT))
}

macro_rules! get_connection {
    ($client:expr) => {
        $client
            .get_multiplexed_async_connection_with_config(&connection_config())
            .await?
    };
}

/// Helper macro to build redis keys.
///
/// This way we avoid issues with inconsistent key names,
/// forgetting to update its values or other footguns.
macro_rules! redis_key {
    (site_domain => $site_id:expr $(,)?) => {
        format!("site_domain:{}", $site_id)
    };
    (user_avatar => $user_id:expr $(,)?) => {
        format!("user_avatar:{}", $user_id)
    };
}

#[derive(Debug)]
pub struct Cache {
    client: redis::Client,
}

impl Cache {
    /// Connect to the Redis cluster.
    pub fn connect(redis_url: &str) -> Result<Self> {
        let client = redis::Client::open(redis_url)?;
        Ok(Cache { client })
    }

    /// Gets the preferred domain for a given site: the cached value while it is
    /// fresh, otherwise the result of `fetch` (see `SITE_DOMAIN_CACHE_TTL`).
    pub async fn get_or_fetch_site_domain<F, Fut>(
        &self,
        site_id: i64,
        fetch: F,
    ) -> Result<String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<String>>,
    {
        let mut conn = get_connection!(self.client);
        read_through_site_domain(&mut conn, site_id, fetch).await
    }

    pub async fn get_avatar(&self, user_id: i64) -> Result<Option<String>> {
        let mut conn = get_connection!(self.client);
        let key = redis_key!(user_avatar => user_id);
        Ok(conn.get(key).await?)
    }

    pub async fn set_avatar(&self, user_id: i64, avatar_s3_hash: &str) -> Result<()> {
        let mut conn = get_connection!(self.client);
        let key = redis_key!(user_avatar => user_id);
        conn.set_ex::<_, _, ()>(key, avatar_s3_hash, AVATAR_CACHE_TTL.as_secs())
            .await?;
        Ok(())
    }
}

/// Reads a site's cached preferred domain.
async fn read_site_domain<C: AsyncCommands>(
    conn: &mut C,
    site_id: i64,
) -> Result<Option<String>> {
    let key = redis_key!(site_domain => site_id);
    Ok(conn.get(key).await?)
}

/// Caches a site's preferred domain for `SITE_DOMAIN_CACHE_TTL`.
async fn write_site_domain<C: AsyncCommands>(
    conn: &mut C,
    site_id: i64,
    preferred_domain: &str,
) -> Result<()> {
    let key = redis_key!(site_domain => site_id);
    conn.set_ex::<_, _, ()>(key, preferred_domain, SITE_DOMAIN_CACHE_TTL.as_secs())
        .await?;
    Ok(())
}

/// Returns a site's cached preferred domain. On a miss, or once the entry has
/// expired, `fetch` asks DEEPWELL and the answer is cached with a fresh TTL. A
/// failed fetch caches nothing, so the next request asks again.
async fn read_through_site_domain<C, F, Fut>(
    conn: &mut C,
    site_id: i64,
    fetch: F,
) -> Result<String>
where
    C: AsyncCommands,
    F: FnOnce() -> Fut,
    Fut: Future<Output = Result<String>>,
{
    if let Some(preferred_domain) = read_site_domain(conn, site_id).await? {
        return Ok(preferred_domain);
    }

    let preferred_domain = fetch().await?;
    write_site_domain(conn, site_id, &preferred_domain).await?;
    Ok(preferred_domain)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::Error;
    use redis::aio::ConnectionLike;
    use redis::{
        Arg, Cmd, ErrorKind, Pipeline, RedisError, RedisFuture, RedisResult, Value,
    };
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    const SITE_ID: i64 = 42;

    /// In-memory stand-in for the Redis commands this module issues (GET, and
    /// SET with EX). The clock is virtual, so a test passes an expiry by
    /// advancing it rather than sleeping. Clones share one keyspace.
    #[derive(Clone, Debug, Default)]
    struct FakeValkey {
        state: Arc<Mutex<FakeState>>,
    }

    #[derive(Debug, Default)]
    struct FakeState {
        now: Duration,
        /// Key to value, and the virtual time at which the key expires.
        keys: HashMap<Vec<u8>, (Vec<u8>, Option<Duration>)>,
        commands: Vec<Vec<u8>>,
    }

    impl FakeValkey {
        fn advance(&self, by: Duration) {
            self.state.lock().unwrap().now += by;
        }

        /// Every command received so far, space-joined, in order.
        fn commands(&self) -> Vec<String> {
            self.state
                .lock()
                .unwrap()
                .commands
                .iter()
                .map(|command| String::from_utf8_lossy(command).into_owned())
                .collect()
        }

        fn execute(&self, args: Vec<Vec<u8>>) -> RedisResult<Value> {
            let mut state = self.state.lock().unwrap();
            state.commands.push(args.join(&b' '));
            let now = state.now;
            let name = args[0].to_ascii_uppercase();
            match (name.as_slice(), args.len()) {
                (b"GET", 2) => {
                    let live = state
                        .keys
                        .get(&args[1])
                        .filter(|(_, expires_at)| expires_at.is_none_or(|at| now < at));
                    Ok(live.map_or(Value::Nil, |(value, _)| {
                        Value::BulkString(value.clone())
                    }))
                }
                (b"SET", 3) => {
                    state.keys.insert(args[1].clone(), (args[2].clone(), None));
                    Ok(Value::Okay)
                }
                (b"SET", 5) if args[3].eq_ignore_ascii_case(b"EX") => {
                    let seconds: u64 =
                        std::str::from_utf8(&args[4]).unwrap().parse().unwrap();
                    let expires_at = now + Duration::from_secs(seconds);
                    state
                        .keys
                        .insert(args[1].clone(), (args[2].clone(), Some(expires_at)));
                    Ok(Value::Okay)
                }
                _ => Err(RedisError::from((
                    ErrorKind::Client,
                    "FakeValkey implements only GET and SET ... EX",
                ))),
            }
        }
    }

    impl ConnectionLike for FakeValkey {
        fn req_packed_command<'a>(&'a mut self, cmd: &'a Cmd) -> RedisFuture<'a, Value> {
            let args = cmd
                .args_iter()
                .map(|arg| match arg {
                    Arg::Simple(bytes) => bytes.to_vec(),
                    _ => unreachable!("the cache issues only simple arguments"),
                })
                .collect();
            Box::pin(std::future::ready(self.execute(args)))
        }

        fn req_packed_commands<'a>(
            &'a mut self,
            _pipeline: &'a Pipeline,
            _offset: usize,
            _count: usize,
        ) -> RedisFuture<'a, Vec<Value>> {
            Box::pin(std::future::ready(Err(RedisError::from((
                ErrorKind::Client,
                "FakeValkey has no pipelines",
            )))))
        }

        fn get_db(&self) -> i64 {
            0
        }
    }

    /// Stands in for DEEPWELL's `site_domain` RPC. It counts lookups and
    /// answers with the domain DEEPWELL currently holds.
    #[derive(Clone, Debug)]
    struct FakeDeepwell {
        domain: Arc<Mutex<String>>,
        lookups: Arc<Mutex<usize>>,
    }

    impl FakeDeepwell {
        fn new(domain: &str) -> Self {
            Self {
                domain: Arc::new(Mutex::new(domain.to_owned())),
                lookups: Arc::default(),
            }
        }

        fn change_domain(&self, domain: &str) {
            *self.domain.lock().unwrap() = domain.to_owned();
        }

        fn lookups(&self) -> usize {
            *self.lookups.lock().unwrap()
        }

        async fn site_domain(&self) -> Result<String> {
            *self.lookups.lock().unwrap() += 1;
            Ok(self.domain.lock().unwrap().clone())
        }
    }

    /// One request's lookup, through the same read-through path that
    /// `Cache::get_or_fetch_site_domain` runs.
    async fn lookup(valkey: &FakeValkey, deepwell: &FakeDeepwell) -> String {
        let mut conn = valkey.clone();
        read_through_site_domain(&mut conn, SITE_ID, || deepwell.site_domain())
            .await
            .unwrap()
    }

    #[test]
    fn redis_keys_include_all_identifying_parts() {
        assert_eq!(redis_key!(site_domain => 42), "site_domain:42");
        // DEEPWELL deletes this exact key when an avatar changes (#2556).
        assert_eq!(redis_key!(user_avatar => 7), "user_avatar:7");
    }

    #[test]
    fn cached_avatars_expire() {
        assert!(AVATAR_CACHE_TTL.as_secs() > 0);
        assert!(AVATAR_CACHE_TTL <= Duration::from_secs(300));
    }

    #[test]
    fn cache_connect_validates_redis_url() {
        assert!(Cache::connect("redis://127.0.0.1/").is_ok());
        assert!(Cache::connect("not a redis url").is_err());
    }

    #[test]
    fn cached_site_domains_expire() {
        assert!(SITE_DOMAIN_CACHE_TTL.as_secs() > 0);
        assert!(SITE_DOMAIN_CACHE_TTL <= Duration::from_secs(300));
    }

    #[tokio::test]
    async fn site_domain_entries_are_written_with_the_ttl() {
        let valkey = FakeValkey::default();
        let deepwell = FakeDeepwell::new("first.example");

        assert_eq!(lookup(&valkey, &deepwell).await, "first.example");

        assert_eq!(
            valkey.commands(),
            [
                "GET site_domain:42",
                "SET site_domain:42 first.example EX 60",
            ],
        );
    }

    #[tokio::test]
    async fn cached_site_domain_is_served_without_deepwell_within_the_ttl() {
        let valkey = FakeValkey::default();
        let deepwell = FakeDeepwell::new("first.example");
        assert_eq!(lookup(&valkey, &deepwell).await, "first.example");

        // DEEPWELL now holds a different domain. Until the entry expires, the
        // request is answered from the cache exactly as before, with no lookup.
        deepwell.change_domain("changed.example");
        valkey.advance(SITE_DOMAIN_CACHE_TTL - Duration::from_secs(1));

        assert_eq!(lookup(&valkey, &deepwell).await, "first.example");
        assert_eq!(deepwell.lookups(), 1);
    }

    #[tokio::test]
    async fn expired_site_domain_is_refetched_and_recached_with_a_fresh_ttl() {
        let valkey = FakeValkey::default();
        let deepwell = FakeDeepwell::new("first.example");
        assert_eq!(lookup(&valkey, &deepwell).await, "first.example");
        deepwell.change_domain("changed.example");

        // The entry expires exactly one TTL after it was written.
        valkey.advance(SITE_DOMAIN_CACHE_TTL - Duration::from_secs(1));
        assert_eq!(lookup(&valkey, &deepwell).await, "first.example");
        valkey.advance(Duration::from_secs(1));
        assert_eq!(lookup(&valkey, &deepwell).await, "changed.example");
        assert_eq!(deepwell.lookups(), 2);

        // The refetch was cached with a new TTL, so the new value is served
        // until one full TTL after the refetch, and no sooner.
        valkey.advance(SITE_DOMAIN_CACHE_TTL - Duration::from_secs(1));
        assert_eq!(lookup(&valkey, &deepwell).await, "changed.example");
        assert_eq!(deepwell.lookups(), 2);
        valkey.advance(Duration::from_secs(1));
        assert_eq!(lookup(&valkey, &deepwell).await, "changed.example");
        assert_eq!(deepwell.lookups(), 3);

        let writes: Vec<String> = valkey
            .commands()
            .into_iter()
            .filter(|command| command.starts_with("SET "))
            .collect();
        assert_eq!(
            writes,
            [
                "SET site_domain:42 first.example EX 60",
                "SET site_domain:42 changed.example EX 60",
            ],
        );
    }

    #[tokio::test]
    async fn failed_site_domain_lookup_is_not_cached() {
        let valkey = FakeValkey::default();
        let mut conn = valkey.clone();
        let failed = read_through_site_domain(&mut conn, SITE_ID, || async {
            Err::<String, Error>(Error::DeepwellBusy)
        })
        .await;
        assert!(matches!(failed, Err(Error::DeepwellBusy)));
        assert_eq!(valkey.commands(), ["GET site_domain:42"]);

        // Nothing was cached, so the next request asks DEEPWELL and succeeds.
        let deepwell = FakeDeepwell::new("recovered.example");
        assert_eq!(lookup(&valkey, &deepwell).await, "recovered.example");
        assert_eq!(deepwell.lookups(), 1);
    }
}
