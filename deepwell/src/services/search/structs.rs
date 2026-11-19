/*
 * services/search/structs.rs
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

use sea_orm::FromQueryResult;

const SNIPPET_START: &str = "[[WJ_SEARCH_HL]]";
const SNIPPET_END: &str = "[[/WJ_SEARCH_HL]]";

pub const SNIPPET_START_SQL: &str = "[[WJ_SEARCH_HL]]";
pub const SNIPPET_END_SQL: &str = "[[/WJ_SEARCH_HL]]";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, FromQueryResult)]
pub struct SearchResult {
    pub page_id: i64,
    pub slug: String,
    pub title: String,
    pub snippet: String,
    pub rank: f32,
}

fn escape_html(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            character => escaped.push(character),
        }
    }
    escaped
}

fn render_snippet(snippet: &str) -> String {
    let escaped = escape_html(snippet);
    escaped
        .replace(SNIPPET_START, "<mark>")
        .replace(SNIPPET_END, "</mark>")
}

pub fn render_search_results_html(query: &str, results: &[SearchResult]) -> String {
    let mut html = String::from("<div class=\"search-results\">");

    if results.is_empty() {
        html.push_str(&format!(
            "<div class=\"error-block\">No pages found matching \"{}\".</div>",
            escape_html(query),
        ));
    } else {
        for result in results {
            let title = if result.title.is_empty() {
                &result.slug
            } else {
                &result.title
            };
            html.push_str("<div class=\"search-result\">");
            html.push_str(&format!(
                "<div class=\"search-result-title\"><a href=\"/{}\">{}</a></div>",
                escape_html(&result.slug),
                escape_html(title),
            ));
            html.push_str(&format!(
                "<div class=\"search-result-snippet\">{}</div>",
                render_snippet(&result.snippet),
            ));
            html.push_str("</div>");
        }
    }

    html.push_str("</div>");
    html
}

#[cfg(test)]
mod tests {
    use super::{SearchResult, render_search_results_html};

    fn result(title: &str, slug: &str) -> SearchResult {
        SearchResult {
            page_id: 1,
            slug: slug.to_owned(),
            title: title.to_owned(),
            snippet: format!("about [[WJ_SEARCH_HL]]{title}[[/WJ_SEARCH_HL]] here"),
            rank: 1.0,
        }
    }

    #[test]
    fn renders_found_pages_with_escaped_titles_and_highlight_markers() {
        let html = render_search_results_html(
            "elephant",
            &[result("Grey Elephants & Co", "grey-elephants")],
        );
        assert!(
            html.contains(r#"<a href="/grey-elephants">Grey Elephants &amp; Co</a>"#),
            "{html}",
        );
        assert!(
            html.contains("<mark>Grey Elephants &amp; Co</mark>"),
            "{html}"
        );
        assert!(html.contains(r#"class="search-result""#), "{html}");
    }

    #[test]
    fn renders_empty_state_with_escaped_query() {
        let html = render_search_results_html("<script>", &[]);
        assert!(
            html.contains(r#"No pages found matching "&lt;script&gt;"."#),
            "{html}",
        );
        assert!(!html.contains("<script>"), "{html}");
    }
}
