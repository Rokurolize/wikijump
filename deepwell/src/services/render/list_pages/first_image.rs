/*
 * services/render/list_pages/first_image.rs
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

use super::super::literal_regions::LiteralRegionIndex;
use super::super::percent_encoding::percent_encode_path_segment;
use crate::error::prelude::{Error, ErrorType, Result, ResultExt};
use crate::services::ServiceContext;
use crate::services::page_query::FoundPageRow;
use regex::Regex;
use sea_orm::{ConnectionTrait, FromQueryResult, Statement, Value};
use std::borrow::Cow;
use std::collections::BTreeMap;
use std::ops::Range;
use std::sync::LazyLock;

static LISTPAGES_FIRST_IMAGE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?im)\[\[(?:image|[<=>]image|f[<=>]image)[ \t]+(?P<target>:first)(?:[ \t]+[^\r\n\]]*)?\]\]",
    )
    .expect("valid ListPages :first image regex")
});

#[derive(Debug)]
struct FirstImageOccurrence {
    block: Range<usize>,
    target: Range<usize>,
}

#[derive(Debug, FromQueryResult)]
struct ListPagesFirstImageRow {
    page_id: i64,
    name: String,
}

pub(in crate::services::render) fn list_pages_body_uses_first_image(
    source: &str,
) -> bool {
    !first_image_occurrences(source).is_empty()
}

pub(in crate::services::render) fn resolve_list_pages_first_image<'a>(
    source: &'a str,
    selected_page_slug: Option<&str>,
    first_image_name: Option<&str>,
) -> Cow<'a, str> {
    let occurrences = first_image_occurrences(source);
    if occurrences.is_empty() {
        return Cow::Borrowed(source);
    }

    let replacement = selected_page_slug
        .zip(first_image_name)
        .map(|(page, name)| {
            format!(
                "/local--files/{page}/{}",
                percent_encode_path_segment(name),
            )
        });
    let mut resolved = source.to_owned();
    for occurrence in occurrences.into_iter().rev() {
        match replacement.as_deref() {
            Some(replacement) => {
                resolved.replace_range(occurrence.target, replacement);
            }
            None => {
                resolved.replace_range(occurrence.block, "");
            }
        }
    }
    Cow::Owned(resolved)
}

pub(in crate::services::render) async fn load_list_pages_first_images(
    ctx: &ServiceContext<'_>,
    pages: &[FoundPageRow],
) -> Result<BTreeMap<(i64, i64), String>> {
    let mut page_ids_by_site = BTreeMap::<i64, Vec<i64>>::new();
    for page in pages {
        page_ids_by_site
            .entry(page.site_id)
            .or_default()
            .push(page.page_id);
    }

    let mut first_images = BTreeMap::new();
    for (site_id, page_ids) in page_ids_by_site {
        let txn = ctx.transaction();
        let statement = Statement::from_sql_and_values(
            txn.get_database_backend(),
            "SELECT requested.page_id, selected_file.name
               FROM UNNEST($1::bigint[]) AS requested(page_id)
               JOIN LATERAL (
                   SELECT file.name
                     FROM file
                     JOIN LATERAL (
                         SELECT revision.mime
                           FROM file_revision revision
                          WHERE revision.file_id = file.file_id
                          ORDER BY revision.revision_number DESC
                          LIMIT 1
                     ) latest_revision ON TRUE
                    WHERE file.site_id = $2
                      AND file.page_id = requested.page_id
                      AND file.deleted_at IS NULL
                      AND latest_revision.mime LIKE 'image/%'
                    ORDER BY file.file_id
                    LIMIT 1
               ) selected_file ON TRUE",
            [Value::from(page_ids), Value::from(site_id)],
        );
        let rows = ListPagesFirstImageRow::find_by_statement(statement)
            .all(txn)
            .await
            .or_raise(|| {
                Error::new(
                    "failed to load first image attachments for ListPages rows",
                    ErrorType::Render,
                )
            })?;
        first_images.extend(
            rows.into_iter()
                .map(|row| ((site_id, row.page_id), row.name)),
        );
    }

    Ok(first_images)
}

fn first_image_occurrences(source: &str) -> Vec<FirstImageOccurrence> {
    let literal_regions = LiteralRegionIndex::new(source);
    LISTPAGES_FIRST_IMAGE_REGEX
        .captures_iter(source)
        .filter_map(|captures| {
            let block = captures.get(0)?;
            if literal_regions.contains(block.start()) {
                return None;
            }
            let target = captures.name("target")?;
            Some(FirstImageOccurrence {
                block: block.range(),
                target: target.range(),
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{list_pages_body_uses_first_image, resolve_list_pages_first_image};

    #[test]
    fn drops_missing_first_images_without_touching_literal_examples() {
        let source = concat!(
            "[[image :first]]\n",
            "[[code]]\n[[image :first]]\n[[/code]]\n",
            "[[image picture.png]]",
        );

        assert!(list_pages_body_uses_first_image(source));
        assert_eq!(
            resolve_list_pages_first_image(source, Some("selected"), None),
            "\n[[code]]\n[[image :first]]\n[[/code]]\n[[image picture.png]]",
        );
    }

    #[test]
    fn resolves_first_images_against_the_selected_page() {
        assert_eq!(
            resolve_list_pages_first_image(
                "[[f<image :first alt=\"Preview\"]]",
                Some("article:one"),
                Some("first image.png"),
            ),
            "[[f<image /local--files/article:one/first%20image.png alt=\"Preview\"]]",
        );
    }
}
