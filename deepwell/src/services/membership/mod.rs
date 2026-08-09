/*
 * services/membership/mod.rs
 *
 * DEEPWELL - Wikijump API provider and database manager
 * Copyright (C) 2019-2026 Wikijump Team
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

mod service;
mod structs;

pub use self::service::MembershipService;
pub use self::structs::{
    JoinActorState, JoinMembership, JoinModuleState, MembershipBrowserAction,
    MembershipJoinOutcome, MembershipPolicy,
};
