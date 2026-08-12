## Audit Log

Wikijump supports a platform audit log, which is an append-only record of various mutation events. All entries are added to the `audit_log` table, where the data shape depends on the event type.

Note that the `audit_log` table is implemented using a variety of nullable columns. For a particular event type, some fields are nullable and the miscellaneous fields are given a particular meaning. Any non-nullable fields are set for all event types.

Additionally, for performance reasons, this table does not use foreign keys in Postgres itself, though the code must ensure this invariant regardless.

All event types take the form `[object].[operation]`, describing the data object being acted on and the kind of operation or event that has occurred.

This file will document all event types, describe their data, and explain when this auditing event is raised.

| Event Type            | Normal Columns                    | `extra_id_1`  | `extra_id_2`  | `extra_string_1`  | `extra_string_2`  | `extra_number`    | Notes |
|-----------------------|-----------------------------------|---------------|---------------|-------------------|-------------------|-------------------| ------|
| `user.create`         | `user_id`                         |               |               |                   |                   |                   |       |
| `user.update`         | `user_id`                         |               |               | Previous fields   | Changed fields    |                   | Both "fields" strings are JSON objects. See the audit services for the shape of this object. |
| `user.update_mfa`     | `user_id`                         |               |               | Update type       |                   |                   | This simply notes when/where the MFA secrets were updated. "Update type" is a string enum. |
| `user.delete`         | `user_id`                         | Target user ID|               |                   |                   |                   | `user_id` is the authenticated actor. The `user_delete` request requires `ip_address`; the entry records that supplied request IP and is emitted only when that request successfully transitions the target from active to deleted. |
| `site.create`         | `site_id`                         |               |               |                   |                   |                   |       |
| `site.update`         | `user_id`, `site_id`,             |               |               | Previous fields   | Changed fields    |                   | Both "fields" strings are JSON objects. Very similar to `user.update`. |
| `page.create`         | `user_id`, `site_id`, `page_id`   | Revision ID   | Category ID   |                   |                   |                   |       |
| `page.edit`           | `user_id`, `site_id`, `page_id`   | Revision ID   |               |                   |                   |                   | The revision ID can be `NULL` if the edit did not result in a new revision being created. |
| `page.move`           | `user_id`, `site_id`, `page_id`   | Revision ID   |               | Old Page Slug     | New Page Slug     |                   |       |
| `page.delete`         | `user_id`, `site_id`, `page_id`   | Revision ID   |               | Page Slug         |                   |                   | "Page slug" is the page's slug at the time of deletion. |
| `page.undelete`       | `user_id`, `site_id`, `page_id`   | Revision ID   | Category ID   | Page Slug         |                   |                   | "Page slug" is the location the page is being restored to. |
| `page.rollback`       | `user_id`, `site_id`, `page_id`   | Revision ID   | Category ID   |                   |                   | Revision number   | "Revision number" is the revision the page is being rolled back to. |
| `page.undo`           | `user_id`, `site_id`, `page_id`   | Revision ID   | Category ID   |                   |                   | Revision number   | "Revision number" is the revision's changes being undone. **This operation is not implemented yet.** |
| `page_layout.update`  | `user_id`, `site_id`, `page_id`   |               |               | Layout value      |                   |                   | "Layout value" is the `ftml::Layout::value()` string. The layout value can be `NULL`. |
| `page_lock.create`    | `user_id`, `site_id`, `page_id`   | Lock ID       |               | Lock type         |                   |                   |       |
| `page_lock.remove`    | `user_id`, `site_id`, `page_id`   | Lock ID       |               | Lock type         |                   |                   |       |
