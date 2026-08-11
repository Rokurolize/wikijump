UPDATE role
SET is_virtual = TRUE
WHERE name = 'member'
    AND deleted_at IS NULL;
