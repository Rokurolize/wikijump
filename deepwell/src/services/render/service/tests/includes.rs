use super::*;

fn prepare_test_nested_include_conditionals(
    source: &str,
    variables: &[(&'static str, &'static str)],
    tags: &[&'static str],
) -> String {
    let include = IncludeRef::new(
        PageRef::page_only("component:test"),
        variables
            .iter()
            .map(|&(name, value)| (Cow::Borrowed(name), Cow::Borrowed(value)))
            .collect(),
    );
    let mut page_info = fallback_test_page_info("consumer", "Consumer");
    page_info.tags = tags.iter().map(|&tag| Cow::Borrowed(tag)).collect();
    let mut source = source.to_owned();
    let mut compat_text = CompatTextFragments::new(&source);
    super::super::prepare_include_source_variables_and_comment_branches(
        &mut source,
        &include,
        &page_info,
        &mut compat_text,
    )
    .expect("test include source should remain within the byte budget");
    let mut preserved = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        1,
    );
    compat_text.restore(&preserved.restore(&source))
}

fn resolve_test_included_variable_iftags(
    source: &str,
    variables: &[(&'static str, &'static str)],
    tags: &[&'static str],
) -> String {
    let include = IncludeRef::new(
        PageRef::page_only("component:test"),
        variables
            .iter()
            .map(|&(name, value)| (Cow::Borrowed(name), Cow::Borrowed(value)))
            .collect(),
    );
    let mut page_info = fallback_test_page_info("consumer", "Consumer");
    page_info.tags = tags.iter().map(|&tag| Cow::Borrowed(tag)).collect();
    let mut source = source.to_owned();

    super::super::apply_include_variables_before_resolving_iftags(
        &mut source,
        &include,
        &page_info,
    )
    .expect("test include variables should remain within the byte budget");
    resolve_test_wikidot_iftags(&mut source, &page_info);
    source
}

#[tokio::test]
async fn include_source_cache_loads_each_canonical_page_once() {
    let first_ref = PageRef::page_only("Component:Sybadge#first");
    let second_ref = PageRef::page_only("component:sybadge/second");
    assert_eq!(first_ref.page(), second_ref.page());

    let mut cache = IncludeSourceCache::default();
    let mut load_count = 0;
    let mut first = cache
        .get_or_try_insert_with(1, first_ref.page(), || {
            load_count += 1;
            async { Ok(Some("CACHE-{$label}-END".to_owned())) }
        })
        .await
        .expect("the first include source load should succeed")
        .expect("the first include source should be available");
    let first_include = IncludeRef::new(
        first_ref,
        VariableMap::from([(Cow::Borrowed("label"), Cow::Borrowed("first"))]),
    );
    super::super::apply_include_variables(&mut first, &first_include)
        .expect("first cached source should remain within the byte budget");

    let mut second = cache
        .get_or_try_insert_with(1, second_ref.page(), || {
            load_count += 1;
            async { Ok(Some("CHANGED".to_owned())) }
        })
        .await
        .expect("the cached include source load should succeed")
        .expect("the cached include source should be available");
    let second_include = IncludeRef::new(
        second_ref,
        VariableMap::from([(Cow::Borrowed("label"), Cow::Borrowed("second"))]),
    );
    super::super::apply_include_variables(&mut second, &second_include)
        .expect("second cached source should remain within the byte budget");

    assert_eq!(load_count, 1);
    assert_eq!(first, "CACHE-first-END");
    assert_eq!(second, "CACHE-second-END");

    let explicit_default = cache
        .get_or_try_insert_with(1, "_default:home", || {
            load_count += 1;
            async { Ok(Some("DEFAULT-PAGE".to_owned())) }
        })
        .await
        .expect("the explicit default-category source load should succeed");
    let implicit_default = cache
        .get_or_try_insert_with(1, "home", || {
            load_count += 1;
            async { Ok(Some("CHANGED-DEFAULT-PAGE".to_owned())) }
        })
        .await
        .expect("the canonical default-category source load should succeed");
    assert_eq!(explicit_default, implicit_default);

    let other_site = cache
        .get_or_try_insert_with(2, "component:sybadge", || {
            load_count += 1;
            async { Ok(Some("OTHER-SITE".to_owned())) }
        })
        .await
        .expect("the other-site include source load should succeed");
    assert_eq!(other_site.as_deref(), Some("OTHER-SITE"));

    let unavailable = cache
        .get_or_try_insert_with(1, "component:private", || {
            load_count += 1;
            async { Ok(None) }
        })
        .await
        .expect("the unavailable include source load should succeed");
    assert_eq!(unavailable, None);
    let unavailable_again = cache
        .get_or_try_insert_with(1, "component:private", || {
            load_count += 1;
            async { Ok(Some("PRIVATE".to_owned())) }
        })
        .await
        .expect("the cached unavailable source load should succeed");
    assert_eq!(unavailable_again, None);
    assert_eq!(load_count, 4);
}

#[tokio::test]
async fn include_source_cache_reuses_found_and_missing_sites_but_not_errors() {
    let mut cache = IncludeSourceCache::default();
    let mut site = wikidot_site("scpwiki", Some("scp-wiki.wikidot.com"));
    site.site_id = 7;
    let mut load_count = 0;

    let first_by_id = cache
        .get_site_by_id_or_try_insert_with(7, || {
            load_count += 1;
            async { Ok(Some(site.clone())) }
        })
        .await
        .expect("the first site ID lookup should succeed");
    let second_by_id = cache
        .get_site_by_id_or_try_insert_with(7, || {
            load_count += 1;
            async { Ok(None) }
        })
        .await
        .expect("the cached site ID lookup should succeed");
    assert_eq!(first_by_id, second_by_id);

    let canonical_slug = cache
        .get_site_by_slug_or_try_insert_with("scpwiki", || {
            load_count += 1;
            async { Ok(Some(site.clone())) }
        })
        .await
        .expect("the canonical slug lookup should succeed independently");
    assert_eq!(canonical_slug, first_by_id);

    let missing = cache
        .get_site_by_slug_or_try_insert_with("scp-int", || {
            load_count += 1;
            async { Ok(None) }
        })
        .await
        .expect("the first missing-site lookup should succeed");
    let missing_again = cache
        .get_site_by_slug_or_try_insert_with("scp-int", || {
            load_count += 1;
            async { Ok(Some(site.clone())) }
        })
        .await
        .expect("the cached missing-site lookup should succeed");
    assert_eq!(missing, None);
    assert_eq!(missing_again, None);

    let failed = cache
        .get_site_by_slug_or_try_insert_with("retryable", || {
            load_count += 1;
            async { Err(include_error()) }
        })
        .await;
    assert!(failed.is_err());
    let recovered = cache
        .get_site_by_slug_or_try_insert_with("retryable", || {
            load_count += 1;
            async { Ok(Some(site.clone())) }
        })
        .await
        .expect("a failed lookup should be retried");
    assert_eq!(recovered, Some(site));
    assert_eq!(load_count, 5);
}

#[test]
fn expands_wikidot_image_block_includes_with_defaults_and_arguments() {
    let mut wikitext = concat!(
        "[[include component:image-block\n",
        "    name=theend.jpg|\n",
        "    caption=The end title card.\n",
        "]]\n",
        "[[include component:image-block name=steel.png|align=center|width=100%|caption=Steel frame.|alt=alt|alt-text=A steel frame.]]\n",
        "[[include component:image-block-base name=raw.jpg]]\n",
    )
    .to_owned();

    let page_info = fallback_test_page_info("scp-3922", "SCP-3922");
    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(
        wikitext.contains(
            r#"[[div class="scp-image-block block-right" style="width:300px;"]]"#
        )
    );
    assert!(wikitext.contains(
        "[[image http://scp-wiki.wikidot.com/local--files/scp-3922/theend.jpg]]"
    ));
    assert!(wikitext.contains("The end title card."));
    assert!(
        wikitext.contains(
            r#"[[div class="scp-image-block block-center" style="width:100%;"]]"#
        )
    );
    assert!(wikitext.contains(
        r#"[[image http://scp-wiki.wikidot.com/local--files/scp-3922/steel.png alt="A steel frame."]]"#
    ));
    assert!(wikitext.contains("[[include component:image-block-base name=raw.jpg]]"));
    assert!(!wikitext.contains("[[include component:image-block\n"));
    assert_eq!(
        included_pages,
        vec![
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
        ],
    );

    let mut category_page_info = fallback_test_page_info("basalt", "Basalt Theme");
    category_page_info.category = Some(Cow::Borrowed("theme"));
    assert_eq!(
        RenderService::wikidot_image_block_source("logo.svg", &category_page_info, None,),
        "http://scp-wiki.wikidot.com/local--files/theme:basalt/logo.svg"
    );
}

#[test]
fn expands_wikidot_image_block_without_caption_to_literal_variable() {
    let mut wikitext =
        "[[include component:image-block name=spc-4531-1.png]]\n".to_owned();

    let page_info = fallback_test_page_info("art:spc-4531-1", "SPC-4531-1");
    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(
        wikitext.contains("[[div class=\"scp-image-caption\"]]\n{$caption}\n[[/div]]")
    );
    assert_eq!(
        included_pages,
        vec![
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
        ],
    );
}

#[test]
fn expands_multiline_image_block_parameters_before_following_article_text() {
    let mut wikitext = concat!(
        "[[include component:image-block\n",
        "    name=Replication.jpg|\n",
        "    caption=Researcher O'Conner and Dr. Wettle.|\n",
        "    align=center|\n",
        "    width=100%|\n",
        "]]\n",
        "\n",
        "**Researcher O'Conner:** The following dialogue is outside the image block.\n",
        "\n",
        "[[include component:image-block\n",
        "    name=Egg.jpg|\n",
        "    caption=Dr. Dan's breakfast for 16 July 2022.|\n",
        "    align=center|\n",
        "    width=700px|\n",
        "]]\n",
        "\n",
        "|+ A later table\n",
        "|| a || b ||\n",
    )
    .to_owned();
    let page_info = fallback_test_page_info("scp-7000", "SCP-7000");

    RenderService::normalize_wikidot_multiline_includes(&mut wikitext);
    assert!(
        wikitext.contains(
            "[[include component:image-block name=Replication.jpg| caption=Researcher O'Conner and Dr. Wettle.| align=center| width=100%|]]"
        ),
        "normalized include source: {wikitext}"
    );
    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(
        wikitext.contains(
            r#"[[div class="scp-image-block block-center" style="width:100%;"]]"#
        )
    );
    assert!(wikitext.contains(
        r#"[[div class="scp-image-block block-center" style="width:700px;"]]"#
    ));
    assert!(wikitext.contains("Researcher O'Conner and Dr. Wettle.\n[[/div]]\n[[/div]]"));
    assert!(wikitext.contains(
        "[[/div]]\n[[/div]]\n\n**Researcher O'Conner:** The following dialogue is outside the image block."
    ));
    assert!(
        wikitext.contains("Dr. Dan's breakfast for 16 July 2022.\n[[/div]]\n[[/div]]")
    );
    assert!(wikitext.contains("|+ A later table\n|| a || b ||"));
    assert!(!wikitext.contains("align=center|"));
    assert!(!wikitext.contains("width=100%|"));
    assert!(!wikitext.contains("width=700px|"));
    assert_eq!(included_pages.len(), 4);
}

#[test]
fn expands_wikidot_image_block_includes_with_nested_caption_markup() {
    let mut wikitext = concat!(
        "[[include :scp-wiki:component:image-block ",
        "name=linked.jpg|caption=See [[[SCP-173|the statue]]] for details.]]\n",
    )
    .to_owned();
    let page_info = fallback_test_page_info("scp-3922", "SCP-3922");

    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(wikitext.contains("See [[[SCP-173|the statue]]] for details."));
    assert!(wikitext.contains(
        "[[image http://scp-wiki.wikidot.com/local--files/scp-3922/linked.jpg]]"
    ));
    assert_eq!(
        included_pages,
        vec![
            PageRef::page_and_site("scp-wiki", "component:image-block"),
            PageRef::page_and_site("scp-wiki", "component:image-block-base"),
        ],
    );
}

#[test]
fn image_block_prepass_keeps_extensionless_root_attachments_implicit() {
    let mut wikitext =
        "[[include component:image-block name=Lobster|caption=An attachment.]]"
            .to_owned();
    let page_info = fallback_test_page_info("scp-5516", "SCP-5516");

    RenderService::expand_wikidot_image_block_includes(&mut wikitext, &page_info, None);

    assert!(wikitext.contains("[[image Lobster]]"), "{wikitext}");
    assert!(
        !wikitext.contains("local--files/scp-5516/Lobster"),
        "{wikitext}"
    );
}

#[test]
fn expands_scp_2117_shaped_image_block_with_fragment_src_and_absolute_link() {
    let mut wikitext = concat!(
        "[[include component:image-block ",
        "name=2117.png|alt=alt|alt-text=An image|",
        "link=\"https://scp-wiki.wdfiles.com/local--files/fragment:2117-1/2117.png\"]]",
    )
    .to_owned();
    let page_info = fallback_test_page_info("scp-2117", "SCP-2117");

    RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        Some(("scp-wiki", "fragment:2117-1")),
    );

    assert!(wikitext.contains(
        r#"[[image http://scp-wiki.wikidot.com/local--files/fragment:2117-1/2117.png alt="An image" link="https://scp-wiki.wdfiles.com/local--files/fragment:2117-1/2117.png"]]"#,
    ), "{wikitext}");
    assert!(!wikitext.contains("%22https%3A"), "{wikitext}");
    assert!(
        !wikitext.contains("/local--files/scp-2117/2117.png"),
        "{wikitext}"
    );
}

#[test]
fn image_block_prepass_preserves_quoted_hash_link_distinction() {
    let page_info = fallback_test_page_info("consumer", "Consumer");

    for (raw_link, expected) in [
        (
            "#",
            "[[image http://scp-wiki.wikidot.com/local--files/consumer/fixture.png]]",
        ),
        (
            "\"#\"",
            "[[image http://scp-wiki.wikidot.com/local--files/consumer/fixture.png link=\"#\"]]",
        ),
    ] {
        let mut wikitext = format!(
            "[[include component:image-block name=fixture.png|link={raw_link}]]",
        );

        RenderService::expand_wikidot_image_block_includes(
            &mut wikitext,
            &page_info,
            None,
        );

        assert!(
            wikitext.contains(expected),
            "raw_link={raw_link:?}: {wikitext}"
        );
    }
}

#[test]
fn image_block_prepass_consumes_forwarded_name_and_link_provenance() {
    let variables = [
        (Cow::Borrowed("asset"), Cow::Borrowed("source image.png")),
        (Cow::Borrowed("href"), Cow::Borrowed("source full.png")),
    ]
    .into_iter()
    .collect::<VariableMap<'_>>();
    let owners = [
        (
            "asset".to_owned(),
            AttachmentOwner {
                site_slug: "source-site".into(),
                page_slug: "fragment:source".into(),
            },
        ),
        (
            "href".to_owned(),
            AttachmentOwner {
                site_slug: "link-site".into(),
                page_slug: "fragment:link-source".into(),
            },
        ),
    ]
    .into_iter()
    .collect::<AttachmentVariableOwners>();
    let mut provenance = AttachmentProvenanceRegistry::default();
    let mut wikitext = concat!(
        "[[include[!-- opening gap --] component:image-block ",
        "[!-- argument gap [x] | still comment --] name [!-- key gap --] = ",
        "[!-- value gap --] \"{$asset}\"|name=default.png|",
        "link [!-- link gap --] = '{$href}'|link=default-full.png|",
        "caption=\"quoted ]] | caption\"]]\n",
        "after",
    )
    .to_owned();
    protect_forwarded_attachment_variables(
        &mut wikitext,
        &variables,
        &owners,
        &mut provenance,
    );
    assert!(wikitext.contains("__wj_attachment_"), "{wikitext}");

    let page_info = fallback_test_page_info("consumer", "Consumer");
    RenderService::expand_wikidot_image_block_includes_with_provenance(
        &mut wikitext,
        &page_info,
        Some(("intermediate", "component:image-block")),
        Some(&provenance),
    );

    assert!(
        wikitext.contains(concat!(
            "https://source-site.wikidot.com/local--files/",
            "fragment:source/source%20image.png",
        )),
        "{wikitext}",
    );
    assert!(
        wikitext.contains(concat!(
            "link='https://link-site.wikidot.com/local--files/",
            "fragment:link-source/source%20full.png'",
        )),
        "{wikitext}",
    );
    assert!(!wikitext.contains("__wj_attachment_"), "{wikitext}");
    assert!(!wikitext.contains("intermediate.wikidot.com"), "{wikitext}");
    assert!(!wikitext.contains("default.png"), "{wikitext}");
    assert!(!wikitext.contains("default-full.png"), "{wikitext}");
    assert!(
        wikitext.contains("\n\"quoted ]] | caption\"\n[[/div]]\n[[/div]]\nafter"),
        "{wikitext}",
    );
}

#[test]
fn image_block_prepass_decodes_all_forwarded_arguments_before_semantics() {
    let variables = [
        (Cow::Borrowed("asset"), Cow::Borrowed("source image.png")),
        (Cow::Borrowed("attribute"), Cow::Borrowed("alt")),
        (
            Cow::Borrowed("description"),
            Cow::Borrowed(r#"A "quoted" label"#),
        ),
        (Cow::Borrowed("caption"), Cow::Borrowed("Forwarded caption")),
        (Cow::Borrowed("width"), Cow::Borrowed("225px")),
        (Cow::Borrowed("align"), Cow::Borrowed("left")),
    ]
    .into_iter()
    .collect::<VariableMap<'_>>();
    let owner = AttachmentOwner {
        site_slug: "source-site".into(),
        page_slug: "fragment:source".into(),
    };
    let owners = variables
        .keys()
        .map(|name| (name.to_string(), owner.clone()))
        .collect::<AttachmentVariableOwners>();
    let mut provenance = AttachmentProvenanceRegistry::default();
    let mut wikitext = concat!(
        "[[include component:image-block name={$asset}|alt={$attribute}|",
        "alt-text={$description}|caption={$caption}|width={$width}|align={$align}]]",
    )
    .to_owned();
    protect_forwarded_attachment_variables(
        &mut wikitext,
        &variables,
        &owners,
        &mut provenance,
    );

    let page_info = fallback_test_page_info("consumer", "Consumer");
    RenderService::expand_wikidot_image_block_includes_with_provenance(
        &mut wikitext,
        &page_info,
        Some(("intermediate", "component:image-block")),
        Some(&provenance),
    );

    assert!(
        wikitext.contains(concat!(
            "https://source-site.wikidot.com/local--files/",
            "fragment:source/source%20image.png",
        )),
        "{wikitext}",
    );
    assert!(wikitext.contains("block-left"), "{wikitext}");
    assert!(wikitext.contains("width:225px"), "{wikitext}");
    assert!(
        wikitext.contains(r#" alt="A &quot;quoted&quot; label""#),
        "{wikitext}",
    );
    assert!(wikitext.contains("Forwarded caption"), "{wikitext}");
    assert!(!wikitext.contains("__wj_attachment_"), "{wikitext}");
}

#[test]
fn image_block_prepass_decodes_forwarded_values_before_required_and_duplicate_checks() {
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let owner = AttachmentOwner {
        site_slug: "source-site".into(),
        page_slug: "fragment:source".into(),
    };

    let empty_variables = [(Cow::Borrowed("empty"), Cow::Borrowed(""))]
        .into_iter()
        .collect::<VariableMap<'_>>();
    let empty_owners = [("empty".to_owned(), owner.clone())].into_iter().collect();
    let mut empty_provenance = AttachmentProvenanceRegistry::default();
    let mut empty_name = "[[include component:image-block name={$empty}]]".to_owned();
    protect_forwarded_attachment_variables(
        &mut empty_name,
        &empty_variables,
        &empty_owners,
        &mut empty_provenance,
    );
    let included_pages =
        RenderService::expand_wikidot_image_block_includes_with_provenance(
            &mut empty_name,
            &page_info,
            Some(("intermediate", "component:image-block")),
            Some(&empty_provenance),
        );
    assert!(included_pages.is_empty());
    assert!(empty_name.contains("__wj_attachment_"), "{empty_name}");
    empty_provenance.restore_unresolved(&mut empty_name);
    assert_eq!(empty_name, "[[include component:image-block name=]]",);

    let self_ref_variables = [(Cow::Borrowed("forwarded"), Cow::Borrowed("{$NAME}"))]
        .into_iter()
        .collect::<VariableMap<'_>>();
    let self_ref_owners = [("forwarded".to_owned(), owner)].into_iter().collect();
    let mut self_ref_provenance = AttachmentProvenanceRegistry::default();
    let mut self_ref = concat!(
        "[[include component:image-block ",
        "NAME={$forwarded}|name=default image.png]]",
    )
    .to_owned();
    protect_forwarded_attachment_variables(
        &mut self_ref,
        &self_ref_variables,
        &self_ref_owners,
        &mut self_ref_provenance,
    );
    RenderService::expand_wikidot_image_block_includes_with_provenance(
        &mut self_ref,
        &page_info,
        Some(("scp-wiki", "component:wrapper")),
        Some(&self_ref_provenance),
    );
    assert!(
        self_ref.contains(concat!(
            "http://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/default%20image.png",
        )),
        "{self_ref}",
    );
    assert!(!self_ref.contains("__wj_attachment_"), "{self_ref}");
    assert!(!self_ref.contains("{$NAME}"), "{self_ref}");
}

#[test]
fn image_block_prepass_uses_later_defaults_only_for_self_references() {
    let mut wikitext = concat!(
        "[[include[!-- opening gap --] component:image-block ",
        "[!-- argument gap [x] | still comment --] NAME [!-- key gap --] = ",
        "[!-- value gap --] {$NAME}|NAME=default image.png|",
        "LINK [!-- link gap --] = {$LINK}|LINK=default full.png]]",
    )
    .to_owned();
    let page_info = fallback_test_page_info("consumer", "Consumer");

    RenderService::expand_wikidot_image_block_includes_with_provenance(
        &mut wikitext,
        &page_info,
        Some(("scp-wiki", "component:wrapper")),
        Some(&AttachmentProvenanceRegistry::default()),
    );

    assert!(
        wikitext.contains(concat!(
            "http://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/default%20image.png",
        )),
        "{wikitext}",
    );
    assert!(
        wikitext.contains(concat!(
            "link=https://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/default%20full.png",
        )),
        "{wikitext}",
    );
    assert!(!wikitext.contains("{$NAME}"), "{wikitext}");
    assert!(!wikitext.contains("{$LINK}"), "{wikitext}");
}

#[test]
fn image_block_prepass_rejects_malformed_argument_segments() {
    let page_info = fallback_test_page_info("consumer", "Consumer");

    for source in [
        "[[include component:image-block name=foo.png|link]]",
        "[[include component:image-block name=foo.png|bad segment]]",
        "[[include component:image-block name=foo.png|[!-- unclosed]]",
    ] {
        let mut wikitext = source.to_owned();
        let included_pages = RenderService::expand_wikidot_image_block_includes(
            &mut wikitext,
            &page_info,
            None,
        );

        assert_eq!(wikitext, source);
        assert!(included_pages.is_empty(), "{source}");
    }

    let mut wikitext = concat!(
        "[[include component:image-block ||",
        "[!-- comment [x] | inside --]| name=foo.png | ]]",
    )
    .to_owned();
    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(
        wikitext.contains("/local--files/consumer/foo.png"),
        "{wikitext}",
    );
    assert_eq!(
        included_pages,
        vec![
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
        ],
    );
}

#[test]
fn image_block_prepass_unquotes_composite_names_for_the_authoring_page() {
    let mut wikitext = concat!(
        "[[include component:image-block name=\"thumb-real image.png\"|",
        "link=\"full-real image.png\"]]",
    )
    .to_owned();
    let page_info = fallback_test_page_info("consumer", "Consumer");

    RenderService::expand_wikidot_image_block_includes_with_provenance(
        &mut wikitext,
        &page_info,
        Some(("scp-wiki", "component:wrapper")),
        Some(&AttachmentProvenanceRegistry::default()),
    );

    assert!(
        wikitext.contains(
            "http://scp-wiki.wikidot.com/local--files/component:wrapper/thumb-real%20image.png",
        ),
        "{wikitext}",
    );
    assert!(!wikitext.contains("%22"), "{wikitext}");
    assert!(
        wikitext.contains(concat!(
            "link=\"https://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/full-real%20image.png\"",
        )),
        "{wikitext}",
    );

    ftml::preprocess_for_layout(&mut wikitext, Layout::Wikidot);
    let tokens = ftml::tokenize(&wikitext);
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    assert!(
        html.contains(concat!(
            "src=\"http://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/thumb-real%20image.png\"",
        )),
        "{html}",
    );
    assert!(
        html.contains(concat!(
            "href=\"https://scp-wiki.wikidot.com/local--files/",
            "component:wrapper/full-real%20image.png\"",
        )),
        "{html}",
    );
}

#[test]
fn expands_image_block_caption_with_external_link_without_stealing_its_bracket() {
    let mut wikitext = concat!(
        "[[include component:image-block ",
        "name=linked.jpg|caption=[https://example.com/path Linked label] by ",
        "[[*user Example User]]]]\n",
    )
    .to_owned();
    let page_info = fallback_test_page_info("author-page", "Author Page");

    RenderService::expand_wikidot_image_block_includes(&mut wikitext, &page_info, None);

    assert!(wikitext.contains("[https://example.com/path Linked label]"));
    assert!(wikitext.contains("[[*user Example User]]"));
    assert!(wikitext.ends_with("[[/div]]\n"), "{wikitext}");
    assert!(!wikitext.contains("[[/div]]]"), "{wikitext}");
}

#[test]
fn expands_included_fragment_wikidot_image_blocks_before_generic_includes() {
    let page_info = fallback_test_page_info("scp-8382", "SCP-8382");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut fragment_wikitext = concat!(
        "Before the block.\n",
        "[[include component:image-block\n",
        "  name=Alis.jpg|\n",
        "  caption=Photograph of PoI-6721-1 at Secure Area-219, 2023. |\n",
        "  width=225px|\n",
        "  align=left|\n",
        "]]\n",
        "After the block.\n",
    )
    .to_owned();

    let image_block_includes = RenderService::expand_wikidot_image_block_includes(
        &mut fragment_wikitext,
        &page_info,
        Some(("scp-wiki", "fragment:scp-8382-2")),
    );
    let top_wikitext = "[[include fragment:scp-8382-2]]\n";
    let (mut expanded, direct_included_pages) = ftml::include(
        top_wikitext,
        &settings,
        PreparedIncluder {
            pages: vec![Some(fragment_wikitext)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("prepared include should expand");

    ftml::preprocess_for_layout(&mut expanded, settings.layout);
    let tokens = ftml::tokenize(&expanded);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert_eq!(
        direct_included_pages,
        vec![PageRef::page_only("fragment:scp-8382-2")]
    );
    assert_eq!(
        image_block_includes,
        vec![
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
        ]
    );
    assert!(rendered.contains(
        r#"<img src="http://scp-wiki.wikidot.com/local--files/fragment:scp-8382-2/Alis.jpg""#
    ));
    assert!(rendered.contains("Photograph of PoI-6721-1 at Secure Area-219, 2023."));
    assert!(!rendered.contains("[[image"));
    assert!(!rendered.contains("{$alt}"));
    assert!(!rendered.contains("link=#"));
}

#[test]
fn leaves_image_block_includes_on_non_scp_wiki_sites_for_normal_expansion() {
    let mut wikitext = concat!(
        "[[include component:image-block name=custom.jpg|caption=Custom block.]]\n",
        "[[include :sandbox-for-codex:component:image-block name=custom.jpg]]\n",
    )
    .to_owned();
    let page_info = ftml::data::PageInfo {
        site: Cow::Borrowed("sandbox-for-codex"),
        page: Cow::Borrowed("start"),
        title: Cow::Borrowed("Sandbox"),
        alt_title: None,
        tags: Vec::new(),
        category: None,
        score: ftml::data::ScoreValue::Integer(0),
        language: Cow::Borrowed("en"),
    };

    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(included_pages.is_empty());
    assert!(wikitext.contains("[[include component:image-block name=custom.jpg"));
    assert!(wikitext.contains("[[include :sandbox-for-codex:component:image-block"));
}

#[test]
fn expands_dotted_site_image_block_includes_like_the_canonical_spelling() {
    let page_info = fallback_test_page_info("scp-3922", "SCP-3922");
    let mut dotted =
        "[[include :scp-wiki.wikidot.com:component:image-block name=dotted.jpg]]\n"
            .to_owned();
    let dotted_refs =
        RenderService::expand_wikidot_image_block_includes(&mut dotted, &page_info, None);
    let mut canonical =
        "[[include :scp-wiki:component:image-block name=dotted.jpg]]\n".to_owned();
    let canonical_refs = RenderService::expand_wikidot_image_block_includes(
        &mut canonical,
        &page_info,
        None,
    );
    assert_eq!(dotted, canonical);
    assert_eq!(
        dotted_refs,
        vec![
            PageRef::page_and_site("scp-wiki", "component:image-block"),
            PageRef::page_and_site("scp-wiki", "component:image-block-base"),
        ],
    );
    assert_eq!(dotted_refs, canonical_refs);
}

#[test]
fn dotted_image_block_include_refs_canonicalize_while_dashed_spellings_stay_distinct() {
    assert_eq!(
        RenderService::wikidot_image_block_page_ref(
            Some("scp-sandbox-3.wikidot.com"),
            "component:image-block",
        ),
        PageRef::page_and_site("scp-sandbox-3", "component:image-block"),
    );
    assert_eq!(
        RenderService::wikidot_image_block_page_ref(
            Some("scp-jp-wikidot-com"),
            "component:image-block",
        ),
        PageRef::page_and_site("scp-jp-wikidot-com", "component:image-block"),
    );
    let scp_wiki = fallback_test_page_info("scp-3922", "SCP-3922");
    assert!(RenderService::should_expand_wikidot_image_block_include(
        Some("scp-wiki.wikidot.com"),
        &scp_wiki,
    ));
    assert!(!RenderService::should_expand_wikidot_image_block_include(
        Some("scp-jp-wikidot-com"),
        &scp_wiki,
    ));
}

#[test]
fn leaves_literal_wikidot_image_block_includes_unexpanded() {
    let mut wikitext = concat!(
        "[[code]]\n",
        "[[include component:image-block name=code.jpg]]\n",
        "[[/code]]\n",
        "@@[[include component:image-block name=escaped.jpg]]@@\n",
        "[!-- [[include component:image-block name=comment.jpg]] --]\n",
        "[[include component:image-block name=live.jpg]]\n",
    )
    .to_owned();
    let page_info = fallback_test_page_info("scp-3922", "SCP-3922");

    let included_pages = RenderService::expand_wikidot_image_block_includes(
        &mut wikitext,
        &page_info,
        None,
    );

    assert!(wikitext.contains("[[include component:image-block name=code.jpg]]"));
    assert!(wikitext.contains("[[include component:image-block name=escaped.jpg]]"));
    assert!(wikitext.contains("[[include component:image-block name=comment.jpg]]"));
    assert!(wikitext.contains(
        "[[image http://scp-wiki.wikidot.com/local--files/scp-3922/live.jpg]]"
    ));
    assert_eq!(
        included_pages,
        vec![
            PageRef::page_only("component:image-block"),
            PageRef::page_only("component:image-block-base"),
        ],
    );
}

#[test]
fn skips_generic_includes_inside_wikidot_comments() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[!--\n",
        "Usage:\n",
        "[[include :scp-wiki:component:interwiki-style\n",
        "| priority=1\n",
        "]]\n",
        "--]\n",
        "[[include component:live]]\n",
    )
    .to_owned();

    RenderService::mask_wikidot_literal_include_markers(&mut wikitext);
    let mut includes = Vec::new();
    ftml::include(
        &wikitext,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("include collection should skip comment-hidden usage examples");
    RenderService::unmask_wikidot_literal_include_markers(&mut wikitext);

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_only("component:live")
    );
    assert!(wikitext.contains("[[include :scp-wiki:component:interwiki-style"));
}

#[test]
fn skips_generic_includes_inside_wikidot_literal_regions() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[[code]]\n",
        "[[include component:code-example]]\n",
        "[[/code]]\n",
        "[[span class=\"code-cell\"]] @@ [[include component:raw-example]] @@ [[/span]]\n",
        "[!-- [[include component:comment-example]] --]\n",
        "[[include component:live]]\n",
    )
    .to_owned();

    RenderService::mask_wikidot_literal_include_markers(&mut wikitext);
    let mut includes = Vec::new();
    ftml::include(
        &wikitext,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("include collection should skip literal usage examples");
    RenderService::unmask_wikidot_literal_include_markers(&mut wikitext);

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_only("component:live")
    );
    assert!(wikitext.contains("[[include component:code-example]]"));
    assert!(wikitext.contains("[[include component:raw-example]]"));
    assert!(wikitext.contains("[[include component:comment-example]]"));
}

#[test]
fn strips_included_comment_usage_examples_after_expansion() {
    let page_info = fallback_test_page_info("scp-anthology-2024", "SCP Anthology 2024");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut component_source = concat!(
        "[!--\n",
        "Usage:\n",
        "[[include :scp-wiki:component:interwiki-style\n",
        "| priority=1\n",
        "]]\n",
        "--]\n",
        "[[embed]]\n",
        "<iframe src=\"/-/wikidot-interwiki/styleFrame.html?priority=1\"></iframe>\n",
        "[[/embed]]\n",
    )
    .to_owned();

    RenderService::mask_wikidot_literal_include_markers(&mut component_source);
    let mut nested_includes = Vec::new();
    ftml::include(
        &component_source,
        &settings,
        CollectingIncluder {
            includes: &mut nested_includes,
            language: "en",
        },
        include_error,
    )
    .expect("comment usage examples should not request nested pages");
    RenderService::unmask_wikidot_literal_include_markers(&mut component_source);

    let (mut expanded, included_pages) = ftml::include(
        "[[include :scp-wiki:component:interwiki-style]]\n",
        &settings,
        PreparedIncluder {
            pages: vec![Some(component_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("prepared include should expand the component source");
    ftml::preprocess_for_layout(&mut expanded, settings.layout);
    let tokens = ftml::tokenize(&expanded);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, _) = result.into();
    let rendered = HtmlRender.render(&tree, &page_info, &settings).body;

    assert!(nested_includes.is_empty());
    assert_eq!(
        included_pages,
        vec![PageRef::page_and_site(
            "scp-wiki",
            "component:interwiki-style"
        )]
    );
    assert!(
        rendered.contains(
            "<iframe src=\"/-/wikidot-interwiki/styleFrame.html?priority=1\"></iframe>"
        ),
        "{rendered:?}",
    );
    assert!(!rendered.contains("Usage:"));
    assert!(!rendered.contains("[[include :scp-wiki:component:interwiki-style"));
}

#[test]
fn keeps_selected_comment_branch_includes_collectable() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut wikitext = concat!(
        "[!-- --]\n",
        "[[include component:selected]]\n",
        "[!----]\n",
        "[!-- {$inc-hidden}\n",
        "[[include component:hidden]]\n",
        "[!----]\n",
    )
    .to_owned();

    RenderService::mask_wikidot_literal_include_markers(&mut wikitext);
    let mut includes = Vec::new();
    ftml::include(
        &wikitext,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("include collection should keep selected branch includes");
    RenderService::unmask_wikidot_literal_include_markers(&mut wikitext);

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_only("component:selected")
    );
    assert!(wikitext.contains("[[include component:hidden]]"));
}

#[test]
fn collects_single_line_wikidot_include_variables() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut includes = Vec::new();
    ftml::include(
        "[[include :scp-wiki:theme:basalt | wide=a | hidetitle=a]]\n",
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("include collection should parse Wikidot single-line variables");

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_and_site("scp-wiki", "theme:basalt"),
    );
    assert_eq!(
        includes[0].variables().get("wide").map(Cow::as_ref),
        Some("a"),
    );
    assert_eq!(
        includes[0].variables().get("hidetitle").map(Cow::as_ref),
        Some("a"),
    );

    let mut multiline_includes = Vec::new();
    let mut multiline_include = concat!(
        "[[include :scp-jp:user-component:ta-badge\n",
        "|badge-top=gold-medal\n",
        "|badge-right=photographer\n",
        "|badge-left=high-calibre\n",
        "|frame=\n",
        "|bg-img=background-color: #fff\n",
        "|bg-shadow=false\n",
        "|plate=style2\n",
        "]]\n",
    )
    .to_owned();
    RenderService::normalize_wikidot_multiline_includes(&mut multiline_include);

    ftml::include(
        &multiline_include,
        &settings,
        CollectingIncluder {
            includes: &mut multiline_includes,
            language: "en",
        },
        include_error,
    )
    .expect("include collection should parse Wikidot multiline variables");

    assert_eq!(multiline_includes.len(), 1);
    assert_eq!(
        multiline_includes[0].page_ref(),
        &PageRef::page_and_site("scp-jp", "user-component:ta-badge"),
    );
    assert_eq!(
        multiline_includes[0]
            .variables()
            .get("bg-img")
            .map(Cow::as_ref),
        Some("background-color: #fff"),
    );
}

#[test]
fn normalizes_generic_wikidot_multiline_include_arguments() {
    let mut include = concat!(
        "[[include component:generic\n",
        "|first=one\n",
        "|second=two\n",
        "]]\n",
    )
    .to_owned();

    RenderService::normalize_wikidot_multiline_includes(&mut include);

    assert_eq!(
        include,
        "[[include component:generic |first=one |second=two]]\n"
    );
}

#[test]
fn multiline_include_variables_preserve_a_self_referential_class_prefix() {
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut include = concat!(
        "[[include :scp-wiki:component:earthworm\n",
        "| previous-url = scp-8380\n",
        "| previous-title = Aquaphobia\n",
        "| next-url = scp-8894\n",
        "| next-title = Basophobia\n",
        "| hub-url = scp-anthology-2024\n",
        "| hub-title = Anthology 2024\n",
        "| class = earthworm--anth24 {$class}\n",
        "]]\n",
    )
    .to_owned();
    RenderService::normalize_wikidot_multiline_includes(&mut include);

    let mut includes = Vec::new();
    ftml::include(
        &include,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("multiline include should parse");

    assert_eq!(includes.len(), 1);
    assert_eq!(
        includes[0].page_ref(),
        &PageRef::page_and_site("scp-wiki", "component:earthworm"),
    );
    assert_eq!(
        includes[0].variables().get("class").map(Cow::as_ref),
        Some("earthworm--anth24 {$class}"),
    );

    let mut source = r#"class="{$class}""#.to_owned();
    super::super::apply_include_variables(&mut source, &includes[0])
        .expect("self-referential class should remain within the byte budget");
    assert_eq!(source, r#"class="earthworm--anth24 {$class}""#);
}

#[test]
fn leaves_malformed_multiline_include_boundaries_untouched() {
    let mut include = concat!(
        "[[include component:generic\n",
        "not-an-argument\n",
        "]]\n",
        "[[include component:generic\n",
        "first=one|\n",
        "]]\n",
        "[[include component:image-block\n",
        "name=still-valid|\n",
        "not-an-argument|\n",
        "]]\n",
        "[[includex component:not-an-include\n",
        "|first=one\n",
        "]]\n",
    )
    .to_owned();
    let original = include.clone();

    RenderService::normalize_wikidot_multiline_includes(&mut include);

    assert_eq!(include, original);
}

#[test]
fn resolves_nested_wikidot_include_variables() {
    let include = IncludeRef::new(
        PageRef::page_and_site("scp-jp", "user-component:ta-badge-smooth-base-base"),
        VariableMap::from([
            (Cow::Borrowed("name"), Cow::Borrowed("action")),
            (Cow::Borrowed("action"), Cow::Borrowed("true")),
            (Cow::Borrowed("type"), Cow::Borrowed("false")),
        ]),
    );
    let mut source =
        r#"[[div_ class="badges badge-{$name} {$name} a{${$name}} b{$type}"]]"#
            .to_owned();

    super::super::apply_include_variables(&mut source, &include)
        .expect("nested variables should remain within the byte budget");

    assert!(source.contains(r#"class="badges badge-action action atrue bfalse""#));
    assert!(!source.contains("{$action}"));
}

#[test]
fn nested_include_argument_self_reference_uses_later_fallback() {
    let outer = IncludeRef::new(
        PageRef::page_and_site("scp-jp", "component:coltop"),
        VariableMap::from([
            (Cow::Borrowed("show"), Cow::Borrowed("+ New Messages: 1")),
            (Cow::Borrowed("nohide"), Cow::Borrowed("true")),
        ]),
    );
    let mut source = concat!(
        "[[include :scp-jp:component:coltop-deep\n",
        "ifprot={$ifprot}\n",
        "|ifprot=0\n",
        "|nohide={$nohide}\n",
        "|nohide=0\n",
        "|folded={$folded}\n",
        "|folded=1\n",
        "|show={$show}\n",
        "|show=+ show block\n",
        "]]",
    )
    .to_owned();
    super::super::apply_include_variables(&mut source, &outer)
        .expect("nested include arguments should remain within the byte budget");

    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut includes = Vec::new();
    ftml::include(
        &source,
        &settings,
        CollectingIncluder {
            includes: &mut includes,
            language: "en",
        },
        include_error,
    )
    .expect("nested include fallback should parse");

    assert_eq!(includes.len(), 1, "{source}");
    let variables = includes[0].variables();
    assert_eq!(
        variables.get("ifprot").map(|value| value.trim_end()),
        Some("0"),
    );
    assert_eq!(
        variables.get("nohide").map(|value| value.trim_end()),
        Some("true"),
    );
    assert_eq!(
        variables.get("folded").map(|value| value.trim_end()),
        Some("1"),
    );
    assert_eq!(
        variables.get("show").map(|value| value.trim_end()),
        Some("+ New Messages: 1"),
    );
}

#[test]
fn nested_cross_site_includes_keep_the_original_lookup_site() {
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let context = IncludeExpansionContext {
        current_site_id: 11,
        current_site_slug: "sandbox-for-codex".to_owned(),
        imported_source_site: None,
        attachment_owner: None,
        page_info: &page_info,
        settings: &settings,
        omit_iftags_branches: false,
        expand_wikidot_image_blocks: true,
        max_total_includes: 100,
        render_cost_budget: RenderCostBudget::new_default(),
        raw_zone: false,
    };
    let source = AuthorizedIncludeSource::for_test(
        "scp-wiki".to_owned(),
        "main".to_owned(),
        "[[include fragment:front-page-features]]".to_owned(),
        None,
    );

    let nested = context.for_nested_source(&source, false);

    assert_eq!(nested.current_site_id, 11);
    assert_eq!(nested.current_site_slug, "sandbox-for-codex");
    assert_eq!(nested.imported_source_site, None);
    assert_eq!(
        nested.attachment_owner,
        Some(AttachmentOwner {
            site_slug: "scp-wiki".to_owned(),
            page_slug: "main".to_owned(),
        }),
    );
}

#[test]
fn nested_imported_source_includes_carry_the_source_site() {
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let context = IncludeExpansionContext {
        current_site_id: 11,
        current_site_slug: "scp-wiki".to_owned(),
        imported_source_site: None,
        attachment_owner: None,
        page_info: &page_info,
        settings: &settings,
        omit_iftags_branches: false,
        expand_wikidot_image_blocks: true,
        max_total_includes: 100,
        render_cost_budget: RenderCostBudget::new_default(),
        raw_zone: false,
    };
    let source = AuthorizedIncludeSource::for_test(
        "scp-wiki".to_owned(),
        "workbench-siddo".to_owned(),
        "[[include component:avviso-iscriviti]]".to_owned(),
        Some("fondazionescp".to_owned()),
    );

    let nested = context.for_nested_source(&source, false);

    assert_eq!(nested.current_site_id, 11);
    assert_eq!(nested.current_site_slug, "scp-wiki");
    assert_eq!(
        nested.imported_source_site.as_deref(),
        Some("fondazionescp")
    );
}

#[test]
fn include_variable_rebuild_handles_adjacent_growth_shrink_and_same_length() {
    let include = IncludeRef::new(
        PageRef::page_only("component:test"),
        VariableMap::from([
            (Cow::Borrowed("grow"), Cow::Borrowed("expanded")),
            (Cow::Borrowed("shrink"), Cow::Borrowed("")),
            (Cow::Borrowed("same"), Cow::Borrowed("same123")),
        ]),
    );
    let mut source = "before{$grow}{$shrink}{$same}after".to_owned();

    super::super::apply_include_variables(&mut source, &include)
        .expect("adjacent variables should remain within the byte budget");

    assert_eq!(source, "beforeexpandedsame123after");
}

#[test]
fn include_variable_rebuild_preserves_unresolved_and_self_references_with_defaults() {
    let include = IncludeRef::new(
        PageRef::page_only("component:test"),
        VariableMap::from([
            (Cow::Borrowed("self"), Cow::Borrowed("{$self}")),
            (Cow::Borrowed("trimmed"), Cow::Borrowed("value \t\r\n")),
        ]),
    );
    let mut source = "{$author}|{$missing}|{$shadow}|{$self}|{$trimmed}".to_owned();

    super::super::apply_include_variables(&mut source, &include)
        .expect("unresolved and self-referential variables should remain bounded");

    assert_eq!(source, "%%created_by%%|{$missing}|no|{$self}|value");
}

#[test]
fn include_variable_rebuild_does_not_repeat_a_self_referential_prefix() {
    let include = IncludeRef::new(
        PageRef::page_only("component:earthworm"),
        VariableMap::from([(
            Cow::Borrowed("class"),
            Cow::Borrowed("earthworm--anth24 {$class}"),
        )]),
    );
    let mut source = r#"class="{$class}""#.to_owned();

    super::super::apply_include_variables(&mut source, &include)
        .expect("self-referential prefix should remain bounded");

    assert_eq!(source, r#"class="earthworm--anth24 {$class}""#);
}

#[test]
fn include_variable_rebuild_stops_at_the_variable_pass_limit() {
    let variables = (0..=super::super::MAX_INCLUDE_VARIABLE_PASSES)
        .map(|depth| {
            (
                Cow::Owned(format!("v{depth}")),
                Cow::Owned(format!("{{$v{}}}", depth + 1)),
            )
        })
        .collect();
    let include = IncludeRef::new(PageRef::page_only("component:test"), variables);
    let mut source = "{$v0}".to_owned();

    super::super::apply_include_variables(&mut source, &include)
        .expect("the existing variable pass limit should remain bounded");

    assert_eq!(
        source,
        format!("{{$v{}}}", super::super::MAX_INCLUDE_VARIABLE_PASSES),
    );
}

#[test]
fn include_variable_rebuild_matches_reverse_replacement_output() {
    fn apply_reverse_replacement_reference(
        content: &mut String,
        include: &IncludeRef<'_>,
    ) {
        for _ in 0..super::super::MAX_INCLUDE_VARIABLE_PASSES {
            let mut matches = Vec::new();

            for capture in super::super::INCLUDE_VARIABLE_REGEX.captures_iter(content) {
                let mtch = capture.get(0).unwrap();
                let name = &capture["name"];
                if let Some(value) = include
                    .variables()
                    .get(name)
                    .map(|value| {
                        super::super::trim_include_variable_value(value).to_owned()
                    })
                    .or_else(|| super::super::default_include_variable_value(name))
                {
                    let changed = value != mtch.as_str();
                    matches.push((value, mtch.range(), changed));
                }
            }

            if matches.is_empty() {
                break;
            }

            let changed = matches.iter().any(|(_, _, changed)| *changed);
            matches.reverse();
            for (value, range, _) in matches {
                content.replace_range(range, &value);
            }
            if !changed {
                break;
            }
        }
    }

    let cases = [
        (
            "A{$grow}{$shrink}{$same}Z",
            vec![("grow", "expanded"), ("shrink", "x"), ("same", "same123")],
        ),
        (
            "{$missing}|{$author}|{$shadow}|{$self}",
            vec![("self", "{$self}")],
        ),
        (
            "{$outer}",
            vec![("outer", "pre{$inner}post"), ("inner", "done")],
        ),
        (
            "{$left}{$right}",
            vec![("left", "{$right}"), ("right", "{$left}")],
        ),
    ];

    for (source, variables) in cases {
        let include = IncludeRef::new(
            PageRef::page_only("component:test"),
            variables
                .into_iter()
                .map(|(name, value)| {
                    (Cow::Owned(name.to_owned()), Cow::Owned(value.to_owned()))
                })
                .collect(),
        );
        let mut expected = source.to_owned();
        let mut actual = source.to_owned();

        apply_reverse_replacement_reference(&mut expected, &include);
        super::super::apply_include_variables(&mut actual, &include)
            .expect("reference cases should remain within the byte budget");

        assert_eq!(actual, expected, "source: {source}");
    }
}

#[test]
fn included_dynamic_iftags_substitutes_directive_and_spec_before_matching() {
    let source = "[[ift{$mode}gs +{$required_tag}]]selected[[/ift{$mode}gs]]";

    assert_eq!(
        resolve_test_included_variable_iftags(
            source,
            &[("mode", "a"), ("required_tag", "theme")],
            &["theme"],
        ),
        "selected",
    );
}

#[test]
fn included_dynamic_iftags_drops_body_when_substituted_spec_does_not_match() {
    let source = "[[ift{$mode}gs +{$required_tag}]]selected[[/ift{$mode}gs]]";

    assert_eq!(
        resolve_test_included_variable_iftags(
            source,
            &[("mode", "a"), ("required_tag", "theme")],
            &["other"],
        ),
        "",
    );
    assert_eq!(
        resolve_test_included_variable_iftags(source, &[("mode", "a")], &["theme"],),
        "",
    );
}

#[test]
fn included_dynamic_iftags_keeps_absent_mode_transparent() {
    let source = "before[[ift{$mode}gs +{$required_tag}]]selected[[/ift{$mode}gs]]after";

    assert_eq!(
        resolve_test_included_variable_iftags(source, &[("required_tag", "theme")], &[],),
        "beforeselectedafter",
    );
}

#[test]
fn nested_include_preparation_preserves_callsite_dynamic_iftags_outcomes() {
    let source = "before[[ift{$mode}gs +theme]]selected[[/ift{$mode}gs]]after";

    assert_eq!(
        prepare_test_nested_include_conditionals(source, &[("mode", "a")], &["theme"]),
        "beforeselectedafter",
    );
    assert_eq!(
        prepare_test_nested_include_conditionals(source, &[], &[]),
        "beforeselectedafter",
    );
    assert_eq!(
        prepare_test_nested_include_conditionals(source, &[("mode", "other")], &[]),
        "before[[iftothergs +theme]]selected[[/iftothergs]]after",
    );

    let malformed = "before[[ift{$mode}gs +theme]]selected[[/ift{$other}gs]]after";
    assert_eq!(
        prepare_test_nested_include_conditionals(malformed, &[], &[]),
        malformed,
    );
}

#[test]
fn nested_include_preparation_prunes_comment_branches_before_iftags() {
    let source = concat!(
        "[[iftags -component-backend]]\n",
        "[!-- {$inc-source}\n",
        "[[module css]]source[[/module]]\n",
        "[!----]\n",
        "[!-- {$inc-colors}\n",
        "[[module css]]colors[[/module]]\n",
        "[!----]\n",
        "[!-- {$inc-section-start}\n",
        "[[div class=\"section\"]]\n",
        "[!----]\n",
        "[!-- {$inc-section-end}\n",
        "[[/div]]\n",
        "[!----]\n",
        "[[/iftags]]\n",
        "[[iftags +component-backend]]documentation[[/iftags]]\n",
    );

    let source_fragment =
        prepare_test_nested_include_conditionals(source, &[("inc-source", "--]")], &[]);
    let start_fragment = prepare_test_nested_include_conditionals(
        source,
        &[("inc-section-start", "--]")],
        &[],
    );
    let end_fragment = prepare_test_nested_include_conditionals(
        source,
        &[("inc-section-end", "--]")],
        &[],
    );
    let assembled = format!("{source_fragment}{start_fragment}body\n{end_fragment}");

    assert!(source_fragment.contains("source"), "{source_fragment}");
    assert!(start_fragment.contains("[[div class=\"section\"]]"));
    assert!(end_fragment.contains("[[/div]]"));
    assert!(!assembled.contains("colors"), "{assembled}");
    assert!(!assembled.contains("documentation"), "{assembled}");
    assert!(!assembled.contains("{$"), "{assembled}");
    assert!(!assembled.contains("[!--"), "{assembled}");
    assert!(!assembled.contains("[[iftags"), "{assembled}");
    assert!(!assembled.contains("[[/iftags]]"), "{assembled}");
}

#[test]
fn include_source_preparation_preserves_unbounded_malformed_comment_branch() {
    let original = concat!(
        "before\n",
        "[!-- {$inc-section-end}\n",
        "[[/div]]\n",
        "after\n",
    );
    let include =
        IncludeRef::new(PageRef::page_only("component:test"), VariableMap::new());
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let mut source = original.to_owned();
    let mut compat_text = CompatTextFragments::new(original);

    super::super::prepare_include_source_variables_and_comment_branches(
        &mut source,
        &include,
        &page_info,
        &mut compat_text,
    )
    .expect("malformed branch source should remain within the byte budget");

    assert_ne!(source, original);
    assert!(!source.contains("[!-- {$inc-section-end"), "{source}");
    assert_eq!(compat_text.restore(&source), original);
}

#[test]
fn malformed_include_comment_branch_cannot_claim_sibling_boundary() {
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let malformed = concat!(
        "CHILD_BEFORE\n",
        "[!-- {$missing}\n",
        "CHILD_HIDDEN\n",
        "[[include component:must-not-expand]]\n",
    );
    let include = IncludeRef::new(
        PageRef::page_only("component:malformed"),
        VariableMap::new(),
    );
    let mut compat_text = CompatTextFragments::new(malformed);
    let mut malformed = malformed.to_owned();
    super::super::prepare_include_source_variables_and_comment_branches(
        &mut malformed,
        &include,
        &page_info,
        &mut compat_text,
    )
    .expect("malformed branch source should remain within the byte budget");
    let start = prepare_test_nested_include_conditionals(
        concat!(
            "[[iftags -component-backend]]\n",
            "[!-- {$start}\n",
            "[[div class=\"selected-sibling\"]]\n",
            "[!----]\n",
            "[!-- {$end}\n",
            "[[/div]]\n",
            "[!----]\n",
            "[[/iftags]]\n",
        ),
        &[("start", "--]")],
        &[],
    );
    let end = prepare_test_nested_include_conditionals(
        concat!(
            "[[iftags -component-backend]]\n",
            "[!-- {$start}\n",
            "[[div class=\"selected-sibling\"]]\n",
            "[!----]\n",
            "[!-- {$end}\n",
            "[[/div]]\n",
            "[!----]\n",
            "[[/iftags]]\n",
        ),
        &[("end", "--]")],
        &[],
    );
    let caller = concat!(
        "[[include component:start]]\n",
        "[[include component:malformed]]\n",
        "[[include component:end]]\n",
        "ROOT_BEFORE\n",
        "[!----]\n",
        "ROOT_AFTER\n",
    );
    let (mut expanded, _) = ftml::include(
        caller,
        &settings,
        PreparedIncluder {
            pages: vec![Some(start), Some(malformed), Some(end)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("prepared sibling includes should expand");

    super::super::remove_unresolved_include_comment_branches(&mut expanded);
    assert!(expanded.contains("CHILD_BEFORE\n"), "{expanded}");
    assert!(!expanded.contains("CHILD_HIDDEN"), "{expanded}");
    assert!(!expanded.contains("must-not-expand"), "{expanded}");
    assert!(expanded.contains("ROOT_BEFORE\n"), "{expanded}");
    assert!(expanded.contains("ROOT_AFTER\n"), "{expanded}");
    assert!(expanded.contains("[[div class=\"selected-sibling\"]]"));
    assert!(expanded.contains("[[/div]]"));

    ftml::preprocess_for_layout(&mut expanded, settings.layout);
    let tokens = ftml::tokenize(&expanded);
    let result = ftml::parse(&tokens, &page_info, &settings);
    let (tree, errors) = result.into();
    assert!(errors.is_empty(), "{errors:?}\n{expanded}");
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    let html = compat_text.restore(&html);

    assert!(html.contains("[!-- {$missing}"), "{html}");
    assert!(html.contains("CHILD_BEFORE"), "{html}");
    assert!(html.contains("CHILD_HIDDEN"), "{html}");
    assert!(html.contains("component:must-not-expand"), "{html}");
    assert!(html.contains("ROOT_BEFORE"), "{html}");
    assert!(html.contains("ROOT_AFTER"), "{html}");
    assert!(html.contains("selected-sibling"), "{html}");
}

#[test]
fn nested_include_preparation_skips_repeated_unbound_dynamic_iftags_resolution() {
    let page_info = fallback_test_page_info("consumer", "Consumer");
    let mut source =
        "before[[ift{$mode}gs +theme]]selected[[/ift{$mode}gs]]after".to_owned();
    let expected = source.clone();
    let mut preserved = CompatTextFragments::new(&source);

    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        1,
    );
    source = preserved.restore(&source);

    assert_eq!(source, expected);
}

#[test]
fn comment_branch_closer_does_not_swallow_a_following_iftags_gate() {
    let source = concat!(
        "[!-- -{$flag}\n",
        "[[module CSS]]\n",
        ".hidden { color: red; }\n",
        "[[/module]]\n",
        "[!-- --]\n",
        "[[iftags +component]]\n",
        "DOCS-SHOULD-HIDE\n",
        "[[module Rate]]\n",
        "[[module CSS]]\n",
        ".x { color: red; }\n",
        "[[/module]]\n",
        "[[/iftags]]\n",
        "AFTER-MARK",
    );
    for (tags, shown) in [(&[][..], false), (&["component"][..], true)] {
        let prepared =
            prepare_test_nested_include_conditionals(source, &[("flag", "")], tags);
        assert!(!prepared.contains("iftags"), "tags {tags:?}: {prepared}");
        assert_eq!(
            prepared.contains("DOCS-SHOULD-HIDE"),
            shown,
            "tags {tags:?}: {prepared}"
        );
        assert!(prepared.contains("AFTER-MARK"), "tags {tags:?}: {prepared}");
    }
}

#[test]
fn wikidot_image_block_include_with_unterminated_quote_cannot_swallow_enclosing_block() {
    let mut wikitext = concat!(
        "[[collapsible show=\"Open\" hide=\"Close\"]]\n",
        "[[include component:image-block name=https://scp-wiki.wikidot.com/local--files/hub-page/pic.webp|align=center|link=\"https://scp-wiki.wikidot.com/local--files/hub-page/pic.webp|width=100%|caption=A sketch by [[*user Artist]] ]]\n",
        "[[/collapsible]]\n",
        "[[[some-page|A Label \"Quoted\" title]]]\n",
    )
    .to_owned();

    let page_info = fallback_test_page_info("hub-page", "Hub Page");
    RenderService::expand_wikidot_image_block_includes(&mut wikitext, &page_info, None);

    assert!(
        wikitext
            .contains("[[include component:image-block name=https://scp-wiki.wikidot.com/local--files/hub-page/pic.webp"),
        "{wikitext}"
    );
    assert!(wikitext.contains("\n[[/collapsible]]\n"), "{wikitext}");
    assert!(
        wikitext.contains("[[[some-page|A Label \"Quoted\" title]]]"),
        "{wikitext}"
    );
    assert!(!wikitext.contains("scp-image-caption"), "{wikitext}");
}

#[test]
fn included_interwiki_style_embed_survives_production_preparation() {
    let page_info = fallback_test_page_info("scp-anthology-2024", "SCP Anthology 2024");
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let component_source = concat!(
        "[!--\n",
        "Usage:\n",
        "[[include :scp-wiki:component:interwiki-style\n",
        "| priority=1\n",
        "]]\n",
        "--]\n",
        "[[embed]]\n",
        "<iframe src=\"//interwiki.scpwiki.com/styleFrame.html?priority=1\" style=\"display: none\"></iframe>\n",
        "[[/embed]]\n",
    )
    .to_owned();

    let (expanded, included_pages) = ftml::include(
        "[[include :scp-wiki:component:interwiki-style]]\n",
        &settings,
        PreparedIncluder {
            pages: vec![Some(component_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("prepared include should expand the component source");
    assert_eq!(
        included_pages,
        vec![PageRef::page_and_site(
            "scp-wiki",
            "component:interwiki-style"
        )]
    );

    let outer = RenderService::prepare_outer_render_wikitext(
        super::super::ExpandedRenderWikitext {
            theme_previewer_blank: false,
            wikidot_compat_html: CompatHtmlFragments::new(&expanded),
            wikidot_compat_text: CompatTextFragments::new(&expanded),
            wikitext: expanded,
            included_pages: Vec::new(),
            expanded_include_count: 0,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );
    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    assert_eq!(inner.wikidot_embed_iframes.len(), 1);
    assert!(
        inner.wikidot_embed_iframes[0]
            .contains("src=\"/-/wikidot-interwiki/styleFrame.html?priority=1\""),
        "{:?}",
        inner.wikidot_embed_iframes,
    );
    assert!(!inner.wikitext.contains("[[embed]]"), "{}", inner.wikitext);

    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, _) = ftml::parse(&tokens, &page_info, &settings).into();
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    let html = RenderService::restore_protected_wikidot_embed_iframes(
        html,
        &inner.wikidot_embed_iframes,
    );
    let html = inner.protection.restore(|protection| {
        let html = protection.compat_html().restore(&html);
        protection.compat_text().restore(&html)
    });

    assert!(
        html.contains(
            "<iframe src=\"/-/wikidot-interwiki/styleFrame.html?priority=1\" style=\"display: none\"></iframe>"
        ),
        "{html}",
    );
    assert!(!html.contains("Usage:"), "{html}");
    assert!(!html.contains("[[include"), "{html}");
    assert!(!html.contains("error-block"), "{html}");
}

#[test]
fn include_enclosure_flags_mark_includes_directly_inside_active_enclosed_gates() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let mut source = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:feature-and-news]]\n",
        "[[/iftags]]\n",
        "[[include component:other]]\n",
    )
    .to_string();
    let mut preserved = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        0,
    );

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:feature-and-news", "component:other"]),
        0,
        false,
    );

    assert_eq!(flags, vec![true, false]);
}

#[test]
fn include_enclosure_flags_stay_false_when_the_outer_gate_is_inactive() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("管理")];
    let mut source = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:feature-and-news]]\n",
        "[[/iftags]]\n",
        "[[include component:other]]\n",
    )
    .to_string();
    let mut preserved = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        0,
    );

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:other"]),
        0,
        false,
    );

    assert_eq!(flags, vec![false]);
}

#[test]
fn include_enclosure_flags_fall_back_to_false_on_directive_count_mismatch() {
    let source = "[[include component:other]]\n".to_string();

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:other", "component:other"]),
        0,
        false,
    );

    assert_eq!(flags, vec![false, false]);
}

#[test]
fn include_enclosure_flags_propagate_raw_zone_at_any_depth() {
    let source = "[[include component:other]]\n".to_string();

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:other"]),
        3,
        true,
    );

    assert_eq!(flags, vec![true]);
}

#[test]
fn raw_zone_include_preparation_preserves_ordinary_iftags_as_literal_text() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let component = "[[iftags +管理 -ハブ]]\nstaff area\n[[/iftags]]";
    let mut source = component.to_string();
    let mut preserved = CompatTextFragments::new(&source);

    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut source,
        &page_info,
        &mut preserved,
        true,
    );

    assert!(!source.contains("[[iftags"), "{source}");
    assert!(!source.contains("[[/iftags]]"), "{source}");
    let restored = preserved.restore(&source);
    assert!(restored.contains("[[iftags +管理 -ハブ]]"), "{restored}");
    assert!(restored.contains("staff area"), "{restored}");
    assert!(restored.contains("[[/iftags]]"), "{restored}");
}

#[test]
fn ordinary_include_preparation_still_evaluates_ordinary_iftags() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("管理")];
    let component = "[[iftags +管理 -ハブ]]\nstaff area\n[[/iftags]]";
    let mut source = component.to_string();
    let mut preserved = CompatTextFragments::new(&source);

    RenderService::prepare_wikidot_conditionals_for_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
    );

    let restored = preserved.restore(&source);
    assert!(restored.contains("staff area"), "{restored}");
    assert!(!restored.contains("[[iftags"), "{restored}");
}

#[test]
fn ordinary_include_preparation_drops_nonmatching_ordinary_iftags() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let component = "[[iftags +管理 -ハブ]]\nstaff area\n[[/iftags]]";
    let mut source = component.to_string();
    let mut preserved = CompatTextFragments::new(&source);

    RenderService::prepare_wikidot_conditionals_for_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
    );

    let restored = preserved.restore(&source);
    assert!(!restored.contains("staff area"), "{restored}");
}

#[test]
fn enclosed_iftags_markers_are_removed_from_the_expanded_output() {
    let (open, end) = (
        super::super::super::iftags::ENCLOSED_IFTAGS_OPEN,
        super::super::super::iftags::ENCLOSED_IFTAGS_END,
    );
    let mut source = format!("before {open}\nincluded body\n{end} after");

    super::super::super::iftags::remove_enclosed_iftags_markers(&mut source);

    assert_eq!(source, "before \nincluded body\n after");
}

fn render_pre_expanded_wikidot_page_body(
    wikitext: String,
    wikidot_compat_text: CompatTextFragments,
    tags: &[&'static str],
) -> String {
    let mut page_info = fallback_test_page_info("theme:af2026theme", "AF2026テーマ");
    page_info.tags = tags.iter().map(|&tag| Cow::Borrowed(tag)).collect();
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let outer = RenderService::prepare_outer_render_wikitext(
        super::super::ExpandedRenderWikitext {
            theme_previewer_blank: false,
            wikidot_compat_html: CompatHtmlFragments::new(&wikitext),
            wikidot_compat_text,
            wikitext,
            included_pages: Vec::new(),
            expanded_include_count: 1,
            url_offset_list_pages_content_bytes: 0,
            runtime_css_insertions: Vec::new(),
        },
        &page_info,
        &settings,
    );
    let inner = RenderService::prepare_inner_render_wikitext(outer, &settings);
    let tokens = ftml::tokenize(&inner.wikitext);
    let (tree, _errors) = ftml::parse(&tokens, &page_info, &settings).into();
    let html = HtmlRender.render(&tree, &page_info, &settings).body;
    let html = inner
        .protection
        .restore(|protection| protection.compat_text().restore(&html));
    RenderService::restore_wikidot_render_compatibility_for_context_with_resources(
        &html,
        None,
        &Config::integration_testing(),
        true,
        &[],
    )
}

fn enclosure_test_includes(targets: &[&str]) -> Vec<IncludeRef<'static>> {
    targets
        .iter()
        .map(|target| {
            IncludeRef::new(
                PageRef::parse_include(target).expect("test include target should parse"),
                Default::default(),
            )
        })
        .collect()
}

fn expand_test_enclosed_include(
    root: &str,
    component: &str,
    tags: &[&'static str],
) -> (String, CompatTextFragments) {
    let mut page_info = fallback_test_page_info("theme:af2026theme", "AF2026テーマ");
    page_info.tags = tags.iter().map(|&tag| Cow::Borrowed(tag)).collect();
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);

    let mut source = root.to_string();
    let mut compat_text = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut compat_text,
        0,
    );
    let mut collected = Vec::new();
    ftml::include(
        &source,
        &settings,
        super::super::CollectingIncluder {
            includes: &mut collected,
            language: "en",
        },
        include_error,
    )
    .expect("test include collection should succeed");
    let flags = super::super::include_enclosure_flags(&source, &collected, 0, false);

    let mut nested_source = component.to_string();
    if flags[0] {
        RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
            &mut nested_source,
            &page_info,
            &mut compat_text,
            true,
        );
    } else {
        RenderService::prepare_wikidot_conditionals_for_include_expansion(
            &mut nested_source,
            &page_info,
            &mut compat_text,
        );
    }

    let expanded = ftml::include(
        &source,
        &settings,
        PreparedIncluder {
            pages: vec![Some(nested_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("test include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    (expanded, compat_text)
}

#[test]
fn include_gate_nested_in_an_active_outer_gate_prints_literally_after_expansion() {
    let component = "[[iftags +管理 -ハブ]]\n+ スタッフ各位\n[[/iftags]]\n";
    let root = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:feature-and-news]]\n",
        "[[/iftags]]\n",
    );

    let (expanded, compat_text) =
        expand_test_enclosed_include(root, component, &["テーマ"]);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(html.contains("[[iftags +管理 -ハブ]]"), "{html}");
    assert!(html.contains("[[/iftags]]"), "{html}");
    assert!(html.contains("スタッフ各位"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

#[test]
fn include_gate_is_evaluated_when_the_include_is_outside_any_gate() {
    let component = "[[iftags +管理 -ハブ]]\n+ スタッフ各位\n[[/iftags]]\n";
    let root = "[[include component:feature-and-news]]\n";

    let (expanded, compat_text) =
        expand_test_enclosed_include(root, component, &["テーマ"]);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(
        !html.contains("スタッフ各位"),
        "the nested gate must be evaluated: {html}"
    );
}

#[test]
fn include_enclosure_flags_mark_includes_inside_active_enclosed_gates_at_depth() {
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let mut source = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:feature-and-news]]\n",
        "[[/iftags]]\n",
        "[[include component:other]]\n",
    )
    .to_string();
    let mut preserved = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        1,
    );

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:feature-and-news", "component:other"]),
        1,
        false,
    );

    assert_eq!(flags, vec![true, false]);
}

#[test]
fn include_gate_inside_an_included_pages_active_gate_prints_literally_after_expansion() {
    // Sample page (tags: テーマ) includes a theme page; the theme page includes
    // a gated component twice: once outside its own +テーマ gate and once
    // inside it. Only the inside copy's documentation survives, with the
    // component's gate markers printed literally (theme:shancheng-jp shape).
    let mut page_info = fallback_test_page_info("sample", "Sample");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut compat_text = CompatTextFragments::new("");

    let component = "[[iftags +component]]\nmeta component docs\n[[/iftags]]\n";
    let theme = concat!(
        "[[include component:sigma-plus]]\n",
        "[[iftags +テーマ]]\n",
        "[[include component:sigma-plus]]\n",
        "[[/iftags]]\n",
    );

    let mut theme_source = theme.to_string();
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut theme_source,
        &page_info,
        &mut compat_text,
        1,
    );
    let flags = super::super::include_enclosure_flags(
        &theme_source,
        &enclosure_test_includes(&["component:sigma-plus", "component:sigma-plus"]),
        1,
        false,
    );
    assert_eq!(flags, vec![false, true]);

    // The copy outside the gate is evaluated against the sample's tags and
    // dropped; the copy inside the gate is a raw zone and preserved literally.
    let mut outside = component.to_string();
    RenderService::prepare_wikidot_conditionals_for_include_expansion(
        &mut outside,
        &page_info,
        &mut compat_text,
    );
    let mut inside = component.to_string();
    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut inside,
        &page_info,
        &mut compat_text,
        true,
    );

    let expanded = ftml::include(
        &theme_source,
        &settings,
        PreparedIncluder {
            pages: vec![Some(outside), Some(inside)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("theme include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(html.contains("meta component docs"), "{html}");
    assert_eq!(html.matches("meta component docs").count(), 1, "{html}");
    assert!(html.contains("[[iftags +component]]"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}
#[test]
fn include_gate_raw_zone_covers_bare_gate_and_following_gate_in_wrapped_page() {
    // Sample page (tags: テーマ) includes a theme page; the theme's kept
    // +テーマ gate includes a wrapper component whose first construct is a
    // BARE gate wrapping an include of a gated theme page, followed by the
    // wrapper's own documentation gate. Live Wikidot renders the whole
    // wrapper unit as a raw exhibit: every gate marker prints literally and
    // every body renders (theme:highlighter-bhl-jp including
    // component:betterfootnotes; probe
    // muse-probe-exhibit-gates-top-beta-gatedwrap).
    let mut page_info = fallback_test_page_info("sample", "Sample");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut compat_text = CompatTextFragments::new("");

    let inner = "[[iftags +テーマ -nobhl]]\nbhl theme docs\n[[/iftags]]\n";
    let wrapper = concat!(
        "[[iftags]]\n",
        "[[include theme:black-highlighter-theme]]\n",
        "[[/iftags]]\n",
        "[[iftags +コンポーネント]]\n",
        "better footnotes docs\n",
        "[[/iftags]]\n",
    );
    let theme = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:betterfootnotes]]\n",
        "[[/iftags]]\n",
    );

    // The theme page is prepared at depth 1; its kept gate body carries the
    // wrapper include, so the include is enclosed (raw zone).
    let mut theme_source = theme.to_string();
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut theme_source,
        &page_info,
        &mut compat_text,
        1,
    );
    let flags = super::super::include_enclosure_flags(
        &theme_source,
        &enclosure_test_includes(&["component:betterfootnotes"]),
        1,
        false,
    );
    assert_eq!(flags, vec![true]);

    // The gated theme page inside the wrapper's bare gate is prepared in raw
    // (preserve) mode, then spliced into the wrapper.
    let mut inner_source = inner.to_string();
    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut inner_source,
        &page_info,
        &mut compat_text,
        true,
    );
    let wrapper_expanded = ftml::include(
        wrapper,
        &settings,
        PreparedIncluder {
            pages: vec![Some(inner_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("wrapper include should expand")
    .0;

    // The joined wrapper unit is preserved as a whole: its own gate markers
    // (the bare gate and the documentation gate) print literally too.
    let mut wrapper_source = wrapper_expanded;
    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut wrapper_source,
        &page_info,
        &mut compat_text,
        true,
    );

    let expanded = ftml::include(
        &theme_source,
        &settings,
        PreparedIncluder {
            pages: vec![Some(wrapper_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("theme include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(html.contains("[[iftags]]"), "{html}");
    assert!(html.contains("[[iftags +テーマ -nobhl]]"), "{html}");
    assert!(html.contains("[[iftags +コンポーネント]]"), "{html}");
    assert_eq!(html.matches("[[/iftags]]").count(), 3, "{html}");
    assert!(html.contains("bhl theme docs"), "{html}");
    assert!(html.contains("better footnotes docs"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

#[test]
fn include_inside_a_bare_gate_is_never_expanded_in_evaluated_context() {
    // A bare [[iftags]] never matches on live Wikidot (probe
    // muse-probe-exhibit-gates-top-beta-wrap): in evaluated context its body
    // is dropped, so an include inside it never expands, while a sibling
    // gate in the same included page still resolves against the top page's
    // tags.
    let mut page_info = fallback_test_page_info("sample", "Sample");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let mut compat_text = CompatTextFragments::new("");

    let wrapper = concat!(
        "[[iftags]]\n",
        "[[include component:inner]]\n",
        "[[/iftags]]\n",
        "[[iftags +テーマ]]\n",
        "wrapper docs\n",
        "[[/iftags]]\n",
    );

    let mut wrapper_source = wrapper.to_string();
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut wrapper_source,
        &page_info,
        &mut compat_text,
        1,
    );

    // The bare gate body is gone, taking the include directive with it.
    assert!(!wrapper_source.contains("[[include"), "{wrapper_source}");

    let html =
        render_pre_expanded_wikidot_page_body(wrapper_source, compat_text, &["テーマ"]);
    assert!(html.contains("wrapper docs"), "{html}");
    assert!(!html.contains("[[iftags"), "{html}");
}

#[test]
fn include_gate_pair_inside_an_included_pages_active_gate_prints_literally() {
    // theme:yore-jp shape: the theme (depth 1) includes a component inside
    // its kept +テーマ gate; the component carries two gates over the same
    // tag, one negative and one positive. Live Wikidot prints both gates
    // literally with both bodies rendered (the anomaly-class-bar pair on
    // the yore sample); evaluating them against the sample's tags would
    // drop the positive gate's body instead.
    let mut page_info = fallback_test_page_info("sample", "Sample");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut compat_text = CompatTextFragments::new("");

    let component = concat!(
        "[[iftags -コンポーネント・バックエンド]]\n",
        "acs backend body\n",
        "[[/iftags]]\n",
        "[[iftags +コンポーネント・バックエンド]]\n",
        "acs source body\n",
        "[[/iftags]]\n",
    );
    let theme = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:anomaly-class-bar-source]]\n",
        "[[/iftags]]\n",
    );

    let mut theme_source = theme.to_string();
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut theme_source,
        &page_info,
        &mut compat_text,
        1,
    );
    let flags = super::super::include_enclosure_flags(
        &theme_source,
        &enclosure_test_includes(&["component:anomaly-class-bar-source"]),
        1,
        false,
    );
    assert_eq!(flags, vec![true]);

    let mut component_source = component.to_string();
    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut component_source,
        &page_info,
        &mut compat_text,
        true,
    );

    let expanded = ftml::include(
        &theme_source,
        &settings,
        PreparedIncluder {
            pages: vec![Some(component_source)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("theme include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(
        html.contains("[[iftags -コンポーネント・バックエンド]]"),
        "{html}"
    );
    assert!(
        html.contains("[[iftags +コンポーネント・バックエンド]]"),
        "{html}"
    );
    assert_eq!(html.matches("[[/iftags]]").count(), 2, "{html}");
    assert!(html.contains("acs backend body"), "{html}");
    assert!(html.contains("acs source body"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

#[test]
fn generated_spec_iftags_resolve_at_include_depth() {
    // A generated-spec gate ([[iftags [[#ifexpr ...]]]]) must be prepared the
    // same way at every include depth: the parser function is resolved first,
    // then the resulting spec is matched against the page tags. While the
    // preparation was depth-0-only, an included page's generated gates were
    // matched against the literal ifexpr text and always dropped.
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];

    let prepare = |source: &str, depth: usize| {
        let mut source = source.to_owned();
        let mut preserved = CompatTextFragments::new(&source);
        RenderService::prepare_wikidot_conditionals_before_include_expansion(
            &mut source,
            &page_info,
            &mut preserved,
            depth,
        );
        preserved.restore(&source)
    };

    for depth in [0, 1] {
        let out = prepare(
            "[[iftags [[#ifexpr 1 == 1 | - ]]]]\nGEN_TRUE\n[[/iftags]]\n",
            depth,
        );
        assert!(out.contains("GEN_TRUE"), "depth {depth}: {out}");
        assert!(!out.contains("[[iftags"), "depth {depth}: {out}");
        assert!(!out.contains("generated-spec"), "depth {depth}: {out}");

        let out = prepare(
            "[[iftags [[#ifexpr 1 == 0 | - ]]]]\nGEN_FALSE\n[[/iftags]]\n",
            depth,
        );
        assert!(!out.contains("GEN_FALSE"), "depth {depth}: {out}");

        let out = prepare(
            "[[iftags [[#ifexpr 1 == 1 | +テーマ | +beta ]]]]\nGEN_TAGGED\n[[/iftags]]\n",
            depth,
        );
        assert!(out.contains("GEN_TAGGED"), "depth {depth}: {out}");

        let out = prepare(
            "[[iftags [[#ifexpr 1 == 0 | +テーマ | +beta ]]]]\nGEN_UNTAGGED\n[[/iftags]]\n",
            depth,
        );
        assert!(!out.contains("GEN_UNTAGGED"), "depth {depth}: {out}");

        // The theme:suprematism-jp shape: the include variable is unbound
        // (the including sample passes no arguments), so the generated spec
        // is empty and the documentation section is dropped -- the same
        // outcome the direct view produces at depth 0.
        let out = prepare(
            "[[iftags [[#ifexpr {$scp} == (true) | - ]]]]\nSCP_DOCS\n[[/iftags]]\n",
            depth,
        );
        assert!(!out.contains("SCP_DOCS"), "depth {depth}: {out}");

        // With the variable bound by the includer, production substitutes it
        // into the included source before preparation; the gate then passes.
        let out = prepare(
            "[[iftags [[#ifexpr (true) == (true) | - ]]]]\nBOUND_DOCS\n[[/iftags]]\n",
            depth,
        );
        assert!(out.contains("BOUND_DOCS"), "depth {depth}: {out}");
    }
}

#[test]
fn generated_spec_gate_in_raw_zone_at_depth_is_prepared_once() {
    // Raw-zone (enclosed) content keeps its gates as exhibits at any depth,
    // but the generated-spec preparation still runs during the depth>=1
    // prepare: the parser function in the head is resolved and the marker is
    // present exactly once, and a later preparation pass over the same text
    // (the post-expansion prepare) does not duplicate it.
    let mut page_info = fallback_test_page_info("page", "Page");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let mut source =
        "[[iftags [[#ifexpr {$scp} == (true) | - ]]]]\nRAW_DOCS\n[[/iftags]]\n"
            .to_owned();
    let mut preserved = CompatTextFragments::new(&source);

    RenderService::prepare_wikidot_conditionals_before_include_expansion_with_mode(
        &mut source,
        &page_info,
        &mut preserved,
        1,
        true,
    );
    assert!(source.contains("RAW_DOCS"), "{source}");
    assert!(source.contains("[[iftags"), "{source}");
    assert_eq!(source.matches("generated-spec").count(), 1, "{source}");

    RenderService::prepare_wikidot_conditionals_before_include_expansion_with_mode(
        &mut source,
        &page_info,
        &mut preserved,
        1,
        true,
    );
    assert_eq!(source.matches("generated-spec").count(), 1, "{source}");
}

#[test]
fn suprematism_include_chain_matches_direct_view_outcome() {
    // theme:suprematism-jp shape: a sample (tags: テーマ) includes a theme;
    // inside the theme's kept +テーマ gate sits a license component whose own
    // +コンポーネント documentation gate leaks as an exhibit, and after the
    // gate the theme carries an ifexpr-generated documentation gate whose
    // variable the sample does not bind.
    let mut page_info = fallback_test_page_info("sample", "Sample");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);
    let mut compat_text = CompatTextFragments::new("");

    let component = "[[iftags +コンポーネント]]\nlicense docs\n[[/iftags]]\n";
    let theme = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:license-box-theme]]\n",
        "[[/iftags]]\n",
        "[[iftags [[#ifexpr {$scp} == (true) | - ]]]]\n",
        "source code docs\n",
        "[[/iftags]]\n",
    );

    let mut theme_source = theme.to_string();
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut theme_source,
        &page_info,
        &mut compat_text,
        1,
    );
    let flags = super::super::include_enclosure_flags(
        &theme_source,
        &enclosure_test_includes(&["component:license-box-theme"]),
        1,
        false,
    );
    assert_eq!(flags, vec![true]);

    let mut inside = component.to_string();
    RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
        &mut inside,
        &page_info,
        &mut compat_text,
        true,
    );

    let expanded = ftml::include(
        &theme_source,
        &settings,
        PreparedIncluder {
            pages: vec![Some(inside)],
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("theme include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(html.contains("license docs"), "{html}");
    assert_eq!(html.matches("license docs").count(), 1, "{html}");
    assert!(html.contains("[[iftags +コンポーネント]]"), "{html}");
    assert!(!html.contains("source code docs"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

#[test]
fn include_enclosure_flags_align_past_prose_and_blockquote_include_mentions() {
    // The flopstyle theme shape: the page text mentions includes in
    // prose and shows one in a blockquote example. The textual directive
    // scan counts those mentions, ftml does not collect them, and the
    // enclosure flags must still align with the collected includes.
    let mut page_info = fallback_test_page_info("theme:flopstyle-dark-jp", "Theme");
    page_info.tags = vec![Cow::Borrowed("テーマ")];
    let mut source = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:info-like]]\n",
        "注: `[[include component:info-like]]` と `[[include component:other]]` を使用する。\n",
        "> [[include component:quoted-example]]\n",
        ">\n",
        "> |image={{filename.png}}\n",
        "[[/iftags]]\n",
        "[[include component:other]]\n",
    )
    .to_string();
    let mut preserved = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut preserved,
        1,
    );

    let flags = super::super::include_enclosure_flags(
        &source,
        &enclosure_test_includes(&["component:info-like", "component:other"]),
        1,
        false,
    );

    assert_eq!(flags, vec![true, false]);
}

#[test]
fn enclosed_include_attribute_gates_stay_unevaluated_despite_include_mentions() {
    // End to end over the flopstyle/info:start shape: a component whose
    // divs gate a style attribute behind iftags is included inside an
    // active outer gate, on a page that also mentions includes in prose.
    // Live Wikidot evaluates only the outermost gate level, so both
    // gated styles are dropped (the attribute parser swallows the
    // unevaluated gate together with its content); the heritage box must
    // not keep display:none the way an evaluated -tag gate would leave it.
    let component = concat!(
        "[[div class=\"creditRate\"]]\n",
        "[[div class=\"rateBox\" [[iftags +nosuchtagxyz]]style=\"display:none;\"[[/iftags]]]]\n",
        "[[div class=\"rate-box-with-credit-button\"]]\n",
        "INNER-A\n",
        "[[/div]]\n",
        "[[/div]]\n",
        "[[div class=\"rateBox\" [[iftags -nosuchtagxyz]]style=\"display:none;\"[[/iftags]]]]\n",
        "[[div class=\"heritage-rating-module\"]]\n",
        "INNER-B\n",
        "[[/div]]\n",
        "[[/div]]\n",
        "[[/div]]\n",
    );
    let root = concat!(
        "[[iftags +テーマ]]\n",
        "[[include component:ratebox-probe]]\n",
        "注: `[[include component:ratebox-probe]]` を使用する。\n",
        "[[/iftags]]\n",
    );

    let (expanded, compat_text) =
        expand_test_enclosed_include(root, component, &["テーマ"]);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);

    assert!(html.contains("INNER-B"), "{html}");
    assert!(!html.contains("display:none"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

fn expand_o7k_geometry(
    root: &str,
    sources: &[&str],
    depth: usize,
    tags: &[&'static str],
) -> (String, CompatTextFragments, Vec<bool>) {
    let mut page_info = fallback_test_page_info("theme:07k-jp", "07K");
    page_info.tags = tags.iter().map(|&tag| Cow::Borrowed(tag)).collect();
    let settings = WikitextSettings::from_mode(WikitextMode::Page, Layout::Wikidot);

    let mut source = root.to_string();
    let mut compat_text = CompatTextFragments::new(&source);
    RenderService::prepare_wikidot_conditionals_before_include_expansion(
        &mut source,
        &page_info,
        &mut compat_text,
        depth,
    );
    let mut collected = Vec::new();
    ftml::include(
        &source,
        &settings,
        super::super::CollectingIncluder {
            includes: &mut collected,
            language: "en",
        },
        include_error,
    )
    .expect("test include collection should succeed");
    assert_eq!(collected.len(), sources.len(), "test geometry drifted");
    let flags = super::super::include_enclosure_flags(&source, &collected, depth, false);

    let mut pages = Vec::new();
    for (index, include_source) in sources.iter().enumerate() {
        let mut nested_source = include_source.to_string();
        if flags[index] {
            RenderService::prepare_wikidot_conditionals_for_include_expansion_with_mode(
                &mut nested_source,
                &page_info,
                &mut compat_text,
                true,
            );
        } else {
            RenderService::prepare_wikidot_conditionals_for_include_expansion(
                &mut nested_source,
                &page_info,
                &mut compat_text,
            );
        }
        pages.push(Some(nested_source));
    }

    let expanded = ftml::include(
        &source,
        &settings,
        PreparedIncluder {
            pages,
            missing_replacements: Default::default(),
            language: "en".to_owned(),
        },
        include_error,
    )
    .expect("test include should expand")
    .0;
    let mut expanded = expanded;
    super::super::super::iftags::remove_enclosed_iftags_markers(&mut expanded);
    (expanded, compat_text, flags)
}

#[test]
fn o7k_gated_docs_survive_blockquote_exhibit_in_gate_body() {
    // theme:07k-jp geometry: a gated documentation component is included
    // once outside the theme's own gate and once inside it, and the gate
    // body also carries a blockquote exhibit of an include. The textual
    // directive scan counts the exhibit (on the real page, 15 scanned
    // directives vs 14 collected includes); alignment must still give
    // the in-gate copy its raw-zone flag so the documentation prints
    // literally exactly once, as on live Wikidot.
    let component = concat!(
        "[[iftags +コンポーネント]]\n",
        "CENTERED-DOCS\n",
        "Lt Flops\n",
        "[[/iftags]]\n",
        "CENTERED-FUNCTIONAL\n",
    );
    let root = concat!(
        "[[include :scp-jp:component:centered-header-sigma-9]]\n",
        "[[iftags +テーマ]]\n",
        "[[include :scp-jp:component:centered-header-sigma-9]]\n",
        "> [[include :scp-jp:theme:07k]]\n",
        "[[include :scp-jp:component:image-block |name=https://example.com/x.png]]\n",
        "[[/iftags]]\n",
    );
    let (expanded, compat_text, flags) = expand_o7k_geometry(
        root,
        &[component, component, "IMAGE-BLOCK-RENDERED\n"],
        0,
        &["en", "テーマ"],
    );
    assert_eq!(flags, vec![false, true, true]);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);
    assert_eq!(html.matches("Lt Flops").count(), 1, "{html}");
    assert_eq!(html.matches("CENTERED-DOCS").count(), 1, "{html}");
    assert!(html.contains("[[iftags +コンポーネント]]"), "{html}");
    assert_eq!(html.matches("CENTERED-FUNCTIONAL").count(), 2, "{html}");
    assert!(html.contains("IMAGE-BLOCK-RENDERED"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}

#[test]
fn o7k_gated_docs_survive_blockquote_exhibit_in_gate_body_at_depth() {
    // The same theme geometry one include deeper (a sample page viewing
    // the theme): the theme source is prepared at depth 1, and the
    // exhibit must not break the enclosure alignment there either.
    let component = concat!(
        "[[iftags +コンポーネント]]\n",
        "CENTERED-DOCS\n",
        "Lt Flops\n",
        "[[/iftags]]\n",
        "CENTERED-FUNCTIONAL\n",
    );
    let root = concat!(
        "[[include :scp-jp:component:centered-header-sigma-9]]\n",
        "[[iftags +テーマ]]\n",
        "[[include :scp-jp:component:centered-header-sigma-9]]\n",
        "> [[include :scp-jp:theme:07k]]\n",
        "[[include :scp-jp:component:image-block |name=https://example.com/x.png]]\n",
        "[[/iftags]]\n",
    );
    let (expanded, compat_text, flags) = expand_o7k_geometry(
        root,
        &[component, component, "IMAGE-BLOCK-RENDERED\n"],
        1,
        &["テーマ"],
    );
    assert_eq!(flags, vec![false, true, true]);
    let html = render_pre_expanded_wikidot_page_body(expanded, compat_text, &["テーマ"]);
    assert_eq!(html.matches("Lt Flops").count(), 1, "{html}");
    assert!(html.contains("[[iftags +コンポーネント]]"), "{html}");
    assert_eq!(html.matches("CENTERED-FUNCTIONAL").count(), 2, "{html}");
    assert!(html.contains("IMAGE-BLOCK-RENDERED"), "{html}");
    assert!(!html.contains("wikijump-enclosed-iftags"), "{html}");
}
