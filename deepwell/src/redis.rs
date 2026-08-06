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
use rsmq_async::{Rsmq, RsmqConnection};
use uuid::Uuid;

const RSMQ_NAMESPACE: &str = "rsmq";
const RSMQ_REALTIME: bool = false;
const LIFT_EXPIRED_PUNISHMENTS_SEED_VERSION: &str = "v1";
const RECURRING_JOB_SEED_LOCK_SECONDS: u64 = 300;

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
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .or_raise(make_error)?;

    let mut rsmq = {
        let connection2 = MultiplexedConnection::clone(&connection);
        Rsmq::new_with_connection(connection2, RSMQ_REALTIME, Some(namespace))
            .await
            .or_raise(make_error)?
    };

    // Set up queue if it doesn't already exist
    let queue_exists = job_queue_exists(&mut rsmq).await.or_raise(make_error)?;
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

async fn job_queue_exists(rsmq: &mut Rsmq) -> Result<bool> {
    let make_error = || {
        Error::new(
            format!(
                "failed to determine if the job queue '{JOB_QUEUE_NAME}' exists in RSMQ",
            ),
            ErrorType::RedisSetup,
        )
    };

    // NOTE: Effectively the same as rsmq.list_queues().await?.contains(JOB_QUEUE_NAME),
    //       except we don't have to deal with the "&String" type issue.
    let queues = rsmq.list_queues().await.or_raise(make_error)?;
    let exists = queues.iter().any(|name| JOB_QUEUE_NAME == name);
    Ok(exists)
}
