/*
 * services/render/footnote_dom.rs
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

const FOOTNOTE_LIST_OPEN: &str = r#"<div class="wj-footnote-list">"#;
const ITEM_OPEN: &str = r#"<li class="wj-footnote-list-item""#;

pub(in crate::services::render) fn restore_wikidot_footnote_list_dom(
    html: &str,
) -> String {
    let mut restored = String::with_capacity(html.len());
    let mut cursor = 0usize;

    while let Some(offset) = html[cursor..].find(FOOTNOTE_LIST_OPEN) {
        let start = cursor + offset;
        restored.push_str(&html[cursor..start]);
        let Some(end) = balanced_element_end(html, start, "<div", "</div>") else {
            restored.push_str(&html[start..]);
            return restored;
        };
        restored.push_str(&restore_list(&html[start..end]));
        cursor = end;
    }

    restored.push_str(&html[cursor..]);
    restored
}

pub(in crate::services::render) fn enclose_list_pages_footnote_footer(
    html: &str,
) -> String {
    const WRAPPER_OPENS: [&str; 2] = [
        r#"<div class="list-pages-box">"#,
        r#"<div class="list-pages-item">"#,
    ];
    const FOOTNOTES_OPEN: &str = r#"<div class="footnotes-footer">"#;
    const DIV_CLOSE: &str = "</div>";

    let mut enclosed = html.to_owned();
    let mut search_start = 0usize;
    while let Some(relative_start) = enclosed[search_start..].find(FOOTNOTES_OPEN) {
        let mut footnotes_start = search_start + relative_start;
        loop {
            let close_end = enclosed[..footnotes_start]
                .trim_end_matches([' ', '\t', '\r', '\n'])
                .len();
            let Some(before_close) = enclosed[..close_end].strip_suffix(DIV_CLOSE) else {
                break;
            };
            let close_start = before_close.len();
            let wrapper_start = WRAPPER_OPENS
                .iter()
                .filter_map(|wrapper| enclosed[..close_start].rfind(wrapper))
                .filter(|start| {
                    balanced_element_end(&enclosed, *start, "<div", DIV_CLOSE)
                        == Some(close_end)
                })
                .max();
            let Some(_wrapper_start) = wrapper_start else {
                break;
            };
            let Some(footnotes_end) =
                balanced_element_end(&enclosed, footnotes_start, "<div", DIV_CLOSE)
            else {
                break;
            };

            let move_start = enclosed[..close_start]
                .trim_end_matches([' ', '\t', '\r', '\n'])
                .len();
            let moved_close = enclosed[move_start..close_end].to_owned();
            enclosed.replace_range(move_start..close_end, "");
            footnotes_start -= moved_close.len();
            let insertion = footnotes_end - moved_close.len();
            enclosed.insert_str(insertion, &moved_close);
        }
        search_start = footnotes_start + FOOTNOTES_OPEN.len();
    }
    enclosed
}

fn restore_list(list: &str) -> String {
    const TITLE_OPEN: &str = r#"<div class="wj-title">"#;
    let Some(body) = list
        .strip_prefix(FOOTNOTE_LIST_OPEN)
        .and_then(|list| list.strip_suffix("</div>"))
    else {
        return list.to_owned();
    };
    let (Some(ordered_list_start), Some(ordered_list_end)) =
        (body.find("<ol>"), body.rfind("</ol>"))
    else {
        return list.to_owned();
    };
    if ordered_list_end < ordered_list_start {
        return list.to_owned();
    }

    let title = body[..ordered_list_start].replace(TITLE_OPEN, r#"<div class="title">"#);
    let items = &body[ordered_list_start + "<ol>".len()..ordered_list_end];
    let suffix = &body[ordered_list_end + "</ol>".len()..];
    format!(
        r#"<div class="footnotes-footer">{title}{}{suffix}</div>"#,
        restore_items(items),
    )
}

fn restore_items(items: &str) -> String {
    let mut restored = String::with_capacity(items.len());
    let mut cursor = 0usize;

    while let Some(offset) = items[cursor..].find(ITEM_OPEN) {
        let start = cursor + offset;
        restored.push_str(&items[cursor..start]);
        let Some(end) = balanced_element_end(items, start, "<li", "</li>") else {
            restored.push_str(&items[start..]);
            return restored;
        };
        restored.push_str(&restore_item(&items[start..end]));
        cursor = end;
    }

    restored.push_str(&items[cursor..]);
    restored
}

fn restore_item(item: &str) -> String {
    const CONTENTS_OPEN: &str = r#"<div class="wj-footnote-list-item-contents">"#;
    let Some(open_end) = item.find('>') else {
        return item.to_owned();
    };
    let open = &item[..=open_end];
    let Some(id_start) = open.find(r#" data-id=""#).map(|start| start + 10) else {
        return item.to_owned();
    };
    let Some(id_end) = open[id_start..].find('"').map(|end| id_start + end) else {
        return item.to_owned();
    };
    let id = &open[id_start..id_end];
    if id.is_empty() || !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return item.to_owned();
    }
    let marker = format!(
        r#"<wj-footnote-list-item-marker class="wj-footnote-list-item-marker" type="button" role="link">{id}<span class="wj-footnote-sep">.</span></wj-footnote-list-item-marker>"#
    );
    let Some(contents) = item[open_end + 1..]
        .strip_prefix(&marker)
        .and_then(|item| item.strip_prefix(CONTENTS_OPEN))
        .and_then(|item| item.strip_suffix("</div></li>"))
    else {
        return item.to_owned();
    };

    format!(
        r#"<div class="footnote-footer" id="footnote-{id}"><a href="javascript:;" onclick="WIKIDOT.page.utils.scrollToReference('footnoteref-{id}')">{id}</a>. {contents}</div>"#
    )
}

fn balanced_element_end(
    html: &str,
    start: usize,
    open_tag: &str,
    close_tag: &str,
) -> Option<usize> {
    if open_tag.is_empty() || close_tag.is_empty() {
        return None;
    }

    let html = html.as_bytes();
    let open_tag = open_tag.as_bytes();
    let close_tag = close_tag.as_bytes();
    let mut cursor = start;
    let mut depth = 0usize;

    while cursor < html.len() {
        if html[cursor..].starts_with(open_tag) {
            depth += 1;
            cursor += open_tag.len();
        } else if html[cursor..].starts_with(close_tag) {
            if depth == 0 {
                return None;
            }
            depth -= 1;
            cursor += close_tag.len();
            if depth == 0 {
                return Some(cursor);
            }
        } else {
            cursor += 1;
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn restores_wikidot_footer_structure_and_backlinks() {
        let html = concat!(
            r#"<div class="wj-footnote-list"><div class="wj-title">Footnotes</div><ol>"#,
            r#"<li class="wj-footnote-list-item" data-id="1">"#,
            r#"<wj-footnote-list-item-marker class="wj-footnote-list-item-marker" type="button" role="link">1<span class="wj-footnote-sep">.</span></wj-footnote-list-item-marker>"#,
            r#"<div class="wj-footnote-list-item-contents"><p>Alpha</p><p>Beta <em>detail</em>.</p></div>"#,
            r#"</li></ol></div>"#,
        );

        let restored = restore_wikidot_footnote_list_dom(html);

        assert_eq!(
            restored,
            concat!(
                r#"<div class="footnotes-footer"><div class="title">Footnotes</div>"#,
                r#"<div class="footnote-footer" id="footnote-1">"#,
                r#"<a href="javascript:;" onclick="WIKIDOT.page.utils.scrollToReference('footnoteref-1')">1</a>. "#,
                r#"<p>Alpha</p><p>Beta <em>detail</em>.</p></div></div>"#,
            )
        );
        assert!(!restored.contains("wj-footnote"));
        assert!(!restored.contains("<ol>"));
        assert!(!restored.contains("<li"));
    }

    #[test]
    fn keeps_an_adjacent_generated_footer_inside_a_list_pages_wrapper() {
        let html = concat!(
            r#"<div class="list-pages-box"><p>HEAD</p>"#,
            "\n    </div>",
            r#"<div class="footnotes-footer"><div class="title">Footnotes</div>"#,
            r#"<div class="footnote-footer" id="footnote-1">NOTE</div></div>"#,
        );

        let enclosed = enclose_list_pages_footnote_footer(html);

        assert_eq!(
            enclosed,
            concat!(
                r#"<div class="list-pages-box"><p>HEAD</p>"#,
                r#"<div class="footnotes-footer"><div class="title">Footnotes</div>"#,
                r#"<div class="footnote-footer" id="footnote-1">NOTE</div></div>"#,
                "\n    </div>",
            ),
        );
    }

    #[test]
    fn keeps_an_adjacent_generated_footer_inside_the_list_pages_item() {
        let html = concat!(
            r#"<div class="list-pages-box"><div class="list-pages-item"><p>ROW</p>"#,
            "</div></div>",
            r#"<div class="footnotes-footer"><div class="title">Footnotes</div>"#,
            r#"<div class="footnote-footer" id="footnote-1">NOTE</div></div>"#,
        );

        let enclosed = enclose_list_pages_footnote_footer(html);

        assert_eq!(
            enclosed,
            concat!(
                r#"<div class="list-pages-box"><div class="list-pages-item"><p>ROW</p>"#,
                r#"<div class="footnotes-footer"><div class="title">Footnotes</div>"#,
                r#"<div class="footnote-footer" id="footnote-1">NOTE</div></div>"#,
                "</div></div>",
            ),
        );
    }

    #[test]
    fn ignores_a_nonclosing_utf8_prefix_before_a_footnote_footer() {
        let html = concat!(
            r#"<div class="list-pages-box">a。abcd"#,
            r#"<div class="footnotes-footer"><div class="title">Footnotes</div></div>"#,
        );

        assert_eq!(enclose_list_pages_footnote_footer(html), html);
    }

    #[test]
    fn handles_a_large_unrecognized_footnote_candidate_within_a_bounded_scan() {
        use std::time::{Duration, Instant};

        const NESTED_DIVS: usize = 64_000;
        let mut html = String::with_capacity(NESTED_DIVS * 11 + 64);
        html.push_str(FOOTNOTE_LIST_OPEN);
        for _ in 0..NESTED_DIVS {
            html.push_str("<div>");
        }
        for _ in 0..NESTED_DIVS {
            html.push_str("</div>");
        }
        html.push_str("</div>");

        let started = Instant::now();
        assert_eq!(restore_wikidot_footnote_list_dom(&html), html);
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "large unrecognized footnote candidate took {:?}",
            started.elapsed()
        );
    }
}
