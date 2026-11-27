use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "wikidot_claim_token")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub wikidot_claim_token_id: i64,
    pub wikidot_user_id: i32,
    #[sea_orm(column_type = "Text")]
    pub proof_kind: String,
    #[sea_orm(column_type = "Text")]
    pub token_hash: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub challenge_nonce: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: TimeDateTimeWithTimeZone,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: TimeDateTimeWithTimeZone,
    #[serde(with = "time::serde::rfc3339::option")]
    pub verified_at: Option<TimeDateTimeWithTimeZone>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub consumed_at: Option<TimeDateTimeWithTimeZone>,
    #[sea_orm(column_type = "Inet")]
    #[serde(with = "ip_network_serde")]
    pub created_ip: IpNetwork,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::wikidot_user::Entity",
        from = "Column::WikidotUserId",
        to = "super::wikidot_user::Column::UserId",
        on_update = "NoAction",
        on_delete = "NoAction"
    )]
    WikidotUser,
}

impl Related<super::wikidot_user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::WikidotUser.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}

mod ip_network_serde {
    use sea_orm::prelude::IpNetwork;
    use serde::{Deserialize, Deserializer, Serializer};
    use std::net::IpAddr;
    use std::str::FromStr;

    pub fn serialize<S>(value: &IpNetwork, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        serializer.serialize_str(&value.ip().to_string())
    }

    pub fn deserialize<'de, D>(deserializer: D) -> Result<IpNetwork, D::Error>
    where
        D: Deserializer<'de>,
    {
        let text = String::deserialize(deserializer)?;
        if let Ok(ip) = IpAddr::from_str(&text) {
            return Ok(IpNetwork::from(ip));
        }
        IpNetwork::from_str(&text).map_err(serde::de::Error::custom)
    }
}
