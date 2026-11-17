use serde::{Deserialize, Serialize};

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct CompiledStyles {
    pub(crate) styles: Vec<String>,
    pub(crate) theme_previewer_blank: bool,
    pub(crate) theme_previewer_url: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedPresentationV1 {
    version: u8,
    styles: Vec<String>,
    theme_previewer_blank: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedPresentationV2 {
    version: u8,
    styles: Vec<String>,
    theme_previewer_blank: bool,
    theme_previewer_url: String,
}

pub(crate) fn encode(
    styles: &[String],
    theme_previewer_blank: bool,
    theme_previewer_url: Option<&str>,
) -> serde_json::Result<String> {
    if let Some(theme_previewer_url) = theme_previewer_url {
        return serde_json::to_string(&SavedPresentationV2 {
            version: 2,
            styles: styles.to_vec(),
            theme_previewer_blank,
            theme_previewer_url: theme_previewer_url.to_owned(),
        });
    }
    if !theme_previewer_blank {
        return serde_json::to_string(styles);
    }
    serde_json::to_string(&SavedPresentationV1 {
        version: 1,
        styles: styles.to_vec(),
        theme_previewer_blank,
    })
}

pub(crate) fn decode(input: &str) -> serde_json::Result<CompiledStyles> {
    let value: serde_json::Value = serde_json::from_str(input)?;
    if value.is_array() {
        return Ok(CompiledStyles {
            styles: serde_json::from_value(value)?,
            theme_previewer_blank: false,
            theme_previewer_url: None,
        });
    }
    let version = value
        .get("version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| {
            <serde_json::Error as serde::de::Error>::custom(
                "saved presentation is missing its version",
            )
        })?;
    match version {
        1 => {
            let saved: SavedPresentationV1 = serde_json::from_value(value)?;
            Ok(CompiledStyles {
                styles: saved.styles,
                theme_previewer_blank: saved.theme_previewer_blank,
                theme_previewer_url: None,
            })
        }
        2 => {
            let saved: SavedPresentationV2 = serde_json::from_value(value)?;
            Ok(CompiledStyles {
                styles: saved.styles,
                theme_previewer_blank: saved.theme_previewer_blank,
                theme_previewer_url: Some(saved.theme_previewer_url),
            })
        }
        _ => Err(<serde_json::Error as serde::de::Error>::custom(
            "unsupported saved presentation version",
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_styles_and_saved_blank_theme_round_trip_without_css_markers() {
        let styles = vec!["body{color:red}".to_owned()];
        assert_eq!(
            encode(&styles, false, None).unwrap(),
            serde_json::to_string(&styles).unwrap()
        );
        assert_eq!(
            decode(&encode(&styles, false, None).unwrap()).unwrap(),
            CompiledStyles {
                styles: styles.clone(),
                theme_previewer_blank: false,
                theme_previewer_url: None
            }
        );
        assert_eq!(
            decode(&encode(&styles, true, None).unwrap()).unwrap(),
            CompiledStyles {
                styles: styles.clone(),
                theme_previewer_blank: true,
                theme_previewer_url: None
            }
        );
        assert_eq!(
            decode(
                &encode(&styles, false, Some("https://example.test/theme.css")).unwrap()
            )
            .unwrap(),
            CompiledStyles {
                styles,
                theme_previewer_blank: false,
                theme_previewer_url: Some("https://example.test/theme.css".to_owned())
            }
        );
        for invalid in [
            r#"{"version":2,"styles":[],"theme_previewer_blank":true}"#,
            r#"{"version":1,"styles":[],"theme_previewer_blank":true,"other":true}"#,
            "null",
        ] {
            assert!(decode(invalid).is_err());
        }
    }
}
