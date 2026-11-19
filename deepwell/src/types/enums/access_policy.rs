/*
 * types/enums/access_policy.rs
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

use sea_orm::DeriveValueType;
use serde::{Deserialize, Serialize};
use strum_macros::{Display, EnumIter, EnumString};

#[derive(
    EnumIter,
    Serialize,
    Deserialize,
    Debug,
    Default,
    Copy,
    Clone,
    Hash,
    PartialEq,
    Eq,
    DeriveValueType,
    EnumString,
    Display,
)]
#[sea_orm(value_type = "String")]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
pub enum AccessPolicy {
    #[default]
    Open,
    Closed,
    Private,
}

impl AccessPolicy {
    pub const fn as_storage(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Closed => "closed",
            Self::Private => "private",
        }
    }

    pub fn from_storage(value: &str) -> Option<Self> {
        match value {
            "open" => Some(Self::Open),
            "closed" => Some(Self::Closed),
            "private" => Some(Self::Private),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::AccessPolicy;
    use std::str::FromStr;

    #[test]
    fn access_policy_storage_spelling_is_stable() {
        for policy in [
            AccessPolicy::Open,
            AccessPolicy::Closed,
            AccessPolicy::Private,
        ] {
            assert_eq!(policy.to_string(), policy.as_storage());
            assert_eq!(
                AccessPolicy::from_storage(policy.as_storage()),
                Some(policy)
            );
            assert_eq!(
                AccessPolicy::from_str(policy.as_storage()).ok(),
                Some(policy)
            );
        }
        assert_eq!(AccessPolicy::from_storage("public"), None);
    }

    #[test]
    fn open_is_the_default_access_policy() {
        assert_eq!(AccessPolicy::default(), AccessPolicy::Open);
    }
}
