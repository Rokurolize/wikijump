use sea_orm::entity::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, DeriveEntityModel, Eq, Serialize, Deserialize)]
#[sea_orm(table_name = "registration_passcode")]
pub struct Model {
    #[sea_orm(primary_key)]
    pub passcode_id: i64,
    #[sea_orm(column_type = "Text", unique)]
    pub passcode_hash: String,
    #[sea_orm(column_type = "Text", nullable)]
    pub label: Option<String>,
    pub issuer_user_id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: TimeDateTimeWithTimeZone,
    #[serde(with = "time::serde::rfc3339")]
    pub expires_at: TimeDateTimeWithTimeZone,
    pub max_uses: Option<i32>,
    pub use_count: i32,
    #[serde(with = "time::serde::rfc3339::option")]
    pub revoked_at: Option<TimeDateTimeWithTimeZone>,
    pub revoked_by: Option<i64>,
}

#[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
pub enum Relation {
    #[sea_orm(
        belongs_to = "super::user::Entity",
        from = "Column::IssuerUserId",
        to = "super::user::Column::UserId",
        on_update = "NoAction",
        on_delete = "NoAction"
    )]
    Issuer,
}

impl Related<super::user::Entity> for Entity {
    fn to() -> RelationDef {
        Relation::Issuer.def()
    }
}

impl ActiveModelBehavior for ActiveModel {}
