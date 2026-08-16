/*
 * tests/page_template_assignment.rs
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

#[macro_use]
mod common;

use self::common::TestRunner;
use deepwell::constants::{ADMIN_USER_ID, SAMPLE_USER_ID, SYSTEM_USER_ID};
use deepwell::error::ErrorType;
use deepwell::models::page::{Entity as PageTable, Model as PageModel};
use deepwell::services::RequestContext;
use deepwell::services::SessionService;
use deepwell::services::category::CategoryService;
use deepwell::services::page::CreatePageOutput;
use deepwell::services::permission::{CheckPermissionContext, PermissionService};
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::session::CreateSession;
use deepwell::services::view::{
    GetArticleViewOutput, GetPageViewOutput, PageTemplateSummary,
};
use deepwell::types::{Action, Permission, Reference, Resource};
use sea_orm::{ActiveModelTrait, EntityTrait, IntoActiveModel, Set};
use serde_json::json;
use std::borrow::Cow;
use std::collections::BTreeMap;

fn set_page_actor(runner: &mut TestRunner, site_id: i64, slug: &str) {
    runner.set_request_context(RequestContext {
        session: None,
        user_id: Some(ADMIN_USER_ID),
        site_id: Some(site_id),
        page_reference: Some(Reference::Slug(Cow::Owned(slug.to_owned()))),
    });
}

async fn create_page(
    runner: &mut TestRunner,
    site_id: i64,
    slug: &str,
    wikitext: &str,
) -> CreatePageOutput {
    set_page_actor(runner, site_id, slug);
    run_endpoint!(
        runner,
        page_create,
        json!({
            "site_id": site_id,
            "wikitext": wikitext,
            "title": slug,
            "alt_title": null,
            "slug": slug,
            "layout": "wikidot",
            "revision_comments": "page template assignment fixture",
            "user_id": ADMIN_USER_ID,
            "bypass_filter": true,
            "ip_address": common::IP_ADDRESS,
        }),
    )
}

async fn mark_page_imported(runner: &TestRunner, page_id: i64) -> PageModel {
    let page = PageTable::find_by_id(page_id)
        .one(runner.context().transaction())
        .await
        .expect("imported page lookup should not fail")
        .expect("imported page should exist");
    let mut page = page.into_active_model();
    page.from_wikidot = Set(true);
    page.update(runner.context().transaction())
        .await
        .expect("page should be marked as imported")
}

async fn anonymous_article_html_and_cache_key(
    runner: &TestRunner,
    site_id: i64,
    slug: &str,
) -> (String, String) {
    match run_endpoint!(
        runner,
        article_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": { "slug": slug, "extra": "" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetArticleViewOutput {
            page:
                GetPageViewOutput::Found {
                    compiled_body_html, ..
                },
            article_page_cache_key: Some(cache_key),
            ..
        } => (compiled_body_html, cache_key),
        other => panic!("expected cacheable anonymous article view, got {other:?}"),
    }
}

async fn missing_page_template(
    runner: &TestRunner,
    site_id: i64,
    slug: &str,
    extra: &str,
    session_token: Option<&str>,
) -> (Option<String>, Vec<PageTemplateSummary>, Option<i64>) {
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": slug, "extra": extra },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            new_page_wikitext,
            page_templates,
            selected_template_page_id,
            ..
        } => (new_page_wikitext, page_templates, selected_template_page_id),
        other => panic!("expected a missing-page view, got {other:?}"),
    }
}

async fn grant_category_permission(
    runner: &TestRunner,
    site_id: i64,
    category_id: i64,
    role_name: &str,
    action: Action,
    user_ids: &[i64],
) {
    let role = RoleService::create(
        runner.context(),
        InternalCreateRoleInput {
            site_id,
            name: role_name.to_owned(),
            description: None,
            is_virtual: false,
            parent_role_id: None,
            creating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("category permission role should be created");
    PermissionService::update_permissions_for_role(
        runner.context(),
        UpdateRolePermissionsInput {
            site_id,
            role_reference: Reference::Id(role.role_id),
            new_permissions: vec![Permission {
                resource_type: Resource::Page,
                resource_category: Some(Reference::Id(category_id)),
                action,
            }],
            cascade_removals: false,
            updating_user_id: SYSTEM_USER_ID,
            ip_address: common::IP_ADDRESS,
        },
    )
    .await
    .expect("category permission should be updated");
    for &user_id in user_ids {
        RoleService::grant_role_to_user(
            runner.context(),
            GrantUserRoleInput {
                site_id,
                user_id,
                role_id: role.role_id,
                assigning_user_id: SYSTEM_USER_ID,
                expires_at: None,
                ip_address: common::IP_ADDRESS,
            },
        )
        .await
        .expect("category permission role should be granted");
    }
}

#[tokio::test]
async fn category_page_template_prefills_new_page_source_and_can_be_cleared() {
    const TEMPLATE_SOURCE: &str = "ORACLE-TEMPLATE-BEGIN\nTitle: %%title%%\nContent: %%content%%\nORACLE-TEMPLATE-END";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let admin_session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell page template assignment test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template = create_page(
        &mut runner,
        site_id,
        "template:page-template-assignment",
        TEMPLATE_SOURCE,
    )
    .await;
    let ordinary = create_page(
        &mut runner,
        site_id,
        "ordinary-page-template-source",
        "not a template",
    )
    .await;
    let alternate_template = create_page(
        &mut runner,
        site_id,
        "template:page-template-assignment-alternate",
        "ALTERNATE-TEMPLATE-SOURCE",
    )
    .await;
    let category = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "page-template-assignment-target",
    )
    .await
    .expect("target category should be created");
    let template_category =
        CategoryService::get(runner.context(), site_id, Reference::from("template"))
            .await
            .expect("template category should exist");
    let sample_session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: SAMPLE_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell page template permission test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("registered non-member session should be created");
    let (no_create_source, no_create_templates, no_create_template_page_id) =
        missing_page_template(
            &runner,
            site_id,
            "page-template-assignment-target:no-create-page",
            "/edit/true",
            Some(&sample_session_token),
        )
        .await;
    assert_eq!(no_create_source, None);
    assert!(no_create_templates.is_empty());
    assert_eq!(no_create_template_page_id, None);
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "page-template-assignment-creators",
        Action::Create,
        &[ADMIN_USER_ID, SAMPLE_USER_ID],
    )
    .await;
    grant_category_permission(
        &runner,
        site_id,
        template_category.category_id,
        "page-template-assignment-template-viewers",
        Action::View,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });

    let rejected = run_endpoint_err!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": ordinary.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_contains_error!(rejected, ErrorType::PageCategory);

    let assigned = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(assigned.template_page_id, Some(template.page_id));
    let (initial_source, page_templates, selected_template_page_id) =
        missing_page_template(
            &runner,
            site_id,
            "page-template-assignment-target:new-page",
            "/edit/true",
            Some(&admin_session_token),
        )
        .await;
    assert_eq!(initial_source.as_deref(), Some(TEMPLATE_SOURCE));
    assert_eq!(selected_template_page_id, Some(template.page_id));
    assert!(page_templates.iter().any(|candidate| {
        candidate.page_id == template.page_id && candidate.wikitext == TEMPLATE_SOURCE
    }));

    let forced_extra = format!("/edit/true/t/{}", alternate_template.page_id);
    let (forced_source, _, forced_template_page_id) = missing_page_template(
        &runner,
        site_id,
        "page-template-assignment-target:forced-page",
        &forced_extra,
        Some(&admin_session_token),
    )
    .await;
    assert_eq!(forced_source.as_deref(), Some("ALTERNATE-TEMPLATE-SOURCE"));
    assert_eq!(forced_template_page_id, Some(alternate_template.page_id));

    let (anonymous_source, anonymous_templates, anonymous_template_page_id) =
        missing_page_template(
            &runner,
            site_id,
            "page-template-assignment-target:anonymous-page",
            "/edit/true",
            None,
        )
        .await;
    assert_eq!(anonymous_source, None);
    assert!(anonymous_templates.is_empty());
    assert_eq!(anonymous_template_page_id, None);

    let sample_user_can_create = PermissionService::check_user_can(
        runner.context(),
        &CheckPermissionContext {
            user_id: Some(SAMPLE_USER_ID),
            site_id,
            page_reference: None,
        },
        Permission {
            resource_type: Resource::Page,
            resource_category: Some(Reference::Id(category.category_id)),
            action: Action::Create,
        },
    )
    .await
    .expect("sample-user create permission should be checked");
    assert!(sample_user_can_create);
    let (no_view_source, no_view_templates, no_view_template_page_id) =
        missing_page_template(
            &runner,
            site_id,
            "page-template-assignment-target:no-template-view-page",
            "/edit/true",
            Some(&sample_session_token),
        )
        .await;
    assert_eq!(no_view_source, None);
    assert!(no_view_templates.is_empty());
    assert_eq!(no_view_template_page_id, None);

    let default_category =
        CategoryService::get(runner.context(), site_id, Reference::from("_default"))
            .await
            .expect("seeded default category should exist");
    let assigned_default = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": default_category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(assigned_default.template_page_id, Some(template.page_id));
    let (default_source, _, default_template_page_id) = missing_page_template(
        &runner,
        site_id,
        "page-template-assignment-default-page",
        "/edit/true",
        Some(&admin_session_token),
    )
    .await;
    assert_eq!(default_source.as_deref(), Some(TEMPLATE_SOURCE));
    assert_eq!(default_template_page_id, Some(template.page_id));

    let cleared = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(cleared.template_page_id, None);
    assert_eq!(
        missing_page_template(
            &runner,
            site_id,
            "page-template-assignment-target:another-page",
            "/edit/true",
            Some(&admin_session_token),
        )
        .await
        .0,
        None,
    );

    let cleared_default = run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": default_category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": null,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert_eq!(cleared_default.template_page_id, None);
}

#[tokio::test]
async fn page_view_exposes_category_data_form_definition_in_template_order() {
    const CATEGORY: &str = "data-form-create-flow";
    const TEMPLATE_SOURCE: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  name:\n",
        "    label: Name\n",
        "    type: text\n",
        "  choice:\n",
        "    label: Choice\n",
        "    type: select\n",
        "    values:\n",
        "      a: Alpha\n",
        "      b: Beta\n",
        "    default: b\n",
        "[[/form]]",
    );

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell data-form create-flow test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template = create_page(
        &mut runner,
        site_id,
        "data-form-create-flow:_template",
        TEMPLATE_SOURCE,
    )
    .await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("data-form target category should be created");
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "data-form-create-flow-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    for extra in ["", "/edit"] {
        match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": session_token,
                "route": {
                    "slug": "data-form-create-flow:_template",
                    "extra": extra
                },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Found {
                data_form: None,
                wikitext,
                compiled_body_html,
                ..
            } => {
                assert_eq!(wikitext, TEMPLATE_SOURCE);
                assert!(!compiled_body_html.contains("form-table"));
            }
            other => {
                panic!("category template must retain ordinary view/edit: {other:?}")
            }
        }
    }

    let definition = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-create-flow:example",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: Some(data_form),
            ..
        } => data_form.definition,
        other => panic!("expected missing data-form page definition, got {other:?}"),
    };

    assert_eq!(
        definition
            .fields
            .iter()
            .map(|field| field.name.as_str())
            .collect::<Vec<_>>(),
        ["name", "choice"],
        "Wikidot emits form-fields in category-template field order",
    );
    assert!(definition.default_layout);
    assert_eq!(definition.fields[0].label, "Name");
    assert_eq!(definition.fields[0].field_type.as_deref(), Some("text"));
    assert_eq!(definition.fields[0].default_value, None);
    assert_eq!(definition.fields[1].label, "Choice");
    assert_eq!(definition.fields[1].field_type.as_deref(), Some("select"));
    assert_eq!(definition.fields[1].default_value.as_deref(), Some("b"));
    assert_eq!(
        definition.fields[1]
            .values
            .iter()
            .map(|value| (value.value.as_str(), value.label.as_str()))
            .collect::<Vec<_>>(),
        [("a", "Alpha"), ("b", "Beta")],
    );

    create_page(
        &mut runner,
        site_id,
        "data-form-create-flow:saved",
        "name: 'Probe Name'\nchoice: a",
    )
    .await;
    let edit_definition = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-create-flow:saved",
                "extra": "/edit"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            ..
        } => data_form,
        other => panic!("expected saved data-form page definition, got {other:?}"),
    };
    assert_eq!(edit_definition.definition, definition);
    assert_eq!(
        edit_definition.values,
        BTreeMap::from([
            ("choice".to_owned(), "a".to_owned()),
            ("name".to_owned(), "Probe Name".to_owned()),
        ]),
    );

    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {
                "slug": "data-form-create-flow:saved",
                "extra": "/edit"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: None, ..
        } => {}
        other => panic!("view-only actors must not receive editor metadata: {other:?}"),
    }

    let rendered_html = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {
                "slug": "data-form-create-flow:saved",
                "extra": ""
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: None,
            compiled_body_html,
            ..
        } => compiled_body_html,
        other => panic!("expected rendered data-form page, got {other:?}"),
    };
    assert!(
        rendered_html.contains(concat!(
            "<table class=\"form-table\">",
            "<tbody><tr class=\"form-row\">",
            "<td class=\"form-labels\"><span class=\"form-label\">Name</span></td>",
            "<td class=\"form-values\"><span>Probe Name</span></td>",
            "</tr>",
            "<tr class=\"form-row\">",
            "<td class=\"form-labels\"><span class=\"form-label\">Choice</span></td>",
            "<td class=\"form-values\"><span>Alpha</span></td>",
            "</tr>",
            "</tbody></table>",
        )),
        "saved data-form fields must render with Wikidot's table DOM:\n{rendered_html}",
    );

    for (slug, source) in [
        (
            "data-form-create-flow:legacy",
            "name: 'Probe Name'\nlegacy: x\nchoice: a",
        ),
        (
            "data-form-create-flow:blank-line",
            "name: 'Probe Name'\n\nchoice: a",
        ),
    ] {
        create_page(&mut runner, site_id, slug, source).await;
        for extra in ["", "/edit"] {
            match run_endpoint!(
                runner,
                page_view,
                json!({
                    "site_id": site_id,
                    "session_token": session_token,
                    "route": { "slug": slug, "extra": extra },
                    "locales": ["en-US", "en"],
                }),
            ) {
                GetPageViewOutput::Found {
                    data_form: None,
                    wikitext,
                    compiled_body_html,
                    ..
                } => {
                    assert_eq!(wikitext, source);
                    assert!(!compiled_body_html.contains("form-table"));
                }
                other => panic!("unrecognized stored source must fail closed: {other:?}"),
            }
        }
    }

    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-create-flow:saved",
                "extra": "/p/2"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: None,
            compiled_body_html,
            ..
        } => assert!(!compiled_body_html.contains("form-table")),
        other => panic!("non-bare routes must preserve route rendering: {other:?}"),
    }
}

#[tokio::test]
async fn page_view_and_edit_round_trip_date_field_scalars_and_options() {
    const CATEGORY: &str = "data-form-date-field-public";
    const TEMPLATE_SLUG: &str = "data-form-date-field-public:_template";
    const PAGE_SLUG: &str = "data-form-date-field-public:date";
    const TEMPLATE_SOURCE: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  date:\n",
        "    label: Date value\n",
        "    width: 24\n",
        "    type: date\n",
        "    options:\n",
        "      dateFormat: 'mm/dd/yy'\n",
        "      showOn: button\n",
        "[[/form]]",
    );

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell data-form date-field test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template =
        create_page(&mut runner, site_id, TEMPLATE_SLUG, TEMPLATE_SOURCE).await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("date-form category should be created");
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "data-form-date-field-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let definition = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": PAGE_SLUG, "extra": "/edit/true" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: Some(data_form),
            ..
        } => data_form.definition,
        other => {
            panic!("date field must be exposed by the public create view: {other:?}")
        }
    };
    let date = definition.field("date").expect("date field definition");
    assert!(definition.supports_observed_create_edit());
    assert_eq!(date.width, 24);
    assert_eq!(date.options["dateFormat"], json!("mm/dd/yy"));
    assert_eq!(date.options["showOn"], json!("button"));

    let page = create_page(&mut runner, site_id, PAGE_SLUG, "date: 02/29/2023").await;
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": PAGE_SLUG, "extra": "/edit" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            ..
        } => {
            assert_eq!(data_form.values["date"], "02/29/2023");
        }
        other => {
            panic!("date field must round-trip through the public edit view: {other:?}")
        }
    }

    set_page_actor(&mut runner, site_id, PAGE_SLUG);
    run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": PAGE_SLUG,
            "last_revision_id": page.revision_id,
            "revision_comments": "round trip leap date",
            "user_id": ADMIN_USER_ID,
            "wikitext": "date: 02/29/2024",
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("date field edit should save through the public page seam");
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": PAGE_SLUG, "extra": "/edit" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            wikitext,
            ..
        } => {
            assert_eq!(wikitext, "date: 02/29/2024");
            assert_eq!(data_form.values["date"], "02/29/2024");
        }
        other => {
            panic!("saved date field must reload through the public edit view: {other:?}")
        }
    }
}

#[tokio::test]
async fn assigned_data_form_template_edit_invalidates_warm_imported_article_cache() {
    const CATEGORY: &str = "data-form-template-cache-lifecycle";
    const TEMPLATE_SLUG: &str = "data-form-template-cache-lifecycle:_template";
    const PAGE_SLUG: &str = "data-form-template-cache-lifecycle:saved";
    const TEMPLATE_SOURCE_A: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  name:\n",
        "    label: Lifecycle label A\n",
        "    type: text\n",
        "[[/form]]",
    );
    const TEMPLATE_SOURCE_B: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  name:\n",
        "    label: Lifecycle label B\n",
        "    type: text\n",
        "[[/form]]",
    );

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let template =
        create_page(&mut runner, site_id, TEMPLATE_SLUG, TEMPLATE_SOURCE_A).await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("data-form lifecycle category should be created");
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let page =
        create_page(&mut runner, site_id, PAGE_SLUG, "name: 'Lifecycle value'").await;
    mark_page_imported(&runner, page.page_id).await;
    runner.set_request_context(RequestContext::default());

    let (cold_html, cold_cache_key) =
        anonymous_article_html_and_cache_key(&runner, site_id, PAGE_SLUG).await;
    assert!(cold_html.contains("Lifecycle label A"));
    assert!(cold_html.contains("Lifecycle value"));

    let (warm_html, warm_cache_key) =
        anonymous_article_html_and_cache_key(&runner, site_id, PAGE_SLUG).await;
    assert_eq!(warm_html, cold_html);
    assert_eq!(warm_cache_key, cold_cache_key);

    set_page_actor(&mut runner, site_id, TEMPLATE_SLUG);
    run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": TEMPLATE_SLUG,
            "last_revision_id": template.revision_id,
            "revision_comments": "replace lifecycle data-form label",
            "user_id": ADMIN_USER_ID,
            "wikitext": TEMPLATE_SOURCE_B,
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("template edit should create a revision");
    runner.set_request_context(RequestContext::default());

    let (edited_html, edited_cache_key) =
        anonymous_article_html_and_cache_key(&runner, site_id, PAGE_SLUG).await;
    assert!(
        edited_html.contains("Lifecycle label B"),
        "saved template edits must replace warm anonymous imported-page output:\n{edited_html}",
    );
    assert!(!edited_html.contains("Lifecycle label A"));
    assert!(edited_html.contains("Lifecycle value"));
    assert_ne!(
        edited_cache_key, cold_cache_key,
        "assigned template revisions must participate in the Deepwell article cache identity",
    );
}

#[tokio::test]
async fn page_view_exposes_live_text_and_select_control_contract() {
    const CATEGORY: &str = "data-form-control-contract";
    const TEMPLATE_SOURCE: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  plain:\n",
        "    label: Plain text\n",
        "    width: 0\n",
        "    default: \"**bold** #hash\"\n",
        "  multi:\n",
        "    label: Multi line\n",
        "    type: text\n",
        "    width: 50\n",
        "    height: 3\n",
        "  matched:\n",
        "    label: Matched text\n",
        "    type: text\n",
        "    hint: enter a color like \\#468259\n",
        "    match: /^ok-[0-9]+$/\n",
        "    match-error: Use ok- followed by digits\n",
        "    join: true\n",
        "    before: PRE\n",
        "    after: POST\n",
        "  missing_values:\n",
        "    label: Missing values\n",
        "    type: select\n",
        "  empty_values:\n",
        "    label: Empty values\n",
        "    type: select\n",
        "    values:\n",
        "  select_one:\n",
        "    label: Select one\n",
        "    type: select\n",
        "    hint: ignored select hint\n",
        "    before: PRE\n",
        "    after: POST\n",
        "    values:\n",
        "      a: Alpha\n",
        "  select_five:\n",
        "    label: Select five\n",
        "    type: select\n",
        "    values:\n",
        "      0: Zero\n",
        "      1: One\n",
        "      2: Two\n",
        "      3: Three\n",
        "      4: Four\n",
        "    default: 4\n",
        "  reserved:\n",
        "    label: Reserved labels\n",
        "    type: select\n",
        "    values:\n",
        "      no_value: No\n",
        "      yes_value: Yes\n",
        "      false_value: False\n",
        "      true_value: True\n",
        "  quoted:\n",
        "    label: Quoted labels\n",
        "    type: select\n",
        "    values:\n",
        "      no_value: \"No\"\n",
        "      yes_value: \"Yes\"\n",
        "      false_value: \"False\"\n",
        "      true_value: \"True\"\n",
        "[[/form]]",
    );
    const SAVED_SOURCE: &str = r#"plain: 'O''Brien: # [x] \ slash "quote"'
multi: "first \"quoted\"\nsecond 'single' \\ end"
matched: ok-42
missing_values: null
empty_values: null
select_one: a
select_five: '2'
reserved: no_value
quoted: false_value"#;

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell data-form text/select controls test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template = create_page(
        &mut runner,
        site_id,
        "data-form-control-contract:_template",
        TEMPLATE_SOURCE,
    )
    .await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("data-form target category should be created");
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "data-form-control-contract-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let definition = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-control-contract:new",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: Some(data_form),
            ..
        } => data_form.definition,
        other => {
            panic!("expected live-backed data-form control definition, got {other:?}")
        }
    };

    assert_eq!(
        definition
            .fields
            .iter()
            .map(|field| field.name.as_str())
            .collect::<Vec<_>>(),
        [
            "plain",
            "multi",
            "matched",
            "missing_values",
            "empty_values",
            "select_one",
            "select_five",
            "reserved",
            "quoted",
        ],
        "select fields without usable values stay in storage order",
    );
    let plain = definition.field("plain").expect("plain field");
    assert_eq!(plain.field_type.as_deref(), Some("text"));
    assert_eq!(plain.width, 1);
    assert_eq!(plain.height, 1);
    assert_eq!(plain.default_value.as_deref(), Some("**bold** #hash"));
    let multi = definition.field("multi").expect("multiline field");
    assert_eq!(multi.width, 50);
    assert_eq!(multi.height, 3);
    let matched = definition.field("matched").expect("matched field");
    assert_eq!(matched.width, 40);
    assert_eq!(matched.height, 1);
    assert_eq!(matched.hint, "enter a color like \\#468259");
    assert_eq!(matched.match_pattern.as_deref(), Some("/^ok-[0-9]+$/"));
    assert_eq!(
        matched.match_error.as_deref(),
        Some("Use ok- followed by digits"),
    );
    assert!(matched.join);
    assert_eq!(matched.before, "PRE");
    assert_eq!(matched.after, "POST");
    let select_one = definition.field("select_one").expect("one-value select");
    assert_eq!(select_one.hint, "ignored select hint");
    assert_eq!(select_one.before, "PRE");
    assert_eq!(select_one.after, "POST");
    assert_eq!(select_one.values.len(), 1,);
    assert_eq!(
        definition
            .field("select_five")
            .expect("five-value select")
            .values
            .len(),
        5,
    );
    assert_eq!(
        definition
            .field("reserved")
            .expect("unquoted reserved labels")
            .values
            .iter()
            .map(|value| value.label.as_str())
            .collect::<Vec<_>>(),
        ["No", "Yes"],
    );
    assert_eq!(
        definition
            .field("quoted")
            .expect("quoted reserved labels")
            .values
            .iter()
            .map(|value| value.label.as_str())
            .collect::<Vec<_>>(),
        ["No", "Yes", "False", "True"],
    );

    create_page(
        &mut runner,
        site_id,
        "data-form-control-contract:saved",
        SAVED_SOURCE,
    )
    .await;
    let editor = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-control-contract:saved",
                "extra": "/edit"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            ..
        } => data_form,
        other => panic!("expected stored live-backed data-form values, got {other:?}"),
    };
    assert_eq!(editor.definition, definition);
    assert_eq!(
        editor.values,
        BTreeMap::from([
            ("matched".to_owned(), "ok-42".to_owned()),
            ("missing_values".to_owned(), String::new()),
            ("empty_values".to_owned(), String::new()),
            (
                "multi".to_owned(),
                "first \"quoted\"\nsecond 'single' \\ end".to_owned(),
            ),
            (
                "plain".to_owned(),
                "O'Brien: # [x] \\ slash \"quote\"".to_owned(),
            ),
            ("quoted".to_owned(), "false_value".to_owned()),
            ("reserved".to_owned(), "no_value".to_owned()),
            ("select_five".to_owned(), "2".to_owned()),
            ("select_one".to_owned(), "a".to_owned()),
        ]),
    );

    for (slug, source) in [
        (
            "data-form-control-contract:unquoted-number",
            SAVED_SOURCE.replace("select_five: '2'", "select_five: 2"),
        ),
        (
            "data-form-control-contract:unsafe-plain-text",
            SAVED_SOURCE.replace(
                r#"plain: 'O''Brien: # [x] \ slash "quote"'"#,
                "plain: unquoted text",
            ),
        ),
    ] {
        create_page(&mut runner, site_id, slug, &source).await;
        match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": session_token,
                "route": {
                    "slug": slug,
                    "extra": "/edit"
                },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Found {
                data_form: None,
                wikitext,
                ..
            } => assert_eq!(wikitext, source),
            other => panic!("non-canonical stored scalars must fail closed: {other:?}"),
        }
    }

    const UNSUPPORTED_SELECT_PROPERTY_CATEGORY: &str =
        "data-form-unsupported-select-property";
    let unsupported_template = create_page(
        &mut runner,
        site_id,
        "data-form-unsupported-select-property:_template",
        concat!(
            "[[form]]\n",
            "fields:\n",
            "  choice:\n",
            "    label: Choice\n",
            "    type: select\n",
            "    width: 40\n",
            "    values:\n",
            "      a: Alpha\n",
            "[[/form]]",
        ),
    )
    .await;
    let unsupported_category = CategoryService::get_or_create(
        runner.context(),
        site_id,
        UNSUPPORTED_SELECT_PROPERTY_CATEGORY,
    )
    .await
    .expect("unsupported-property category should be created");
    grant_category_permission(
        &runner,
        site_id,
        unsupported_category.category_id,
        "data-form-unsupported-select-property-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": unsupported_category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": unsupported_template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-unsupported-select-property:new",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: None, ..
        } => {}
        other => panic!("text-only properties on selects must fail closed: {other:?}"),
    }

    const DIMENSION_CATEGORY: &str = "data-form-dimension-boundaries";
    let dimension_template = create_page(
        &mut runner,
        site_id,
        "data-form-dimension-boundaries:_template",
        concat!(
            "[[form]]\n",
            "fields:\n",
            "  omitted:\n",
            "    label: Omitted\n",
            "  empty:\n",
            "    label: Empty\n",
            "    width:\n",
            "    height:\n",
            "  nonnumeric:\n",
            "    label: Nonnumeric\n",
            "    width: nope\n",
            "    height: nope\n",
            "  zero:\n",
            "    label: Zero\n",
            "    width: 0\n",
            "    height: 0\n",
            "  negative:\n",
            "    label: Negative\n",
            "    width: -1\n",
            "    height: -1\n",
            "  one:\n",
            "    label: One\n",
            "    height: 1\n",
            "  two:\n",
            "    label: Two\n",
            "    height: 2\n",
            "[[/form]]",
        ),
    )
    .await;
    let dimension_category =
        CategoryService::get_or_create(runner.context(), site_id, DIMENSION_CATEGORY)
            .await
            .expect("dimension-boundary category should be created");
    grant_category_permission(
        &runner,
        site_id,
        dimension_category.category_id,
        "data-form-dimension-boundary-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": dimension_category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": dimension_template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    let dimensions = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-dimension-boundaries:new",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: Some(data_form),
            ..
        } => data_form
            .definition
            .fields
            .into_iter()
            .map(|field| (field.name, field.width, field.height))
            .collect::<Vec<_>>(),
        other => panic!("expected dimension-boundary definition, got {other:?}"),
    };
    assert_eq!(
        dimensions,
        [
            ("omitted".to_owned(), 40, 1),
            ("empty".to_owned(), 40, 1),
            ("nonnumeric".to_owned(), 40, 1),
            ("zero".to_owned(), 1, 1),
            ("negative".to_owned(), 1, 1),
            ("one".to_owned(), 40, 1),
            ("two".to_owned(), 40, 2),
        ],
    );
}

#[tokio::test]
async fn empty_text_values_survive_public_create_edit_view_and_listpages_lifecycle() {
    const CATEGORY: &str = "data-form-empty-text-lifecycle";
    const TEMPLATE_SLUG: &str = "data-form-empty-text-lifecycle:_template";
    const TARGET_SLUG: &str = "data-form-empty-text-lifecycle:saved";
    const EMPTY_SOURCE: &str = "explicit: ''\nimplicit: ''\nchoice: null";
    const TEMPLATE_SOURCE: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  explicit:\n",
        "    label: Explicit text\n",
        "    type: text\n",
        "  implicit:\n",
        "    label: Implicit text\n",
        "  choice:\n",
        "    label: Choice\n",
        "    type: select\n",
        "    values:\n",
        "      a: Alpha\n",
        "[[/form]]",
    );

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell empty text data-form lifecycle test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template =
        create_page(&mut runner, site_id, TEMPLATE_SLUG, TEMPLATE_SOURCE).await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("data-form target category should be created");
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "data-form-empty-text-lifecycle-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let page = create_page(&mut runner, site_id, TARGET_SLUG, EMPTY_SOURCE).await;
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": TARGET_SLUG, "extra": "/edit" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            wikitext,
            ..
        } => {
            assert_eq!(wikitext, EMPTY_SOURCE);
            assert_eq!(
                data_form.values,
                BTreeMap::from([
                    ("choice".to_owned(), String::new()),
                    ("explicit".to_owned(), String::new()),
                    ("implicit".to_owned(), String::new()),
                ]),
            );
        }
        other => {
            panic!("expected canonical empty values immediately after create: {other:?}")
        }
    }

    set_page_actor(&mut runner, site_id, TARGET_SLUG);
    let populated = run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": TARGET_SLUG,
            "last_revision_id": page.revision_id,
            "revision_comments": "populate data-form fields",
            "user_id": ADMIN_USER_ID,
            "wikitext": "explicit: alpha\nimplicit: beta\nchoice: a",
            "ip_address": common::IP_ADDRESS,
        }),
    )
    .expect("populated data-form edit should create a revision");
    let emptied = run_endpoint!(
        runner,
        page_edit,
        json!({
            "site_id": site_id,
            "page": TARGET_SLUG,
            "last_revision_id": populated.revision_id,
            "revision_comments": "empty data-form text fields",
            "user_id": ADMIN_USER_ID,
            "wikitext": EMPTY_SOURCE,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    assert!(
        emptied.is_some(),
        "empty data-form edit should create a revision"
    );

    let editor = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": { "slug": TARGET_SLUG, "extra": "/edit" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            ..
        } => data_form,
        other => {
            panic!("expected empty text values in the data-form editor, got {other:?}")
        }
    };
    assert_eq!(
        editor.values,
        BTreeMap::from([
            ("choice".to_owned(), String::new()),
            ("explicit".to_owned(), String::new()),
            ("implicit".to_owned(), String::new()),
        ]),
    );

    let rendered_html = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": { "slug": TARGET_SLUG, "extra": "" },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: None,
            compiled_body_html,
            ..
        } => compiled_body_html,
        other => panic!("expected rendered empty data-form page, got {other:?}"),
    };
    assert!(rendered_html.contains("Explicit text"), "{rendered_html}");
    assert!(rendered_html.contains("Implicit text"), "{rendered_html}");
    assert!(!rendered_html.contains("alpha"), "{rendered_html}");
    assert!(!rendered_html.contains("beta"), "{rendered_html}");

    let index_source = concat!(
        "[[module ListPages category=\"data-form-empty-text-lifecycle\" name=\"saved\" separate=\"no\" wrapper=\"no\"]]\n",
        "EMPTY-TEXT-BEGIN|%%form_data{explicit}%%|%%form_raw{implicit}%%|EMPTY-TEXT-END\n",
        "[[/module]]",
    );
    create_page(
        &mut runner,
        site_id,
        "data-form-empty-text-lifecycle-index",
        index_source,
    )
    .await;
    let listpages_html = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {
                "slug": "data-form-empty-text-lifecycle-index",
                "extra": ""
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            compiled_body_html, ..
        } => compiled_body_html,
        other => panic!("expected rendered ListPages page, got {other:?}"),
    };
    assert!(
        listpages_html.contains("EMPTY-TEXT-BEGIN|||EMPTY-TEXT-END"),
        "ListPages must resolve canonical empty text values:\n{listpages_html}",
    );

    for (slug, source) in [
        (
            "data-form-empty-text-lifecycle:text-null",
            "explicit: null\nimplicit: ''\nchoice: null",
        ),
        (
            "data-form-empty-text-lifecycle:select-empty-string",
            "explicit: ''\nimplicit: ''\nchoice: ''",
        ),
    ] {
        create_page(&mut runner, site_id, slug, source).await;
        match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": session_token,
                "route": { "slug": slug, "extra": "/edit" },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Found {
                data_form: None,
                wikitext,
                ..
            } => assert_eq!(wikitext, source),
            other => panic!("noncanonical empty scalar must fail closed: {other:?}"),
        }
    }
}

#[tokio::test]
async fn page_view_exposes_live_checkbox_and_wiki_contract() {
    const CATEGORY: &str = "data-form-checkbox-wiki-contract";
    const TEMPLATE_SOURCE: &str = concat!(
        "[[form]]\n",
        "fields:\n",
        "  enabled:\n",
        "    label: Enabled\n",
        "    type: checkbox\n",
        "    default: 1\n",
        "    before: PRE\n",
        "    after: POST\n",
        "  details:\n",
        "    label: Details\n",
        "    type: wiki\n",
        "    default: \"**Default**\"\n",
        "    hint: enter wiki \\#source\n",
        "    before: \"**Before**\"\n",
        "    after: \"//After//\"\n",
        "    match: /^never$/\n",
        "    match-error: ignored\n",
        "[[/form]]",
    );
    const SAVED_SOURCE: &str = "enabled: '1'\ndetails: \"**Bold**\\n[[[start|Home]]]\"";

    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell checkbox/wiki data-form contract test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    let template = create_page(
        &mut runner,
        site_id,
        "data-form-checkbox-wiki-contract:_template",
        TEMPLATE_SOURCE,
    )
    .await;
    let category = CategoryService::get_or_create(runner.context(), site_id, CATEGORY)
        .await
        .expect("data-form target category should be created");
    grant_category_permission(
        &runner,
        site_id,
        category.category_id,
        "data-form-checkbox-wiki-contract-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );

    let definition = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-checkbox-wiki-contract:new",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: Some(data_form),
            ..
        } => data_form.definition,
        other => panic!("expected checkbox/wiki create definition, got {other:?}"),
    };
    let enabled = definition.field("enabled").expect("checkbox field");
    assert_eq!(enabled.default_value.as_deref(), Some("1"));
    let details = definition.field("details").expect("wiki field");
    assert_eq!((details.width, details.height), (40, 2));
    assert_eq!(details.hint, "enter wiki \\#source");
    assert_eq!(details.match_pattern, None);
    assert_eq!(details.match_error, None);

    create_page(
        &mut runner,
        site_id,
        "data-form-checkbox-wiki-contract:saved",
        SAVED_SOURCE,
    )
    .await;
    let editor = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-checkbox-wiki-contract:saved",
                "extra": "/edit"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            data_form: Some(data_form),
            ..
        } => data_form,
        other => panic!("expected checkbox/wiki edit definition, got {other:?}"),
    };
    assert_eq!(
        editor.values,
        BTreeMap::from([
            (
                "details".to_owned(),
                "**Bold**\n[[[start|Home]]]".to_owned()
            ),
            ("enabled".to_owned(), "1".to_owned()),
        ]),
    );

    let rendered_html = match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": null,
            "route": {
                "slug": "data-form-checkbox-wiki-contract:saved",
                "extra": ""
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Found {
            compiled_body_html, ..
        } => compiled_body_html,
        other => panic!("expected checkbox/wiki rendered page, got {other:?}"),
    };
    assert!(
        rendered_html.contains("<span>PRE 1 POST</span>"),
        "{rendered_html}",
    );
    assert!(
        rendered_html.contains(r#"<div class="form-value field-details">"#,)
            && rendered_html.contains("<p><strong>Bold</strong><br>")
            && rendered_html.contains(r#"<a class="newpage" href="/start">Home</a>"#),
        "wiki field values must compile through the Wikidot renderer:\n{rendered_html}",
    );
    assert!(
        rendered_html
            .contains(r#"<p><span style="white-space: pre-wrap;">**Before**</span></p>"#,)
            && rendered_html.contains(
                r#"<p><span style="white-space: pre-wrap;">//After//</span></p>"#,
            ),
        "wiki affixes must stay literal while the stored value is parsed:\n{rendered_html}",
    );
}

#[tokio::test]
async fn page_view_exposes_live_hidden_password_static_url_scalar_contract() {
    let mut runner = TestRunner::setup().await;
    let site_id = run_endpoint!(runner, site_get, json!({ "site": "test" }))
        .expect("seeded test site should exist")
        .site
        .site_id;
    let session_token = SessionService::create(
        runner.context(),
        CreateSession {
            user_id: ADMIN_USER_ID,
            ip_address: common::IP_ADDRESS,
            user_agent: "deepwell scalar data-form contract test".to_owned(),
            restricted: false,
        },
    )
    .await
    .expect("admin session should be created");
    runner.set_request_context(RequestContext {
        user_id: Some(ADMIN_USER_ID),
        ..Default::default()
    });
    let cases = [
        (
            "hidden",
            "[[form]]\nfields:\n  scalar:\n    label: Hidden <scalar>\n    type: hidden\n    value: HIDDEN_CONFIGURED_ALPHA\n[[/form]]",
            "scalar: HIDDEN_CONFIGURED_ALPHA",
            Some("HIDDEN_CONFIGURED_ALPHA"),
        ),
        (
            "password",
            "[[form]]\nfields:\n  scalar:\n    label: Password scalar\n    type: password\n[[/form]]",
            "scalar: NONSECRET_PASSWORD_ALPHA",
            None,
        ),
        (
            "static",
            "[[form]]\nfields:\n  scalar:\n    label: Static scalar\n    type: static\n    value: 'STATIC **BOLD** ALPHA'\n[[/form]]",
            "null",
            Some("STATIC **BOLD** ALPHA"),
        ),
        (
            "url",
            "[[form]]\nfields:\n  scalar:\n    label: URL scalar\n    type: url\n[[/form]]",
            "scalar: example.com/alpha",
            None,
        ),
    ];

    for (field_type, template_source, saved_source, configured_value) in cases {
        let category_name = format!("data-form-scalar-{field_type}");
        let template_slug = format!("{category_name}:_template");
        let template =
            create_page(&mut runner, site_id, &template_slug, template_source).await;
        let category =
            CategoryService::get_or_create(runner.context(), site_id, &category_name)
                .await
                .expect("data-form target category should be created");
        grant_category_permission(
            &runner,
            site_id,
            category.category_id,
            &format!("{category_name}-creators"),
            Action::Create,
            &[ADMIN_USER_ID],
        )
        .await;
        run_endpoint!(
            runner,
            category_update,
            json!({
                "site": site_id,
                "category": category.category_id,
                "user_id": ADMIN_USER_ID,
                "template_page_id": template.page_id,
                "ip_address": common::IP_ADDRESS,
            }),
        );

        let create_slug = format!("{category_name}:new");
        let definition = match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": session_token,
                "route": { "slug": create_slug, "extra": "/edit/true" },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Missing {
                data_form: Some(data_form),
                ..
            } => data_form.definition,
            other => panic!("expected {field_type} create definition, got {other:?}"),
        };
        assert_eq!(definition.fields.len(), 1);
        let scalar = definition.field("scalar").expect("scalar field");
        assert_eq!(scalar.field_type.as_deref(), Some(field_type));
        assert_eq!(scalar.configured_value.as_deref(), configured_value);

        let saved_slug = format!("{category_name}:saved");
        create_page(&mut runner, site_id, &saved_slug, saved_source).await;
        let editor = match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": session_token,
                "route": { "slug": saved_slug, "extra": "/edit" },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Found {
                data_form: Some(data_form),
                ..
            } => data_form,
            other => panic!("expected {field_type} edit definition, got {other:?}"),
        };
        let expected_value = match field_type {
            "hidden" => "HIDDEN_CONFIGURED_ALPHA",
            "password" => "NONSECRET_PASSWORD_ALPHA",
            "static" => "STATIC **BOLD** ALPHA",
            "url" => "example.com/alpha",
            _ => unreachable!(),
        };
        assert_eq!(
            editor.values.get("scalar").map(String::as_str),
            Some(expected_value)
        );

        let rendered_html = match run_endpoint!(
            runner,
            page_view,
            json!({
                "site_id": site_id,
                "session_token": null,
                "route": { "slug": saved_slug, "extra": "" },
                "locales": ["en-US", "en"],
            }),
        ) {
            GetPageViewOutput::Found {
                data_form: None,
                compiled_body_html,
                ..
            } => compiled_body_html,
            other => panic!("expected {field_type} rendered page, got {other:?}"),
        };
        match field_type {
            "hidden" => assert!(
                rendered_html.contains("Hidden &lt;scalar&gt;")
                    && rendered_html.contains("HIDDEN_CONFIGURED_ALPHA"),
                "{rendered_html}",
            ),
            "password" => assert!(
                rendered_html.contains("************************")
                    && !rendered_html.contains("NONSECRET_PASSWORD_ALPHA"),
                "password display must be masked: {rendered_html}",
            ),
            "static" => assert!(
                rendered_html.contains(r#"<div class="form-value field-scalar">"#)
                    && rendered_html.contains("<strong>BOLD</strong>"),
                "static configured wiki must use the trusted renderer: {rendered_html}",
            ),
            "url" => assert!(
                rendered_html.contains(
                    r#"<a href="http://example.com/alpha">http://example.com/alpha</a>"#,
                ),
                "bare URL display must normalize without changing source: {rendered_html}",
            ),
            _ => unreachable!(),
        }
    }

    let unsupported_template = create_page(
        &mut runner,
        site_id,
        "data-form-scalar-unsupported:_template",
        "[[form]]\nfields:\n  scalar:\n    type: hidden\n[[/form]]",
    )
    .await;
    let unsupported_category = CategoryService::get_or_create(
        runner.context(),
        site_id,
        "data-form-scalar-unsupported",
    )
    .await
    .expect("unsupported data-form category should be created");
    grant_category_permission(
        &runner,
        site_id,
        unsupported_category.category_id,
        "data-form-scalar-unsupported-creators",
        Action::Create,
        &[ADMIN_USER_ID],
    )
    .await;
    run_endpoint!(
        runner,
        category_update,
        json!({
            "site": site_id,
            "category": unsupported_category.category_id,
            "user_id": ADMIN_USER_ID,
            "template_page_id": unsupported_template.page_id,
            "ip_address": common::IP_ADDRESS,
        }),
    );
    match run_endpoint!(
        runner,
        page_view,
        json!({
            "site_id": site_id,
            "session_token": session_token,
            "route": {
                "slug": "data-form-scalar-unsupported:new",
                "extra": "/edit/true"
            },
            "locales": ["en-US", "en"],
        }),
    ) {
        GetPageViewOutput::Missing {
            data_form: None, ..
        } => {}
        other => {
            panic!("hidden fields without configured values must fail closed: {other:?}")
        }
    }
}
