//! Wikidot `NewPage` module parsing and DOM rendering.

use std::sync::LazyLock;

use regex::Regex;

use super::service::{escape_list_pages_html_attr, escape_list_pages_html_text};

pub(super) static NEWPAGE_MODULE_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)\[\[module\s+NewPage(?P<head>(?:[^\]"]+|"[^"]*")*)\]\]"#).unwrap()
});

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) struct NewPageTemplateOption {
    pub(super) page_id: i64,
    pub(super) title: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum NewPageTemplateRendering {
    None,
    Single(NewPageTemplateOption),
    Multiple(Vec<NewPageTemplateOption>),
    Error(String),
}

#[derive(Default)]
struct NewPageArguments<'a> {
    size: Option<&'a str>,
    button: Option<&'a str>,
    category: Option<&'a str>,
    template: Option<&'a str>,
    format: Option<&'a str>,
    tags: Option<&'a str>,
    parent: Option<&'a str>,
    mode: Option<&'a str>,
    go_to: Option<&'a str>,
}

pub(super) fn new_page_template_names(head: &str) -> Vec<&str> {
    let arguments = parse_new_page_arguments(head);
    arguments
        .template
        .filter(|value| !value.is_empty())
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

pub(super) fn render_new_page_module(
    head: &str,
    templates: NewPageTemplateRendering,
) -> String {
    if let NewPageTemplateRendering::Error(message) = templates {
        return format!(
            r#"<div class="error-block">{}</div>"#,
            escape_list_pages_html_text(&message),
        );
    }

    let arguments = parse_new_page_arguments(head);
    let size = arguments
        .size
        .filter(|value| !value.is_empty() && *value != "0")
        .unwrap_or("30");
    let button = arguments
        .button
        .filter(|value| !value.is_empty())
        .unwrap_or("Create page");

    let mut output = String::new();
    output.push_str(
        r#"<div class="new-page-box" style="text-align: center; margin: 1em 0;">"#,
    );
    output.push_str(
        r#"<form action="dummy.html" method="get" onsubmit="WIKIDOT.modules.NewPageHelperModule.listeners.create(event);">"#,
    );
    output.push_str(&format!(
        r#"<input class="text" name="pageName" type="text" size="{}" maxlength="128" style="margin: 1px"/>"#,
        escape_list_pages_html_attr(size),
    ));
    if let NewPageTemplateRendering::Multiple(options) = &templates {
        output.push_str(r#"<select name="template" style="margin: 1px">"#);
        output.push_str(
            r#"<option value="" selected="selected">-- Select a template --</option>"#,
        );
        for option in options {
            output.push_str(&format!(
                r#"<option value="{}">{}</option>"#,
                option.page_id,
                escape_list_pages_html_text(&option.title),
            ));
        }
        output.push_str("</select>");
    }
    output.push_str(&format!(
        r#"<input type="submit" class="button" value="{}" style="margin: 1px;"/>"#,
        escape_list_pages_html_attr(button),
    ));

    if let Some(mode) = non_empty(arguments.mode) {
        push_hidden(&mut output, "mode", mode);
        if let Some(go_to) = non_empty(arguments.go_to) {
            push_hidden(&mut output, "goTo", go_to);
        }
    }
    if let Some(category) = non_empty(arguments.category) {
        push_hidden(&mut output, "categoryName", category);
    }
    if let NewPageTemplateRendering::Single(option) = &templates {
        output.push_str(&format!(
            r#"<input type="hidden" name="template" value="{}"/>"#,
            option.page_id,
        ));
    }
    if let Some(format) = non_empty(arguments.format) {
        push_hidden(&mut output, "format", format);
    }
    if let Some(tags) = non_empty(arguments.tags) {
        push_hidden(&mut output, "tags", tags);
    }
    if let Some(parent) = non_empty(arguments.parent) {
        push_hidden(&mut output, "parent", parent);
    }
    output.push_str("</form></div>");
    output
}

fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.is_empty())
}

fn push_hidden(output: &mut String, name: &str, value: &str) {
    output.push_str(&format!(
        r#"<input type="hidden" name="{name}" value="{}"/>"#,
        escape_list_pages_html_attr(value),
    ));
}

fn parse_new_page_arguments(head: &str) -> NewPageArguments<'_> {
    let mut parsed = NewPageArguments::default();
    for (key, value) in new_page_double_quoted_arguments(head) {
        match key {
            "size" => parsed.size = Some(value),
            "button" => parsed.button = Some(value),
            "category" => parsed.category = Some(value),
            "template" => parsed.template = Some(value),
            "format" => parsed.format = Some(value),
            "tags" => parsed.tags = Some(value),
            "parent" => parsed.parent = Some(value),
            "mode" => parsed.mode = Some(value),
            "goTo" => parsed.go_to = Some(value),
            _ => {}
        }
    }
    parsed
}

fn new_page_double_quoted_arguments(head: &str) -> Vec<(&str, &str)> {
    let mut arguments = Vec::new();
    let mut cursor = 0usize;
    while cursor < head.len() {
        skip_whitespace(head, &mut cursor);
        let key_start = cursor;
        while head.as_bytes().get(cursor).is_some_and(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-')
        }) {
            cursor += 1;
        }
        if cursor == key_start {
            advance_char(head, &mut cursor);
            continue;
        }
        let key = &head[key_start..cursor];
        skip_whitespace(head, &mut cursor);
        if head.as_bytes().get(cursor) != Some(&b'=') {
            skip_until_whitespace(head, &mut cursor);
            continue;
        }
        cursor += 1;
        skip_whitespace(head, &mut cursor);
        if head.as_bytes().get(cursor) != Some(&b'"') {
            skip_until_whitespace(head, &mut cursor);
            continue;
        }
        cursor += 1;
        let value_start = cursor;
        while cursor < head.len() && head.as_bytes()[cursor] != b'"' {
            cursor += 1;
        }
        if cursor >= head.len() {
            break;
        }
        let value = &head[value_start..cursor];
        cursor += 1;
        arguments.push((key, value));
    }
    arguments
}

fn skip_whitespace(value: &str, cursor: &mut usize) {
    while value
        .as_bytes()
        .get(*cursor)
        .is_some_and(u8::is_ascii_whitespace)
    {
        *cursor += 1;
    }
}

fn skip_until_whitespace(value: &str, cursor: &mut usize) {
    while *cursor < value.len() && !value.as_bytes()[*cursor].is_ascii_whitespace() {
        *cursor += 1;
    }
}

fn advance_char(value: &str, cursor: &mut usize) {
    if let Some(character) = value[*cursor..].chars().next() {
        *cursor += character.len_utf8();
    } else {
        *cursor = value.len();
    }
}

#[cfg(test)]
mod tests {
    use super::{
        NewPageTemplateOption, NewPageTemplateRendering, new_page_template_names,
        render_new_page_module,
    };

    #[test]
    fn renders_existing_template_selector_options() {
        let rendered = render_new_page_module(
            r#" template="template:a,template:b""#,
            NewPageTemplateRendering::Multiple(vec![
                NewPageTemplateOption {
                    page_id: 10,
                    title: "Template <A>".to_owned(),
                },
                NewPageTemplateOption {
                    page_id: 20,
                    title: "Template B".to_owned(),
                },
            ]),
        );

        assert!(rendered.contains(r#"<select name="template" style="margin: 1px">"#));
        assert!(rendered.contains(
            r#"<option value="" selected="selected">-- Select a template --</option>"#
        ));
        assert!(rendered.contains(r#"<option value="10">Template &lt;A&gt;</option>"#));
        assert!(rendered.contains(r#"<option value="20">Template B</option>"#));
    }

    #[test]
    fn extracts_comma_separated_template_names() {
        assert_eq!(
            new_page_template_names(
                r#" template=" template:first , template:second " template="" "#
            ),
            Vec::<&str>::new(),
        );
        assert_eq!(
            new_page_template_names(r#" template=" template:first , template:second " "#),
            vec!["template:first", "template:second"],
        );
    }
}
