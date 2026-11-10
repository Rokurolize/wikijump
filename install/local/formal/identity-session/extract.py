#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
SESSION = "deepwell/src/services/session/service.rs"
AUTH = "deepwell/src/endpoints/auth.rs"
API = "deepwell/src/api.rs"
MFA = "deepwell/src/services/mfa/service.rs"
USER = "deepwell/src/services/user/service.rs"
EMAIL = "deepwell/src/services/email/email_token.rs"
EMAIL_EP = "deepwell/src/endpoints/email.rs"
PERM_CACHE = "deepwell/src/services/permission/cache.rs"
PERM = "deepwell/src/services/permission/service.rs"
LOGIN = "framerail/src/lib/server/load/login.ts"
GET_SESSION = "framerail/src/lib/server/auth/get-session.ts"
EMAIL_UI = "framerail/src/lib/server/load/email-token.ts"
SLUG_SQL = "deepwell/migrations/20261105010000_user_slug_active_unique.sql"
EMAIL_SQL = "deepwell/migrations/20261105020000_user_email_active_unique.sql"


class ModelDrift(Exception):
    pass


def lines(path: str) -> list[str]:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8").splitlines()


def text_of(path: str) -> str:
    return "\n".join(lines(path))


def fn_body(path: str, signature: str) -> tuple[int, list[str]]:
    src = lines(path)
    starts = [i for i, line in enumerate(src) if signature in line]
    if len(starts) != 1:
        raise ModelDrift(f"{path}: expected one '{signature}', found {len(starts)}")
    start = starts[0]
    indent = len(src[start]) - len(src[start].lstrip())
    fn_re = re.compile(r"^\s*(pub(\([a-z]+\))? )?(async )?fn ")
    end = len(src)
    for i in range(start + 1, len(src)):
        line = src[i]
        if fn_re.match(line) and len(line) - len(line.lstrip()) <= indent:
            end = i
            break
    return start + 1, src[start:end]


def rust(path: str, signature: str) -> tuple[int, str]:
    start, body = fn_body(path, signature)
    return start, "\n".join(body)


def require(path: str, start: int, body: str, needle: str) -> None:
    if needle not in body:
        raise ModelDrift(f"{path}:{start}: missing '{needle}'")


def ts_fn(path: str, signature: str) -> tuple[int, str]:
    src = lines(path)
    starts = [i for i, line in enumerate(src) if signature in line]
    if len(starts) != 1:
        raise ModelDrift(f"{path}: expected one '{signature}', found {len(starts)}")
    start = starts[0]
    end = len(src)
    for i in range(start + 1, len(src)):
        if re.match(r"^(export )?(async )?function ", src[i]):
            end = i
            break
    return start + 1, "\n".join(src[start:end])


def flag(present: bool) -> str:
    return "TRUE" if present else "FALSE"


def session_constants(facts: list[str]) -> dict[str, bool]:
    start, body = rust(SESSION, "pub async fn get_optional(")
    require(SESSION, start, body, "get_optional_matching_restricted(ctx, session_token,")
    invisible = "get_optional_matching_restricted(ctx, session_token, false)" in body
    visible = "get_optional_matching_restricted(ctx, session_token, true)" in body
    if invisible == visible:
        raise ModelDrift(f"{SESSION}:{start}: restricted flag on get_optional is neither false nor true")
    facts.append(f"session get {SESSION}:{start} restricted_invisible={invisible}")

    login_start, login = rust(AUTH, "pub async fn auth_login(")
    require(AUTH, login_start, login, "restricted: !login_complete")
    facts.append(f"login restricted {AUTH}:{login_start}")

    mfa_start, mfa_login = rust(AUTH, "pub async fn auth_mfa_verify(")
    require(AUTH, mfa_start, mfa_login, "SessionService::renew_restricted(")
    facts.append(f"mfa renew {AUTH}:{mfa_start}")

    build_start, build = rust(API, "async fn build_request(")
    require(API, build_start, build, "SessionService::get_optional(ctx, token)")
    facts.append(f"request session {API}:{build_start}")

    session_get_start, session_get = rust(AUTH, "pub async fn auth_session_get(")
    require(AUTH, session_get_start, session_get, "SessionService::get_optional(ctx, &session_token)")
    facts.append(f"session_get {AUTH}:{session_get_start}")

    step_start, step = rust(USER, "pub async fn advance_mfa_last_totp_step(")
    require(USER, step_start, step, "rows_affected > 0")
    advances = "MultiFactorLastTotpStep.lt(step)" in step
    facts.append(f"totp step {USER}:{step_start} advances={advances}")

    verify_start, verify = rust(MFA, "pub async fn verify(")
    require(MFA, verify_start, verify, "advance_mfa_last_totp_step(")
    require(MFA, verify_start, verify, "if advanced")
    facts.append(f"totp verify {MFA}:{verify_start}")

    ui_start, ui = ts_fn(LOGIN, "export async function loginAction(")
    cookie_gated = "!res.needs_mfa" in ui and ui.count("setAuthenticatedSessionCookie") == 2
    if "setAuthenticatedSessionCookie" not in ui or "authMfaVerify" not in ui:
        raise ModelDrift(f"{LOGIN}:{ui_start}: login action lost MFA verify or the session cookie write")
    if ui.find("authMfaVerify") > ui.find("setAuthenticatedSessionCookie"):
        raise ModelDrift(f"{LOGIN}:{ui_start}: session cookie is written before authMfaVerify")
    facts.append(f"login cookie {LOGIN}:{ui_start} only_after_factors={cookie_gated}")

    resolve_start, resolve = ts_fn(GET_SESSION, "export async function resolveCookieSessionToken(")
    require(GET_SESSION, resolve_start, resolve, "if (session) return sessionToken")
    clears = "deleteSessionCookie" in resolve
    throw_at = resolve.find("if (!isInvalidSessionTokenError(error)) throw error")
    delete_at = resolve.find("deleteSessionCookie")
    if throw_at < 0 or delete_at < 0:
        retains = False
        if not clears:
            facts.append(f"cookie resolve {GET_SESSION}:{resolve_start} clears_dead=False retains_fault=False")
        else:
            facts.append(f"cookie resolve {GET_SESSION}:{resolve_start} clears_dead=True retains_fault=False")
    else:
        retains = throw_at < delete_at
        facts.append(
            f"cookie resolve {GET_SESSION}:{resolve_start} clears_dead={clears} retains_fault={retains}"
        )
    return {
        "RestrictedInvisible": invisible,
        "CookieOnlyAfterFactors": cookie_gated,
        "ClearDeadCookie": clears,
        "RetainFaultCookie": retains,
        "StepAdvances": advances,
    }


def account_constants(facts: list[str]) -> dict[str, bool]:
    slug_sql = text_of(SLUG_SQL)
    email_sql = text_of(EMAIL_SQL)
    if "WHERE deleted_at IS NULL" not in slug_sql:
        raise ModelDrift(f"{SLUG_SQL}: live slug index lost its deleted_at predicate")
    if "deleted_at IS NULL" not in email_sql or "email <> ''" not in email_sql:
        raise ModelDrift(f"{EMAIL_SQL}: live email index lost its live-address predicate")
    slug_unique = "CREATE UNIQUE INDEX user_slug_active_unique_idx" in slug_sql
    email_unique = "CREATE UNIQUE INDEX user_email_active_unique_idx" in email_sql
    facts.append(f"slug index {SLUG_SQL} unique={slug_unique}")
    facts.append(f"email index {EMAIL_SQL} unique={email_unique}")

    create_start, create = rust(USER, "async fn create_internal(")
    require(USER, create_start, create, "user::Column::Slug.eq(slug.as_str())")
    require(USER, create_start, create, "user::Column::Email.eq(email.as_str())")
    require(USER, create_start, create, "user::Column::DeletedAt.is_null()")
    facts.append(f"create lookup {USER}:{create_start}")

    rename_start, rename = rust(USER, "async fn update_name(")
    require(USER, rename_start, rename, "user::Column::Slug.eq(new_slug.as_str())")
    require(USER, rename_start, rename, "user::Column::DeletedAt.is_null()")
    facts.append(f"rename lookup {USER}:{rename_start}")

    delete_start, delete = rust(USER, "pub async fn delete(")
    deletes = "user::Column::DeletedAt, Expr::value(Some(now()))" in delete
    if not deletes and "DeletedAt" not in delete:
        raise ModelDrift(f"{USER}:{delete_start}: delete no longer mentions DeletedAt")
    facts.append(f"delete {USER}:{delete_start} marks_deleted={deletes}")

    update_start, update = rust(USER, "pub async fn update(")
    require(USER, update_start, update, "displace_pending_email_claims(")
    displace_start, displace = rust(USER, "async fn displace_pending_email_claims(")
    require(USER, displace_start, displace, "email: Set(String::new())")
    facts.append(f"verify displace {USER}:{update_start}")
    return {
        "SlugUnique": slug_unique,
        "EmailUnique": email_unique,
        "DeleteMarks": deletes,
    }


def token_constants(facts: list[str]) -> dict[str, bool]:
    redeem_start, redeem = rust(EMAIL, "async fn redeem_as<")
    require(EMAIL, redeem_start, redeem, "rows_affected != 1")
    consume = "ConsumedAt.is_null()" in redeem
    facts.append(f"redeem {EMAIL}:{redeem_start} consume_once={consume}")

    reset_start, reset = rust(EMAIL_EP, "pub async fn password_reset_complete(")
    reset_grant = "EmailTokenService::redeem_grant(" in reset and "GrantTokenPurpose::ResetGrant" in reset
    if "redeem_link(" in reset:
        reset_grant = False
    facts.append(f"reset complete {EMAIL_EP}:{reset_start} grant={reset_grant}")

    delete_start, delete = rust(EMAIL_EP, "async fn verify_account_deletion(")
    delete_grant = (
        "EmailTokenService::redeem_grant(" in delete and "GrantTokenPurpose::DeleteGrant" in delete
    )
    if "redeem_link(" in delete:
        delete_grant = False
    facts.append(f"delete complete {EMAIL_EP}:{delete_start} grant={delete_grant}")

    issue_start, issue = rust(EMAIL_EP, "pub async fn password_reset_redeem(")
    require(EMAIL_EP, issue_start, issue, "EmailTokenService::redeem_link(")
    require(EMAIL_EP, issue_start, issue, "EmailTokenService::issue_grant(")
    facts.append(f"reset redeem {EMAIL_EP}:{issue_start}")

    ui_reset_start, ui_reset = ts_fn(EMAIL_UI, "export async function resetCompleteAction(")
    ui_delete_start, ui_delete = ts_fn(EMAIL_UI, "export async function deleteCompleteAction(")
    client_reset = (
        "passwordResetComplete" in ui_reset
        and "grant: form.data.grant" in ui_reset
        and "passwordResetRedeem" not in ui_reset
    )
    client_delete = (
        "accountDeleteComplete" in ui_delete
        and "grant: form.data.grant" in ui_delete
        and "accountDeleteRedeem" not in ui_delete
    )
    facts.append(f"reset ui {EMAIL_UI}:{ui_reset_start} grant={client_reset}")
    facts.append(f"delete ui {EMAIL_UI}:{ui_delete_start} grant={client_delete}")
    return {
        "ConsumeOnce": consume,
        "CompleteRequiresGrant": reset_grant and delete_grant and client_reset and client_delete,
    }


def permission_constants(facts: list[str]) -> dict[str, bool]:
    batch_start, batch = rust(PERM, "pub async fn batch_check_user_can<")
    helper_start, helper = rust(PERM, "pub(crate) async fn permission_in_set_helper(")
    if "get_permissions_for_user(" not in batch:
        raise ModelDrift(f"{PERM}:{batch_start}: batch check no longer loads permissions")
    if "permission_in_set_helper(" not in batch:
        raise ModelDrift(f"{PERM}:{batch_start}: batch check no longer calls the helper")
    if "PermissionCache::cache_fence(" not in helper or "evaluate_in_permission_set(" not in helper:
        raise ModelDrift(f"{PERM}:{helper_start}: helper lost the fence sample or the evaluate")
    load_at = batch.find("get_permissions_for_user(")
    call_at = batch.find("permission_in_set_helper(")
    fence_at = helper.find("PermissionCache::cache_fence(")
    eval_at = helper.find("evaluate_in_permission_set(")
    reloads_after = "get_permissions_for_user(" in helper[fence_at:]
    read_before = load_at < call_at and fence_at < eval_at and not reloads_after
    facts.append(f"permission order {PERM}:{batch_start} read_before_fence={read_before}")

    set_start, set_body = rust(PERM_CACHE, "pub async fn set_user_permission_if_fence_current(")
    cas = "site_version == ARGV[1] and user_version == ARGV[2]" in set_body and "SETEX" in set_body
    facts.append(f"permission cas {PERM_CACHE}:{set_start} guards={cas}")

    key_start, key = rust(PERM_CACHE, "fn site_user_permission_key(")
    keyed = "fence.site_version" in key and "fence.user_version" in key
    facts.append(f"permission key {PERM_CACHE}:{key_start} has_fence={keyed}")
    return {
        "ReadBeforeFence": read_before,
        "CasGuards": cas,
        "KeyHasFence": keyed,
    }


def write_cfg(out: Path, name: str, constants: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in constants], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        session = session_constants(facts)
        account = account_constants(facts)
        token = token_constants(facts)
        permission = permission_constants(facts)
    except ModelDrift as error:
        print(f"MODEL DRIFT: {error}", file=sys.stderr)
        print(
            "The code no longer matches the anchors the model was built from; review the model.",
            file=sys.stderr,
        )
        return 2
    for fact in facts:
        print(fact)
    print(
        "model "
        + ", ".join(f"{key}={value}" for key, value in {**session, **account, **token, **permission}.items())
    )
    if out:
        write_cfg(
            out,
            "session.cfg",
            [f"{key} = {flag(value)}" for key, value in session.items()],
        )
        write_cfg(
            out,
            "account.cfg",
            [
                "Users = {u1, u2}",
                f"SlugUnique = {flag(account['SlugUnique'])}",
                f"EmailUnique = {flag(account['EmailUnique'])}",
                f"DeleteMarks = {flag(account['DeleteMarks'])}",
            ],
        )
        write_cfg(
            out,
            "token.cfg",
            [f"{key} = {flag(value)}" for key, value in token.items()],
        )
        write_cfg(
            out,
            "permission.cfg",
            [f"{key} = {flag(value)}" for key, value in permission.items()],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
