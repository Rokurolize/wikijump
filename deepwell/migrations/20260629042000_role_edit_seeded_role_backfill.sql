INSERT INTO role_permission (
    role_id,
    site_id,
    resource_type,
    resource_category_id,
    action
)
-- Preserve upgrade behavior for existing seeded full-administrator roles by
-- backfilling Role:Edit only to the built-in root/admin role names that
-- already had Role:Assign before this permission split. Do not infer full
-- role-administration authority from Role:Assign alone: sites may delegate
-- Role:Assign for membership management without intending Role:Edit.
SELECT DISTINCT
    role_permission.role_id,
    role_permission.site_id,
    'role',
    NULL::BIGINT,
    'edit'
FROM role_permission
INNER JOIN role
    ON role.role_id = role_permission.role_id
    AND role.site_id = role_permission.site_id
WHERE
    role_permission.resource_type = 'role'
    AND role_permission.resource_category_id IS NULL
    AND role_permission.action = 'assign'
    AND role.deleted_at IS NULL
    AND role.name IN ('root', 'admin')
    AND NOT EXISTS (
        SELECT 1
        FROM role_permission existing_role_edit
        WHERE
            existing_role_edit.role_id = role_permission.role_id
            AND existing_role_edit.site_id = role_permission.site_id
            AND existing_role_edit.resource_type = 'role'
            AND existing_role_edit.resource_category_id IS NULL
            AND existing_role_edit.action = 'edit'
    );
