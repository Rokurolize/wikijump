/*
 * services/membership/structs.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MembershipJoinOutcome {
    Joined,
    AlreadyMember,
}

/// One closed browser action emitted beside a renderer-owned Join control.
///
/// It intentionally contains no site, actor, policy, token, URL, or authored
/// JavaScript. The mutation binds all of those values from server context.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case", tag = "type")]
pub enum MembershipBrowserAction {
    Join,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MembershipPolicy {
    Open,
    Closed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinActorState {
    Anonymous,
    Eligible,
    Pending,
    Invited,
    Member,
    Banned,
    Admin,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinModuleState {
    Show,
    Hidden,
}
