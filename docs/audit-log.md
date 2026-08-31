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
| `site.create`         | `user_id`, `site_id`              |               |               |                   |                   |                   | A successful public `site_create` records the authenticated request actor in `user_id` and the supplied request IP. Internal and seeder calls without a legitimate actor record `user_id` as `NULL`. The event is inserted after the site, site user, and site-user relation in the same database transaction; failed and rolled-back creations leave no event. |
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
| `file.create`         | `user_id`, `site_id`, `page_id`   | File ID       | First revision ID |                 |                   |                   | Emitted after the first revision is created in the same database transaction. The entry records the request's supplied IP address. |
| `file.edit`           | `user_id`, `site_id`, `page_id`   | File ID       | Revision ID   |                   |                   |                   | Emitted after a regular edit creates a revision in the same database transaction, using the supplied IP. Denied, failed, stale, no-op, and rolled-back edits leave no event. |
| `file.undelete`       | `user_id`, `site_id`, `page_id`   | File ID       | Revision ID   |                   |                   |                   | `page_id` is the file's resulting parent page and revision ID is the resurrection revision. The registered `file_restore` request supplies the recorded IP. Restore attempts serialize on the file row before rechecking deleted state. Each committed deleted-to-active transition inserts one event after the state update in the same request transaction; denied, failed, repeated, and rolled-back restores leave no event. |
| `file.rollback`       | `user_id`, `site_id`, `page_id`   | File ID       | Revision ID   |                   |                   | Revision number   | The registered public `file_rollback` request supplies the authenticated actor and recorded IP. Revision ID is the newly created rollback revision, and revision number is the requested target revision number. The event is inserted after the file state update in the same transaction only when rollback creates a revision; denied, failed, stale, no-op, and rolled-back attempts leave no event. |
