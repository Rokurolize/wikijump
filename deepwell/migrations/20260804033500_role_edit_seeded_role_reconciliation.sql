-- The preceding backfill migration is immutable and may already have run on
-- an existing database. Remove only the Role:Edit rows that match the broad
-- Role:Assign-derived shape it inserted for non-seeded roles. The seeded
-- root/admin roles retain their Role:Edit permission.
DELETE FROM role_permission AS target_role_permission
USING role
WHERE
    target_role_permission.role_id = role.role_id
    AND target_role_permission.site_id = role.site_id
    AND target_role_permission.resource_type = 'role'
    AND target_role_permission.resource_category_id IS NULL
    AND target_role_permission.action = 'edit'
    AND role.name NOT IN ('root', 'admin')
    AND role.deleted_at IS NULL
    AND EXISTS (
        SELECT 1
        FROM role_permission
        WHERE
            role_permission.role_id = target_role_permission.role_id
            AND role_permission.site_id = target_role_permission.site_id
            AND role_permission.resource_type = 'role'
            AND role_permission.resource_category_id IS NULL
            AND role_permission.action = 'assign'
    );
