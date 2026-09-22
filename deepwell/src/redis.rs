/*
 * redis.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
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

use crate::error::prelude::*;
use crate::services::job::{
    JOB_QUEUE_DELAY, JOB_QUEUE_MAXIMUM_SIZE, JOB_QUEUE_NAME, JOB_QUEUE_PROCESS_TIME, Job,
    JobService,
};
use redis::aio::MultiplexedConnection;
use redis::{ErrorKind, RedisError, ServerErrorKind};
use rsmq_async::{Rsmq, RsmqConnection, RsmqError};
use std::future::Future;
use std::time::Duration;
use tokio::time::Instant;
use uuid::Uuid;

const RSMQ_NAMESPACE: &str = "rsmq";
const RSMQ_REALTIME: bool = false;
const LIFT_EXPIRED_PUNISHMENTS_SEED_VERSION: &str = "v1";
const RECURRING_JOB_SEED_LOCK_SECONDS: u64 = 300;

const STARTUP_RETRY_INITIAL_DELAY: Duration = Duration::from_millis(25);
const STARTUP_RETRY_MAX_DELAY: Duration = Duration::from_millis(500);
const STARTUP_RETRY_DEADLINE: Duration = Duration::from_secs(15);
const STARTUP_RETRY_JITTER_RATIO: f64 = 0.25;

/// True only for errors that can occur while Redis/Valkey is still starting:
/// dataset load (`BusyLoading`) and transient connection establishment failures.
///
/// Authentication, invalid configuration, parse, ACL, and other permanent
/// failures must fail immediately so a bad deployment is never masked.
fn is_startup_transient_redis_error(error: &RedisError) -> bool {
    match error.kind() {
        ErrorKind::Server(ServerErrorKind::BusyLoading) => true,
        ErrorKind::Io => {
            error.is_connection_refusal()
                || error.is_connection_dropped()
                || error.is_timeout()
        }
        _ => false,
    }
}

fn is_startup_transient_rsmq_error(error: &RsmqError) -> bool {
    match error {
        RsmqError::RedisError(error) => is_startup_transient_redis_error(error),
        _ => false,
    }
}

#[derive(Debug)]
enum StartupAttemptError {
    Redis(RedisError),
    Rsmq(RsmqError),
}

impl StartupAttemptError {
    fn is_transient(&self) -> bool {
        match self {
            StartupAttemptError::Redis(error) => is_startup_transient_redis_error(error),
            StartupAttemptError::Rsmq(error) => is_startup_transient_rsmq_error(error),
        }
    }
}

impl From<RedisError> for StartupAttemptError {
    fn from(error: RedisError) -> Self {
        StartupAttemptError::Redis(error)
    }
}

impl From<RsmqError> for StartupAttemptError {
    fn from(error: RsmqError) -> Self {
        StartupAttemptError::Rsmq(error)
    }
}

impl std::fmt::Display for StartupAttemptError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StartupAttemptError::Redis(error) => write!(f, "{error}"),
            StartupAttemptError::Rsmq(error) => write!(f, "{error}"),
        }
    }
}

impl std::error::Error for StartupAttemptError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            StartupAttemptError::Redis(error) => Some(error),
            StartupAttemptError::Rsmq(error) => Some(error),
        }
    }
}

/// Double the current delay, capped at the maximum. A pure helper so the
/// backoff cap can be tested without sleeping.
fn next_startup_retry_delay(current: Duration) -> Duration {
    current.saturating_mul(2).min(STARTUP_RETRY_MAX_DELAY)
}

/// Apply bounded additive jitter to the current delay. `jitter` is a raw
/// sample in `[0, 1]`; only `STARTUP_RETRY_JITTER_RATIO` of it is used so the
/// delay never exceeds `current * (1 + ratio)` and is always capped.
fn startup_retry_delay(current: Duration, jitter: f64) -> Duration {
    let ratio = jitter.clamp(0.0, 1.0) * STARTUP_RETRY_JITTER_RATIO;
    current.mul_f64(1.0 + ratio).min(STARTUP_RETRY_MAX_DELAY)
}

/// Bounded exponential retry for transient startup unavailability only.
///
/// The attempt, predicate, sleep, jitter, and clock are all injected so tests
/// stay fast and deterministic. Permanent errors are returned immediately.
async fn retry_startup_attempt<T, E, AFut, SFut>(
    mut attempt: impl FnMut() -> AFut,
    is_transient: impl Fn(&E) -> bool,
    mut sleep: impl FnMut(Duration) -> SFut,
    mut jitter: impl FnMut() -> f64,
    mut now: impl FnMut() -> Instant,
) -> std::result::Result<T, E>
where
    E: std::fmt::Debug,
    AFut: Future<Output = std::result::Result<T, E>>,
    SFut: Future<Output = ()>,
{
    let started = now();
    let mut delay = STARTUP_RETRY_INITIAL_DELAY;
    loop {
        match attempt().await {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !is_transient(&error) {
                    return Err(error);
                }
                let elapsed = now().saturating_duration_since(started);
                if elapsed >= STARTUP_RETRY_DEADLINE {
                    return Err(error);
                }
                let wait = startup_retry_delay(delay, jitter())
                    .min(STARTUP_RETRY_DEADLINE - elapsed);
                warn!(
                    "Redis startup not ready; retrying in {}ms ({error:?})",
                    wait.as_millis(),
                );
                sleep(wait).await;
                delay = next_startup_retry_delay(delay);
            }
        }
    }
}

/// Establish the multiplexed connection, load RSMQ scripts, and probe queue
/// state. No durable queue mutation happens here, so a bounded retry cannot
/// duplicate or drop seed jobs.
async fn establish_startup_connection(
    client: &redis::Client,
    namespace: &str,
) -> std::result::Result<(MultiplexedConnection, Rsmq, bool), StartupAttemptError> {
    retry_startup_attempt(
        || async {
            let connection = client.get_multiplexed_async_connection().await?;
            let mut rsmq = Rsmq::new_with_connection(
                MultiplexedConnection::clone(&connection),
                RSMQ_REALTIME,
                Some(namespace),
            )
            .await?;
            let queue_exists = probe_job_queue_exists(&mut rsmq).await?;
            Ok((connection, rsmq, queue_exists))
        },
        StartupAttemptError::is_transient,
        |delay| tokio::time::sleep(delay),
        rand::random::<f64>,
        Instant::now,
    )
    .await
}

async fn probe_job_queue_exists(
    rsmq: &mut Rsmq,
) -> std::result::Result<bool, StartupAttemptError> {
    let queues = rsmq.list_queues().await?;
    Ok(queues.iter().any(|name| JOB_QUEUE_NAME == name))
}

pub async fn connect(redis_uri: &str) -> Result<(MultiplexedConnection, Rsmq)> {
    connect_with_namespace(redis_uri, RSMQ_NAMESPACE).await
}

#[doc(hidden)]
pub async fn connect_with_namespace(
    redis_uri: &str,
    namespace: &str,
) -> Result<(MultiplexedConnection, Rsmq)> {
    let make_error = || Error::new("failed to connect to redis", ErrorType::RedisSetup);

    let client = redis::Client::open(redis_uri).or_raise(make_error)?;
    let (mut connection, mut rsmq, queue_exists) =
        establish_startup_connection(&client, namespace)
            .await
            .or_raise(make_error)?;

    if !queue_exists {
        info!("Creating Redis job queue '{JOB_QUEUE_NAME}'");
        info!("* Process time: {JOB_QUEUE_PROCESS_TIME:?}");
        info!("* Delay time:   {JOB_QUEUE_DELAY:?}");
        info!("* Maximum body: {JOB_QUEUE_MAXIMUM_SIZE:?} bytes");

        rsmq.create_queue(
            JOB_QUEUE_NAME,
            JOB_QUEUE_PROCESS_TIME,
            JOB_QUEUE_DELAY,
            JOB_QUEUE_MAXIMUM_SIZE,
        )
        .await
        .or_raise(make_error)?;

        // Then add initial repeating jobs
        macro_rules! queue_job {
            ($job_case:ident) => {
                JobService::queue_job_inner(&mut rsmq, &Job::$job_case, None)
                    .await
                    .or_raise(make_error)?
            };
        }

        queue_job!(PruneSessions);
        queue_job!(PrunePendingUploads);
        queue_job!(PruneText);

        redis::cmd("DEL")
            .arg(recurring_job_seed_key(namespace))
            .query_async::<usize>(&mut connection)
            .await
            .or_raise(make_error)?;
    }

    ensure_lift_expired_punishments_job(&mut connection, &mut rsmq, namespace)
        .await
        .or_raise(make_error)?;

    Ok((connection, rsmq))
}

fn recurring_job_seed_key(namespace: &str) -> String {
    format!(
        "{namespace}:bootstrap:{JOB_QUEUE_NAME}:lift_expired_punishments:{LIFT_EXPIRED_PUNISHMENTS_SEED_VERSION}"
    )
}

async fn queue_contains_lift_expired_punishments(
    connection: &mut MultiplexedConnection,
    namespace: &str,
) -> Result<bool> {
    let make_error = || {
        Error::new(
            "failed to inspect existing recurring jobs",
            ErrorType::RedisSetup,
        )
    };
    let queue_body_key = format!("{namespace}:{JOB_QUEUE_NAME}:Q");
    let values: Vec<Vec<u8>> = redis::cmd("HVALS")
        .arg(queue_body_key)
        .query_async(connection)
        .await
        .or_raise(make_error)?;

    Ok(values.iter().any(|value| {
        matches!(
            serde_json::from_slice::<Job>(value),
            Ok(Job::LiftExpiredPunishments)
        )
    }))
}

async fn ensure_lift_expired_punishments_job(
    connection: &mut MultiplexedConnection,
    rsmq: &mut Rsmq,
    namespace: &str,
) -> Result<()> {
    let make_error = || {
        Error::new(
            "failed to seed the expired-punishment cleanup job",
            ErrorType::RedisSetup,
        )
    };
    let marker_key = recurring_job_seed_key(namespace);

    let existing_marker: Option<String> = redis::cmd("GET")
        .arg(&marker_key)
        .query_async(connection)
        .await
        .or_raise(make_error)?;
    if existing_marker.is_some() {
        return Ok(());
    }

    if queue_contains_lift_expired_punishments(connection, namespace)
        .await
        .or_raise(make_error)?
    {
        redis::cmd("SET")
            .arg(&marker_key)
            .arg("ready")
            .query_async::<()>(connection)
            .await
            .or_raise(make_error)?;
        return Ok(());
    }

    let seed_token = Uuid::new_v4().to_string();
    let acquired: Option<String> = redis::cmd("SET")
        .arg(&marker_key)
        .arg(&seed_token)
        .arg("NX")
        .arg("EX")
        .arg(RECURRING_JOB_SEED_LOCK_SECONDS)
        .query_async(connection)
        .await
        .or_raise(make_error)?;
    if acquired.is_none() {
        return Ok(());
    }

    let seed_result: Result<()> = async {
        if !queue_contains_lift_expired_punishments(connection, namespace).await? {
            JobService::queue_job_inner(rsmq, &Job::LiftExpiredPunishments, None).await?;
        }
        redis::cmd("SET")
            .arg(&marker_key)
            .arg("ready")
            .query_async::<()>(connection)
            .await
            .or_raise(make_error)?;
        Ok(())
    }
    .await;

    if seed_result.is_err() {
        let marker_value: Option<String> = redis::cmd("GET")
            .arg(&marker_key)
            .query_async(connection)
            .await
            .unwrap_or(None);
        if marker_value.as_deref() == Some(seed_token.as_str()) {
            let _: redis::RedisResult<usize> = redis::cmd("DEL")
                .arg(&marker_key)
                .query_async(connection)
                .await;
        }
    }

    seed_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::io;
    use std::rc::Rc;

    fn busy_loading() -> RedisError {
        RedisError::from((
            ErrorKind::Server(ServerErrorKind::BusyLoading),
            "LOADING Valkey is loading the dataset in memory",
        ))
    }

    fn connection_refused() -> RedisError {
        RedisError::from(io::Error::from(io::ErrorKind::ConnectionRefused))
    }

    fn authentication_failed() -> RedisError {
        RedisError::from((
            ErrorKind::AuthenticationFailed,
            "WRONGPASS invalid username-password pair",
        ))
    }

    #[derive(Clone)]
    struct FakeClock {
        base: Instant,
        elapsed: Rc<Cell<Duration>>,
    }

    impl FakeClock {
        fn new() -> Self {
            FakeClock {
                base: Instant::now(),
                elapsed: Rc::new(Cell::new(Duration::ZERO)),
            }
        }

        fn now(&self) -> Instant {
            self.base + self.elapsed.get()
        }

        fn advance(&self, duration: Duration) {
            self.elapsed.set(self.elapsed.get() + duration);
        }
    }

    #[test]
    fn classifies_transient_errors() {
        assert!(is_startup_transient_redis_error(&busy_loading()));
        assert!(is_startup_transient_redis_error(&connection_refused()));
        assert!(is_startup_transient_rsmq_error(&RsmqError::RedisError(
            busy_loading()
        )));
    }

    #[test]
    fn rejects_permanent_errors() {
        assert!(!is_startup_transient_redis_error(&authentication_failed()));
        assert!(!is_startup_transient_rsmq_error(
            &RsmqError::MessageNotString
        ));
    }

    #[test]
    fn backoff_doubles_and_caps() {
        assert_eq!(
            next_startup_retry_delay(STARTUP_RETRY_INITIAL_DELAY),
            Duration::from_millis(50)
        );
        assert_eq!(
            next_startup_retry_delay(Duration::from_millis(400)),
            STARTUP_RETRY_MAX_DELAY
        );
        assert_eq!(
            next_startup_retry_delay(STARTUP_RETRY_MAX_DELAY),
            STARTUP_RETRY_MAX_DELAY
        );
    }

    #[test]
    fn jitter_is_bounded_and_capped() {
        assert_eq!(
            startup_retry_delay(STARTUP_RETRY_MAX_DELAY, 1.0),
            STARTUP_RETRY_MAX_DELAY
        );

        let base = Duration::from_millis(100);
        assert_eq!(startup_retry_delay(base, 0.0), base);

        let full_jitter = startup_retry_delay(base, 1.0);
        assert!(full_jitter > base);
        assert_eq!(full_jitter, base.mul_f64(1.0 + STARTUP_RETRY_JITTER_RATIO));
    }

    #[tokio::test]
    async fn retries_busy_loading_then_succeeds() {
        let clock = FakeClock::new();
        let attempts = Cell::new(0u32);

        let result: std::result::Result<&str, StartupAttemptError> =
            retry_startup_attempt(
                || {
                    let attempt = attempts.get();
                    attempts.set(attempt + 1);
                    async move {
                        if attempt < 2 {
                            Err(StartupAttemptError::Redis(busy_loading()))
                        } else {
                            Ok("connected")
                        }
                    }
                },
                StartupAttemptError::is_transient,
                |duration| {
                    clock.advance(duration);
                    async {}
                },
                || 0.0,
                || clock.now(),
            )
            .await;

        assert!(matches!(result, Ok("connected")));
        assert_eq!(attempts.get(), 3);
    }

    #[tokio::test]
    async fn permanent_error_is_not_retried() {
        let clock = FakeClock::new();
        let attempts = Cell::new(0u32);

        let result: std::result::Result<&str, StartupAttemptError> =
            retry_startup_attempt(
                || {
                    attempts.set(attempts.get() + 1);
                    async { Err(StartupAttemptError::Redis(authentication_failed())) }
                },
                StartupAttemptError::is_transient,
                |duration| {
                    clock.advance(duration);
                    async {}
                },
                || 0.0,
                || clock.now(),
            )
            .await;

        assert!(result.is_err());
        assert_eq!(attempts.get(), 1);
    }

    #[tokio::test]
    async fn transient_error_stops_at_deadline() {
        let clock = FakeClock::new();
        let attempts = Cell::new(0u32);

        let result: std::result::Result<&str, StartupAttemptError> =
            retry_startup_attempt(
                || {
                    attempts.set(attempts.get() + 1);
                    async { Err(StartupAttemptError::Redis(busy_loading())) }
                },
                StartupAttemptError::is_transient,
                |duration| {
                    clock.advance(duration);
                    async {}
                },
                || 0.0,
                || clock.now(),
            )
            .await;

        assert!(result.is_err());
        assert!(attempts.get() > 1);
        assert!(clock.elapsed.get() >= STARTUP_RETRY_DEADLINE);
    }
}
