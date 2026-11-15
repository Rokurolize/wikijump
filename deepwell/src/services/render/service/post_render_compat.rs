use super::{
    RenderProtectionBundle, RenderService, WIKIDOT_EMAIL_CLASS_SPAN_REGEX,
    WIKIDOT_OBFUSCATED_EMAIL_BODY_REGEX, WIKIDOT_RECOVERABLE_REVERSED_EMAIL_BODY_REGEX,
};

#[derive(Clone, Copy, PartialEq, Eq)]
enum ResidualStandaloneEvent {
    RawTextOpen(usize),
    RawTextClose(usize),
    MarkerOpen,
    MarkerClose,
}

impl RenderProtectionBundle {
    pub(in crate::services::render) fn restore_nested_compatibility_markers(
        &self,
        text: &str,
    ) -> String {
        RenderService::restore_protected_wikidot_inline_html(
            RenderService::restore_protected_wikidot_color_spans(
                self.wikidot_compat_html.restore(text),
                &self.wikidot_color_spans,
            ),
            &self.wikidot_inline_html,
        )
    }
}

impl RenderService {
    pub(in crate::services::render) fn remove_spurious_wikidot_email_classes(
        html: &str,
    ) -> String {
        WIKIDOT_EMAIL_CLASS_SPAN_REGEX
            .replace_all(html, |captures: &regex::Captures<'_>| {
                let body = captures.name("body").map_or("", |mtch| mtch.as_str());
                if WIKIDOT_OBFUSCATED_EMAIL_BODY_REGEX.is_match(body) {
                    captures[0].to_owned()
                } else if let Some(body) = Self::recover_reversed_wikidot_email_body(body)
                {
                    format!(r#"<span class="wiki-email">{body}</span>"#)
                } else {
                    format!("<span>{body}</span>")
                }
            })
            .into_owned()
    }

    fn recover_reversed_wikidot_email_body(body: &str) -> Option<String> {
        let captures = WIKIDOT_RECOVERABLE_REVERSED_EMAIL_BODY_REGEX.captures(body)?;
        let domain1 = captures.name("domain1")?.as_str();
        let user1 = captures.name("user1")?.as_str();
        let domain2 = captures.name("domain2")?.as_str();
        let user2 = captures.name("user2")?.as_str();

        if domain1 == domain2 && user1 == user2 {
            Some(format!("{domain1}|{user1}#{domain2}|{user2}"))
        } else {
            None
        }
    }

    pub(in crate::services::render) fn wikijump_tab_panel_is_hidden(
        panel_open_tag: &str,
    ) -> bool {
        panel_open_tag
            .trim_end_matches('>')
            .split_ascii_whitespace()
            .any(|attribute| attribute == "hidden" || attribute.starts_with("hidden="))
    }

    pub(in crate::services::render) fn remove_wikijump_footnote_ref_tooltips(
        html: &str,
    ) -> String {
        const DIV_TOOLTIP_OPEN: &str = r#"<div class="wj-footnote-ref-tooltip""#;
        const SPAN_TOOLTIP_OPEN: &str = r#"<span class="wj-footnote-ref-tooltip""#;
        let mut output = String::with_capacity(html.len());
        let mut cursor = 0usize;

        loop {
            let div_start = html[cursor..]
                .find(DIV_TOOLTIP_OPEN)
                .map(|offset| (cursor + offset, "<div", "</div>"));
            let span_start = html[cursor..]
                .find(SPAN_TOOLTIP_OPEN)
                .map(|offset| (cursor + offset, "<span", "</span>"));
            let Some((start, open_tag, close_tag)) = (match (div_start, span_start) {
                (Some(div), Some(span)) => Some(if div.0 < span.0 { div } else { span }),
                (Some(div), None) => Some(div),
                (None, Some(span)) => Some(span),
                (None, None) => None,
            }) else {
                break;
            };

            output.push_str(&html[cursor..start]);

            let Some(end) =
                Self::balanced_html_element_end(html, start, open_tag, close_tag)
            else {
                output.push_str(&html[start..]);
                return output;
            };
            cursor = end;
        }

        output.push_str(&html[cursor..]);
        output
    }

    fn balanced_html_element_end(
        html: &str,
        start: usize,
        open_tag: &str,
        close_tag: &str,
    ) -> Option<usize> {
        let mut cursor = start;
        let mut depth = 0usize;

        loop {
            let next_open = html[cursor..].find(open_tag).map(|offset| cursor + offset);
            let next_close = html[cursor..].find(close_tag).map(|offset| cursor + offset);

            match (next_open, next_close) {
                (Some(open), Some(close)) if open < close => {
                    depth += 1;
                    cursor = open + open_tag.len();
                }
                (Some(_), None) => return None,
                (_, Some(close)) => {
                    if depth == 0 {
                        return None;
                    }
                    depth -= 1;
                    cursor = close + close_tag.len();
                    if depth == 0 {
                        return Some(cursor);
                    }
                }
                (None, None) => return None,
            }
        }
    }

    fn residual_standalone_raw_text_tag(
        line: &str,
        start: usize,
    ) -> Option<(usize, bool)> {
        let bytes = line.as_bytes();
        if bytes.get(start) != Some(&b'<') {
            return None;
        }
        let lower = line[start..].to_ascii_lowercase();
        let lower_bytes = lower.as_bytes();
        let mut index = 1usize;
        let closing = lower_bytes.get(index) == Some(&b'/');
        if closing {
            index += 1;
        }
        let name_start = index;
        while index < lower_bytes.len()
            && (lower_bytes[index].is_ascii_alphanumeric() || lower_bytes[index] == b'-')
        {
            index += 1;
        }
        let name = &lower[name_start..index];
        const RAW_TEXT: &[&str] = &["pre", "code", "textarea", "style", "script", "tt"];
        if !RAW_TEXT.contains(&name) {
            return None;
        }
        let tag_end = line[start..].find('>').map(|offset| start + offset + 1)?;
        Some((tag_end, !closing))
    }

    fn residual_standalone_find_next_event(
        line: &str,
        start: usize,
    ) -> Option<(usize, ResidualStandaloneEvent)> {
        let bytes = line.as_bytes();
        let mut index = start;
        while index < bytes.len() {
            match bytes[index] {
                b'<' => {
                    if let Some((tag_end, is_open)) =
                        Self::residual_standalone_raw_text_tag(line, index)
                    {
                        return Some((
                            index,
                            if is_open {
                                ResidualStandaloneEvent::RawTextOpen(tag_end)
                            } else {
                                ResidualStandaloneEvent::RawTextClose(tag_end)
                            },
                        ));
                    }
                    if let Some(tag_end) =
                        line[index..].find('>').map(|offset| index + offset + 1)
                    {
                        index = tag_end;
                        continue;
                    }
                    return None;
                }
                b'[' if index + 8 <= bytes.len()
                    && bytes[index..index + 8].eq_ignore_ascii_case(b"[[/div]]") =>
                {
                    return Some((index, ResidualStandaloneEvent::MarkerClose));
                }
                b'[' if index + 5 <= bytes.len()
                    && &bytes[index..index + 5] == b"[[div" =>
                {
                    return Some((index, ResidualStandaloneEvent::MarkerOpen));
                }
                _ => index += 1,
            }
        }
        None
    }

    fn residual_standalone_marker_end(line: &str, start: usize) -> Option<usize> {
        line[start..].find("]]").map(|offset| start + offset + 2)
    }

    pub(in crate::services::render) fn restore_standalone_residual_wikidot_div_markers(
        html: &str,
    ) -> String {
        let mut output = String::with_capacity(html.len());
        let mut restored_open_count = 0usize;
        let mut raw_text_depth = 0usize;

        for line in html.split_inclusive('\n') {
            let (line_body, line_end) = line
                .strip_suffix('\n')
                .map_or((line, ""), |body| (body, "\n"));
            let mut cursor = 0usize;
            while let Some((index, event)) =
                Self::residual_standalone_find_next_event(line_body, cursor)
            {
                match event {
                    ResidualStandaloneEvent::RawTextOpen(tag_end) => {
                        output.push_str(&line_body[cursor..tag_end]);
                        raw_text_depth += 1;
                        cursor = tag_end;
                    }
                    ResidualStandaloneEvent::RawTextClose(tag_end) => {
                        output.push_str(&line_body[cursor..tag_end]);
                        raw_text_depth = raw_text_depth.saturating_sub(1);
                        cursor = tag_end;
                    }
                    ResidualStandaloneEvent::MarkerOpen => {
                        let marker_end =
                            Self::residual_standalone_marker_end(line_body, index)
                                .unwrap_or(line_body.len());
                        output.push_str(&line_body[cursor..index]);
                        if raw_text_depth == 0 {
                            let marker = &line_body[index..marker_end];
                            let decoded =
                                Self::decode_residual_wikidot_marker_quotes(marker);
                            if let Some(attributes) =
                                Self::wikidot_residual_div_attributes(&decoded)
                            {
                                output.push_str(&format!("<div{attributes}>"));
                                restored_open_count += 1;
                            } else {
                                output.push_str(marker);
                            }
                        } else {
                            output.push_str(&line_body[index..marker_end]);
                        }
                        cursor = marker_end;
                    }
                    ResidualStandaloneEvent::MarkerClose => {
                        let marker_end = index + "[[/div]]".len();
                        output.push_str(&line_body[cursor..index]);
                        if raw_text_depth == 0 && restored_open_count > 0 {
                            output.push_str("</div>");
                            restored_open_count -= 1;
                        } else {
                            output.push_str(&line_body[index..marker_end]);
                        }
                        cursor = marker_end;
                    }
                }
            }
            output.push_str(&line_body[cursor..]);
            output.push_str(line_end);
        }

        output
    }

    pub(in crate::services::render) fn push_replaced_standalone_wikidot_marker_line(
        output: &mut String,
        line_body: &str,
        line_end: &str,
        replacement: &str,
    ) {
        let prefix_len = line_body.len() - line_body.trim_start().len();
        let suffix_len = line_body.len() - line_body.trim_end().len();
        output.push_str(&line_body[..prefix_len]);
        output.push_str(replacement);
        output.push_str(&line_body[line_body.len() - suffix_len..]);
        output.push_str(line_end);
    }

    pub(in crate::services::render) fn update_residual_div_raw_text_depth(
        mut depth: usize,
        line: &str,
    ) -> usize {
        let lower = line.to_ascii_lowercase();
        for tag in ["pre", "code", "textarea", "style", "script", "tt"] {
            depth += lower.matches(&format!("<{tag}")).count();
            depth = depth.saturating_sub(lower.matches(&format!("</{tag}>")).count());
        }
        depth
    }

    pub(in crate::services::render) fn decode_residual_wikidot_marker_quotes(
        marker: &str,
    ) -> String {
        marker
            .replace("&quot;", "\"")
            .replace("&#34;", "\"")
            .replace("&#x22;", "\"")
            .replace("&#X22;", "\"")
    }

    pub(in crate::services::render) fn residual_wikidot_alignment_open_replacement(
        marker: &str,
    ) -> Option<(&'static str, &'static str)> {
        match marker.to_ascii_lowercase().as_str() {
            "[[=]]" => Some(("center", r#"<div style="text-align: center;">"#)),
            "[[<]]" | "[[&lt;]]" => Some(("left", r#"<div style="text-align: left;">"#)),
            "[[>]]" | "[[&gt;]]" => {
                Some(("right", r#"<div style="text-align: right;">"#))
            }
            _ => None,
        }
    }

    pub(in crate::services::render) fn residual_wikidot_alignment_close(
        marker: &str,
    ) -> Option<&'static str> {
        match marker.to_ascii_lowercase().as_str() {
            "[[/=]]" => Some("center"),
            "[[/<]]" | "[[/&lt;]]" => Some("left"),
            "[[/>]]" | "[[/&gt;]]" => Some("right"),
            _ => None,
        }
    }

    pub(in crate::services::render) fn residual_wikidot_horizontal_rule_line(
        line: &str,
    ) -> bool {
        line.len() >= 4 && line.chars().all(|character| character == '-')
    }

    pub(in crate::services::render) fn residual_wikidot_content_section_line(
        line: &str,
    ) -> bool {
        line.len() >= 4 && line.chars().all(|character| character == '=')
    }

    pub(in crate::services::render) fn residual_wikidot_heading_replacement(
        line: &str,
    ) -> Option<(usize, &str)> {
        let level = line.bytes().take_while(|byte| *byte == b'+').count();
        if !(1..=6).contains(&level) {
            return None;
        }

        let mut body = &line[level..];
        if body.starts_with('*') {
            body = &body[1..];
        }
        body = body.trim_start();
        if body.is_empty() {
            return None;
        }

        Some((level, body))
    }
}
