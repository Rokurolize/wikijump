/*
 * tests/job_queue.rs
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

use deepwell::redis::connect_with_namespace;
use deepwell::services::job::{
    JOB_QUEUE_DELAY, JOB_QUEUE_MAXIMUM_SIZE, JOB_QUEUE_NAME, JOB_QUEUE_PROCESS_TIME, Job,
    JobService,
};
use redis::AsyncCommands;
use rsmq_async::{Rsmq, RsmqConnection};
use std::env;
use std::time::{SystemTime, UNIX_EPOCH};

async fn cleanup_namespace(redis_url: &str, namespace: &str) {
    let client =
        redis::Client::open(redis_url).expect("failed to construct Redis client");
    let mut connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to Redis for cleanup");
    let keys: Vec<String> = redis::cmd("KEYS")
        .arg(format!("{namespace}:*"))
        .query_async(&mut connection)
        .await
        .expect("failed to list test Redis keys");
    if !keys.is_empty() {
        let _: usize = connection
            .del(keys)
            .await
            .expect("failed to delete test Redis keys");
    }
}

#[tokio::test]
async fn existing_job_queue_receives_one_expired_punishment_seed() {
    let redis_url =
        env::var("REDIS_URL").expect("REDIS_URL must be set for integration tests");
    let run_id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock predates Unix epoch")
        .as_nanos();
    let namespace = format!("rsmq-test-{}-{run_id}", std::process::id());

    let client = redis::Client::open(redis_url.as_str())
        .expect("failed to construct test Redis client");
    let connection = client
        .get_multiplexed_async_connection()
        .await
        .expect("failed to connect to test Redis");
    let mut rsmq = Rsmq::new_with_connection(connection, false, Some(namespace.as_str()))
        .await
        .expect("failed to construct test RSMQ client");
    rsmq.create_queue(
        JOB_QUEUE_NAME,
        JOB_QUEUE_PROCESS_TIME,
        JOB_QUEUE_DELAY,
        JOB_QUEUE_MAXIMUM_SIZE,
    )
    .await
    .expect("failed to create pre-existing test queue");
    for job in [Job::PruneSessions, Job::PrunePendingUploads, Job::PruneText] {
        JobService::queue_job_inner(&mut rsmq, &job, None)
            .await
            .expect("failed to seed pre-existing recurring job");
    }

    let (_, mut first_start) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("first startup against existing queue failed");
    assert_eq!(
        first_start
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect first startup queue")
            .msgs,
        4,
    );

    let (_, mut second_start) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("second startup against existing queue failed");
    assert_eq!(
        second_start
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect second startup queue")
            .msgs,
        4,
        "restart added a duplicate recurring job",
    );

    second_start
        .delete_queue(JOB_QUEUE_NAME)
        .await
        .expect("failed to remove the queue-recreation fixture");

    let (_, mut recreated) = connect_with_namespace(&redis_url, &namespace)
        .await
        .expect("startup after queue recreation failed");
    assert_eq!(
        recreated
            .get_queue_attributes(JOB_QUEUE_NAME)
            .await
            .expect("failed to inspect recreated queue")
            .msgs,
        4,
        "a stale seed marker suppressed jobs in a recreated queue",
    );

    let mut jobs = Vec::new();
    while let Some(message) = recreated
        .receive_message::<Vec<u8>>(JOB_QUEUE_NAME, None)
        .await
        .expect("failed to receive queued job")
    {
        jobs.push(
            serde_json::from_slice::<Job>(&message.message)
                .expect("queued job payload was malformed"),
        );
        recreated
            .delete_message(JOB_QUEUE_NAME, &message.id)
            .await
            .expect("failed to delete received test job");
    }

    assert_eq!(
        jobs.iter()
            .filter(|job| matches!(job, Job::LiftExpiredPunishments))
            .count(),
        1,
    );
    assert_eq!(jobs.len(), 4);

    cleanup_namespace(&redis_url, &namespace).await;
}
