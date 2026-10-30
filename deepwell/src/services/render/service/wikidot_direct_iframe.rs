//! Wikidot's direct emission of a saved `[[html]]` block that holds one iframe.

use super::{LazyLock, Regex, RenderService};

static WIKIDOT_DIRECT_HTML_IFRAME_REGEX: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"(?is)^\s*(?P<iframe><iframe\b(?P<attrs>[^<>]*)>\s*</iframe\s*>)\s*$"#)
        .expect("direct Wikidot HTML iframe expression is valid")
});
static WIKIDOT_DIRECT_HTML_IFRAME_ATTRIBUTE_REGEX: LazyLock<Regex> = LazyLock::new(
    || {
        Regex::new(
            r#"(?is)\s+(?P<name>[a-z][a-z0-9:-]*)(?:\s*=\s*(?P<value>"[^"<>]*"|'[^'<>]*'|[^\s"'=<>`]+))?"#,
        )
        .expect("direct Wikidot HTML iframe attribute expression is valid")
    },
);

/// One attribute of a lone `[[html]]` block iframe, with its name
/// lowercased and its value unquoted.
pub(in crate::services::render) struct WikidotHtmlBlockIframeAttribute<'a> {
    pub name: String,
    pub value: Option<&'a str>,
}

/// A saved `[[html]]` block that holds exactly one empty iframe whose
/// attributes all belong to the recognized set.
pub(in crate::services::render) struct WikidotHtmlBlockIframe<'a> {
    pub iframe: &'a str,
    pub attributes: Vec<WikidotHtmlBlockIframeAttribute<'a>>,
}

impl<'a> WikidotHtmlBlockIframe<'a> {
    /// The value of the first attribute with this (already lowercased) name.
    pub fn attribute_value(&self, name: &str) -> Option<&'a str> {
        self.attributes
            .iter()
            .find(|attribute| attribute.name == name)
            .and_then(|attribute| attribute.value)
    }

    /// How many attributes carry this (already lowercased) name.
    pub fn attribute_count(&self, name: &str) -> usize {
        self.attributes
            .iter()
            .filter(|attribute| attribute.name == name)
            .count()
    }
}

fn unquoted_attribute_value<'a>(raw: &'a str) -> &'a str {
    raw.strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .or_else(|| {
            raw.strip_prefix('\'')
                .and_then(|rest| rest.strip_suffix('\''))
        })
        .unwrap_or(raw)
}

impl RenderService {
    /// Parses a saved `[[html]]` block that holds exactly one empty iframe.
    ///
    /// Every attribute must belong to the recognized set, and the iframe
    /// must carry at least one attribute; anything else returns `None`.
    /// The `src` value is not vetted here: each emission path applies its
    /// own rules on top of this shape.
    pub(in crate::services::render) fn parse_wikidot_html_block_iframe(
        html_block: &str,
    ) -> Option<WikidotHtmlBlockIframe<'_>> {
        const ALLOWED_ATTRIBUTES: &[&str] = &[
            "align",
            "allow",
            "allowfullscreen",
            "class",
            "frameborder",
            "height",
            "loading",
            "referrerpolicy",
            "sandbox",
            "scrolling",
            "src",
            "style",
            "title",
            "width",
        ];

        let captures = WIKIDOT_DIRECT_HTML_IFRAME_REGEX.captures(html_block)?;
        let attributes = captures
            .name("attrs")
            .expect("direct iframe capture has attributes")
            .as_str();
        let mut cursor = 0;
        let mut parsed_attributes = Vec::new();
        for attribute in
            WIKIDOT_DIRECT_HTML_IFRAME_ATTRIBUTE_REGEX.captures_iter(attributes)
        {
            let whole = attribute
                .get(0)
                .expect("direct iframe attribute capture has whole match");
            if !attributes[cursor..whole.start()].trim().is_empty() {
                return None;
            }
            let name = attribute
                .name("name")
                .expect("direct iframe attribute capture has name")
                .as_str()
                .to_ascii_lowercase();
            if !ALLOWED_ATTRIBUTES.contains(&name.as_str()) {
                return None;
            }
            let value = attribute
                .name("value")
                .map(|value| unquoted_attribute_value(value.as_str()));
            parsed_attributes.push(WikidotHtmlBlockIframeAttribute { name, value });
            cursor = whole.end();
        }
        if !attributes[cursor..].trim().is_empty() || parsed_attributes.is_empty() {
            return None;
        }
        captures
            .name("iframe")
            .map(|iframe| WikidotHtmlBlockIframe {
                iframe: iframe.as_str(),
                attributes: parsed_attributes,
            })
    }

    /// The iframe a saved `[[html]]` block holds when Wikidot emits it
    /// directly instead of behind the hosted `html-block-iframe` wrapper.
    ///
    /// The block must hold one empty iframe with at least one recognized
    /// attribute and no unknown one. A `src` that is present must be a single
    /// absolute http(s) URL, the same gate as the legacy `[[iframe]]`
    /// directive: a repeated, bare, `javascript:`, `data:`, or relative `src`
    /// keeps the hosted wrapper. An iframe without `src` loads nothing, and
    /// live Wikidot emits it directly (for example a title-only iframe).
    pub(super) fn wikidot_direct_html_iframe(html_block: &str) -> Option<&str> {
        let parsed = Self::parse_wikidot_html_block_iframe(html_block)?;
        let mut src_seen = false;
        for attribute in &parsed.attributes {
            if attribute.name == "src" {
                // Browsers resolve the first src and compare its scheme
                // case-insensitively, so a repeated src cannot be vetted.
                if std::mem::replace(&mut src_seen, true) {
                    return None;
                }
                let unquoted = attribute.value?;
                // Live probes cover HTTP and HTTPS src values for direct
                // emission, and list sandbox among the pass-through
                // attributes, so sandbox stays allowlisted.
                if !(unquoted.starts_with("https://") || unquoted.starts_with("http://"))
                {
                    return None;
                }
            }
        }
        Some(parsed.iframe)
    }
}
