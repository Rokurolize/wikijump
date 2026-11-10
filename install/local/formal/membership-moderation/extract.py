#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
MEMBER = "deepwell/src/services/relation/site_member.rs"
BAN = "deepwell/src/services/relation/site_ban.rs"
MEMBERSHIP = "deepwell/src/services/membership/service.rs"
ROLE = "deepwell/src/services/role/service.rs"
PERMISSION = "deepwell/src/services/permission/service.rs"


class ModelDrift(Exception):
    pass


def lines(path: str) -> list[str]:
    file = ROOT / path
    if not file.is_file():
        raise ModelDrift(f"{path}: missing")
    return file.read_text(encoding="utf-8").splitlines()


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


def text(path: str, signature: str) -> tuple[int, str]:
    start, body = fn_body(path, signature)
    return start, "\n".join(body)


def require(path: str, start: int, body: str, needle: str) -> None:
    if body.count(needle) < 1:
        raise ModelDrift(f"{path}:{start}: missing '{needle}'")


def flag(present: bool) -> str:
    return "TRUE" if present else "FALSE"


def before(body: str, earlier: str, later: str) -> bool:
    left = body.find(earlier)
    right = body.find(later)
    return left >= 0 and right > left


def membership_constants(facts: list[str]) -> dict[str, bool]:
    start, body = text(MEMBER, "pub async fn create_site_member(")
    require(MEMBER, start, body, "create_site_member_inner(")
    blocks = "check_site_ban(" in body and before(
        body, "check_site_ban(", "create_site_member_inner("
    )
    facts.append(f"create member {MEMBER}:{start} ban_blocks_create={blocks}")

    ban_start, ban = text(BAN, "pub async fn create_site_ban(")
    require(BAN, ban_start, ban, "create_site_ban_inner(")
    guard = "banned_until >= now().date()"
    if "remove_site_member(" in ban and not before(ban, guard, "remove_site_member("):
        raise ModelDrift(f"{BAN}:{ban_start}: membership clear left the active-ban branch")
    if "revoke_role_from_user(" in ban and not before(ban, guard, "revoke_role_from_user("):
        raise ModelDrift(f"{BAN}:{ban_start}: role revoke left the active-ban branch")
    clears_member = before(ban, "remove_site_member(", "create_site_ban_inner(") and before(
        ban, guard, "remove_site_member("
    )
    clears_roles = before(ban, "revoke_role_from_user(", "create_site_ban_inner(") and before(
        ban, guard, "revoke_role_from_user("
    )
    facts.append(
        f"create ban {BAN}:{ban_start} clears_member={clears_member} clears_roles={clears_roles}"
    )

    lift_start, lift = text(BAN, "pub async fn lift_expired_site_ban_if_current(")
    require(BAN, lift_start, lift, "banned_until > now().date()")
    require(BAN, lift_start, lift, "RelationType::SiteBan")
    current_only = (
        "relation::Column::RelationId.eq(site_ban.relation_id)" in lift
        and "relation::Column::OverwrittenAt.is_null()" in lift
        and "relation::Column::DeletedAt.is_null()" in lift
        and "0 => return Ok(false)" in lift
    )
    facts.append(f"lift expired {BAN}:{lift_start} current_only={current_only}")

    grant_start, grant = text(ROLE, "pub async fn grant_role_to_user(")
    require(ROLE, grant_start, grant, ".insert(txn)")
    grant_blocked = before(grant, "check_site_ban(", ".insert(txn)")
    facts.append(f"grant role {ROLE}:{grant_start} blocked_by_ban={grant_blocked}")

    invite_start, invite = text(MEMBERSHIP, "async fn email_invitation_row(")
    invite_once = "accepted = FALSE" in invite
    facts.append(f"invitation row {MEMBERSHIP}:{invite_start} once={invite_once}")

    review_start, review = text(MEMBERSHIP, "pub async fn review_application(")
    require(MEMBERSHIP, review_start, review, "MembershipApplicationReviewDecision::Accept")
    review_once = "current.status != MembershipApplicationStatus::Pending" in review
    facts.append(f"review application {MEMBERSHIP}:{review_start} once={review_once}")

    return {
        "BanBlocksCreate": blocks,
        "BanClearsMember": clears_member,
        "BanClearsRoles": clears_roles,
        "CleanupCurrentOnly": current_only,
        "GrantBlockedByBan": grant_blocked,
        "InviteOnce": invite_once,
        "ReviewOnce": review_once,
    }


def forest_constants(facts: list[str]) -> dict[str, bool]:
    edit_start, edit = text(PERMISSION, "pub async fn update_permissions_for_role(")
    require(PERMISSION, edit_start, edit, "RolePermission::delete_many()")
    parent_guard = "!resolved_permissions.is_subset(&parent_perms)" in edit
    child_guard = "!child_perms.is_subset(&resolved_permissions)" in edit
    cascade = "cascade_permission_removals(" in edit
    facts.append(
        f"edit permissions {PERMISSION}:{edit_start} parent={parent_guard} child={child_guard} cascade={cascade}"
    )

    cycle_start, cycle = text(ROLE, "async fn validate_reparent_no_cycle(")
    cycle_guard = "pid == role_id" in cycle
    facts.append(f"reparent cycle {ROLE}:{cycle_start} guard={cycle_guard}")

    subset_start, subset = text(ROLE, "async fn validate_child_role_subset_of_parent(")
    subset_guard = "!child_permissions.is_subset(&parent_permissions)" in subset
    facts.append(f"reparent subset {ROLE}:{subset_start} guard={subset_guard}")

    reparent_start, reparent = text(ROLE, "pub async fn reparent_role(")
    require(ROLE, reparent_start, reparent, "parent_role_id: Set(new_parent_id)")
    live_parent = "parent_role.deleted_at.is_some()" in reparent
    facts.append(f"reparent {ROLE}:{reparent_start} live_parent={live_parent}")

    delete_start, delete = text(ROLE, "pub async fn delete(")
    require(ROLE, delete_start, delete, "deleted_at: Set(Some(now()))")
    keeps_parent = (
        "if !child_roles.is_empty()" in delete
        and "if reparent_children" in delete
        and "DeleteRoleWithChildren" in delete
        and "ParentRoleId" in delete
    )
    facts.append(f"delete role {ROLE}:{delete_start} keeps_live_parent={keeps_parent}")

    return {
        "ParentEditGuard": parent_guard,
        "ChildEditGuard": child_guard,
        "CascadeRemoves": cascade,
        "ReparentCycleGuard": cycle_guard,
        "ReparentSubsetGuard": subset_guard,
        "ReparentLiveParent": live_parent,
        "DeleteKeepsLiveParent": keeps_parent,
    }


def write_cfg(out: Path, name: str, constants: list[str]) -> None:
    out.mkdir(parents=True, exist_ok=True)
    body = "\n".join(["CONSTANTS", *[f"  {line}" for line in constants], ""])
    (out / name).write_text(body, encoding="utf-8")


def main() -> int:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    facts: list[str] = []
    try:
        member = membership_constants(facts)
        forest = forest_constants(facts)
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
        + ", ".join(f"{key}={value}" for key, value in {**member, **forest}.items())
    )
    if out:
        write_cfg(
            out,
            "member.cfg",
            [f"{key} = {flag(value)}" for key, value in member.items()],
        )
        write_cfg(
            out,
            "forest.cfg",
            [f"{key} = {flag(value)}" for key, value in forest.items()],
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
