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
use deepwell::services::RequestContext;
use deepwell::services::SessionService;
use deepwell::services::category::CategoryService;
use deepwell::services::page::CreatePageOutput;
use deepwell::services::permission::{CheckPermissionContext, PermissionService};
use deepwell::services::role::{
    GrantUserRoleInput, InternalCreateRoleInput, RoleService, UpdateRolePermissionsInput,
};
use deepwell::services::session::CreateSession;
use deepwell::services::view::{GetPageViewOutput, PageTemplateSummary};
use deepwell::types::{Action, Permission, Reference, Resource};
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
