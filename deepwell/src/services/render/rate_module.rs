/*
 * services/render/rate_module.rs
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
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
 * General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <http://www.gnu.org/licenses/>.
 */

use super::LegacyActionDescriptor;
use super::service::{escape_list_pages_html_attr, escape_list_pages_html_text};
use crate::services::settings::PageRatingType;

pub(super) fn render_read_only_rate_module(
    score: ftml::data::ScoreValue,
    language: &str,
    rating_type: PageRatingType,
) -> String {
    let score = format_score_value(score);
    let labels = wikidot_rate_module_labels(language);
    let downvote = if rating_type == PageRatingType::PlusMinus {
        render_rate_control(
            "ratedown",
            LegacyActionDescriptor::rate(-1).expect("downvote is a fixed action"),
            labels.down_title,
            "–",
        )
    } else {
        String::new()
    };

    format!(
        concat!(
            "<div class=\"page-rate-widget-box\">",
            "<span class=\"rate-points\">{}",
            "<span class=\"number prw54353\">{}</span>",
            "</span>",
            "{}",
            "{}",
            "{}",
            "</div>"
        ),
        labels.rating_prefix,
        score,
        render_rate_control(
            "rateup",
            LegacyActionDescriptor::rate(1).expect("upvote is a fixed action"),
            labels.up_title,
            "+",
        ),
        downvote,
        render_rate_control(
            "cancel",
            LegacyActionDescriptor::cancel_rate(),
            labels.cancel_title,
            "x",
        ),
    )
}

fn render_rate_control(
    class: &str,
    action: LegacyActionDescriptor,
    title: &str,
    label: &str,
) -> String {
    let onclick = match action {
        LegacyActionDescriptor::Rate(value @ (-1 | 1)) => {
            format!("WIKIDOT.modules.PageRateWidgetModule.listeners.rate(event, {value})")
        }
        LegacyActionDescriptor::CancelRate => {
            "WIKIDOT.modules.PageRateWidgetModule.listeners.cancelVote(event)".to_owned()
        }
        _ => unreachable!("Rate controls use only fixed rate descriptors"),
    };
    format!(
        r#"<span class="{class} btn btn-default"><a href="javascript:;" onclick="{onclick}" title="{title}">{label}</a></span>"#,
        title = escape_list_pages_html_attr(title),
        label = escape_list_pages_html_text(label),
    )
}

pub(super) fn render_read_only_star_rate_module(
    score: ftml::data::ScoreValue,
    rating_votes: Option<i64>,
    body: &str,
) -> String {
    let rating = format_star_rate_value(score.to_f64());
    let rating_percent = format_star_rate_value(score.to_f64() * 20.0);
    let rating_votes = rating_votes.unwrap_or(0).to_string();
    let mut output = format!(
        concat!(
            r#"<div class="page-rate-widget">"#,
            r#"<div class="page-rate-widget-start" data-rating="{rating}"></div>"#,
        ),
        rating = escape_list_pages_html_attr(&rating),
    );

    let body = body.trim();
    if !body.is_empty() {
        output.push_str(r#"<div class="page-rate-widget-start-text">"#);
        push_star_rate_template_html(
            &mut output,
            body,
            &rating,
            &rating_votes,
            &rating_percent,
        );
        output.push_str("</div>");
    }

    output.push_str("</div>");
    output
}

fn format_star_rate_value(value: f64) -> String {
    let value = if value.is_finite() { value } else { 0.0 };
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn push_star_rate_template_html(
    output: &mut String,
    template: &str,
    rating: &str,
    rating_votes: &str,
    rating_percent: &str,
) {
    let mut cursor = 0;
    while let Some(relative_start) = template[cursor..].find("%%") {
        let start = cursor + relative_start;
        output.push_str(&escape_list_pages_html_text(&template[cursor..start]));
        let name_start = start + 2;
        let Some(relative_end) = template[name_start..].find("%%") else {
            output.push_str(&escape_list_pages_html_text(&template[start..]));
            return;
        };
        let end = name_start + relative_end;
        match &template[name_start..end] {
            "rating" => {
                output.push_str(r#"<span class="page-rate-widget-start-text-rating">"#);
                output.push_str(&escape_list_pages_html_text(rating));
                output.push_str("</span>");
            }
            "rating_votes" => {
                output.push_str(
                    r#"<span class="page-rate-widget-start-text-rating-votes">"#,
                );
                output.push_str(&escape_list_pages_html_text(rating_votes));
                output.push_str("</span>");
            }
            "rating_percent" => {
                output.push_str(
                    r#"<span class="page-rate-widget-start-text-rating-percent">"#,
                );
                output.push_str(&escape_list_pages_html_text(rating_percent));
                output.push_str("</span>");
            }
            _ => output.push_str(&escape_list_pages_html_text(&template[start..end + 2])),
        }
        cursor = end + 2;
    }
    output.push_str(&escape_list_pages_html_text(&template[cursor..]));
}

#[derive(Debug)]
struct WikidotRateModuleLabels {
    rating_prefix: &'static str,
    up_title: &'static str,
    down_title: &'static str,
    cancel_title: &'static str,
}

fn wikidot_rate_module_labels(language: &str) -> WikidotRateModuleLabels {
    if is_japanese_wikidot_locale(language) {
        WikidotRateModuleLabels {
            rating_prefix: "評価:\u{00a0}",
            up_title: "好き",
            down_title: "好きじゃない",
            cancel_title: "投票を取り消す",
        }
    } else {
        WikidotRateModuleLabels {
            rating_prefix: "rating:\u{00a0}",
            up_title: "I like it",
            down_title: "I don't like it",
            cancel_title: "Cancel my vote",
        }
    }
}

fn is_japanese_wikidot_locale(language: &str) -> bool {
    let language = language.replace('_', "-").to_ascii_lowercase();
    matches!(language.as_str(), "ja" | "jp") || language.starts_with("ja-")
}

fn format_score_value(score: ftml::data::ScoreValue) -> String {
    match score {
        ftml::data::ScoreValue::Integer(value) if value > 0 => format!("+{value}"),
        ftml::data::ScoreValue::Integer(value) => value.to_string(),
        ftml::data::ScoreValue::Float(value) if value > 0.0 && value.fract() == 0.0 => {
            format!("+{value:.0}")
        }
        ftml::data::ScoreValue::Float(value) if value > 0.0 => format!("+{value}"),
        ftml::data::ScoreValue::Float(value) if value.fract() == 0.0 => {
            format!("{value:.0}")
        }
        ftml::data::ScoreValue::Float(value) => value.to_string(),
    }
}
