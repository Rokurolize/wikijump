/*
 * endpoints/text.rs
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

use super::prelude::*;
use crate::services::text_block::TextBlockIndex;
use crate::types::TextBlockType;

#[derive(Deserialize, Debug, Clone)]
struct GetIndexInput {
    page_id: i64,
    block_type: TextBlockType,
    name: Option<String>,
    index: Option<i16>,
}

pub async fn text_block_get_index(
    ctx: &ServiceContext<'_>,
    params: Params<'static>,
) -> Result<Option<TextBlockIndex>> {
    let GetIndexInput {
        page_id,
        block_type,
        name,
        index,
    } = parse!(params);

    match (name, index) {
        (Some(name), None) => {
            TextBlockService::get_block_index(ctx, page_id, block_type, &name)
                .await
                .or_raise(|| {
                    Error::new(
                        format!(
                            "failed to get text block {:?} '{}' for page ID {}",
                            block_type, name, page_id,
                        ),
                        ErrorType::Request,
                    )
                })
        }
        (None, Some(index)) => {
            TextBlockService::get_block_at_index(ctx, page_id, block_type, index)
                .await
                .or_raise(|| {
                    Error::new(
                        format!(
                            "failed to get text block {:?} index {} for page ID {}",
                            block_type, index, page_id,
                        ),
                        ErrorType::Request,
                    )
                })
        }
        _ => Err(Error::new(
            "text block lookup requires exactly one of name or index",
            ErrorType::Request,
        )
        .into()),
    }
}
