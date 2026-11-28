### Base localization / generic strings
### Messages should only go into this file if they are widely used,
### or are particularly important to localize.

## Terms

-service-name = Wikijump

## Special

# Shows whenever a message is still being loaded
message-loading = Loading...

goto-home = Go to home page

goto-service = Go to { -service-name }

base-title = { $title } | { -service-name }

navigated-to = Navigated to { $path }

## Generic

about = About

about-info = Platform information
    .backend = Backend
    .frontend = Frontend
    .package-name = Package name
    .package-description = Package description
    .package-license = Package license
    .package-repository = Package repository
    .package-version = Package version
    .rustc-version = Rustc version
    .cargo-version = Cargo version
    .built-at = Built at
    .git-commit = Git commit
    .ftml-commit = FTML commit
    .blurb = Wikijump is a free, open-source platform for collaborative fiction and worldbuilding: a modern replacement for Wikidot, developed by the Wikijump Team and the SCP community.
    .blog = Wikijump blog
    .node-version = Node version
    .pnpm-version = Pnpm version
account = Account
alt-title = Alternative Title
applications = Applications
avatar = Avatar
breadcrumbs = Breadcrumbs
cancel = Cancel
change = Change
children = Children
clear = clear
close = Close
confirm = Confirm
dashboard = Dashboard
delete = Delete
docs = Docs
download = Download
edit = Edit
editor = Editor
error = Error
files = Files
footer = Page Footer
general = General
header = Page Header
help = Help
history = History
inbox = Inbox
invitations = Invitations
layout = Layout
load = Load
main-content = Main Content
messages = Messages
move = Move
navigation = Navigation
notifications = Notifications
options = Options
parents = Parents
preview = Preview
privacy = Privacy
profile = Profile
publish = Publish
restore = Restore
reveal-sidebar = Reveal Sidebar
save = Save
security = Security
send = Send
sent = Sent
settings = Settings
sidebar = Sidebar
tags = Tags
terminology = Terms
terms-conditions = Terms
title = Title
upload = Upload
view = View
vote = Vote

search = Search
  .placeholder = Search...

## Generic Authentication

login = Login
  .toast = You have been logged in.

logout = Logout
  .toast = You have been logged out.

register = Register
  .toast = You have been registered.
  .disabled-notice = Account creation is not available on this Wikijump instance. Accounts are created by the instance administrators.
  .legal-notice = By creating an account you accept our{ " " }
  .legal-terms = Terms of Service
  .legal-conjunction = { " " }and{ " " }
  .legal-privacy = Privacy Policy
  .legal-suffix = .

specifier = Email or Username
  .placeholder = Enter email or username...

mfa-code = MFA code

username = Username
  .placeholder = Enter username...
  .info = You will be able to change this later.

email = Email
  .placeholder = Enter email address...
  .info = Your email address is private.

password = Password
  .placeholder = Enter password...

confirm-password = Confirm Password

forgot-password = Forgot Password
  .question = Forgot your password?

reset-password = Reset Password

remember-me = Remember me

create-account = Create Account

field-required = This field is required

characters-left = { $count ->
  [1] 1 character left
  *[other] { $count } characters left
}

hold-to-show-password = Hold to show password

## Errors

error-404 =
  .generic = The requested resource was not found.
  .page = The requested page was not found.
  .user = The requested user was not found.

error-form =
  .missing-fields = Please fill in all the required fields.
  .password-mismatch = Passwords do not match.
  .password-too-short = Password must contain at least 15 characters.
  .email-invalid = The email address is invalid.

error-api =
  .GENERIC = Something went wrong with your request.
  .INTERNAL = An internal server error has occurred. Please try again later.
  .NO_CONNECTION = You are not connected to the internet.
  .BAD_SYNTAX = The request could not be understood by the server.
  .FORBIDDEN = You are not authorized to perform this action.
  .NOT_FOUND = The requested resource was not found.
  .CONFLICT = The requested resource is in conflict with another resource.

  .ACCOUNT_ALREADY_VERIFIED = This account has already been verified.
  .ACCOUNT_NO_EMAIL = This account does not have an email address.
  .ALREADY_LOGGED_IN = You are already logged in.
  .FAILED_TO_UPDATE_PROFILE = Failed to update profile.
  .INVALID_AVATAR = The uploaded file is not a valid image.
  .INVALID_EMAIL = The email address is invalid.
  .INVALID_LANGUAGE_CODE = The language code is invalid.
  .INVALID_PASSWORD = The password is invalid.
  .INVALID_SESSION = Your session has expired. Please log in again.
  .INVALID_SPECIFIER = The email or username is invalid.
  .INVALID_USERNAME = The username is invalid.
  .LOGIN_FAILED = Failed to log in. Please check your credentials.
  .NOT_LOGGED_IN = You are not logged in.
  .UNKNOWN_EMAIL = There is no account with that email address.
  .UNKNOWN_USER = There is no account with that username.
  .WRONG_PASSWORD = The password is incorrect.

error-418 = I'm a Teapot
### Editor UI (ED-9)

editor-toolbar-label = Wikitext source editing toolbar
editor-toolbar-note = Source editing: buttons insert or wrap Wikidot source; they do not create WYSIWYG output, and the text source remains authoritative. Shortcuts: Ctrl/Cmd+B bold, Ctrl/Cmd+I italic, Ctrl/Cmd+K link. Other shortcuts are listed in button tooltips.
editor-toolbar-heading1 = Heading level 1
editor-toolbar-heading2 = Heading level 2
editor-toolbar-heading3 = Heading level 3
editor-toolbar-heading4 = Heading level 4
editor-toolbar-heading5 = Heading level 5
editor-toolbar-heading6 = Heading level 6
editor-toolbar-bold = Bold
editor-toolbar-italic = Italic
editor-toolbar-strike = Strikethrough
editor-toolbar-teletype = Teletype
editor-toolbar-quote = Quote block
editor-toolbar-bulleted-list = Bulleted list
editor-toolbar-numbered-list = Numbered list
editor-toolbar-horizontal-rule = Horizontal rule
editor-toolbar-raw = Raw text
editor-toolbar-link = Insert link
editor-toolbar-image = Insert image
editor-toolbar-table = Insert table skeleton
editor-toolbar-code = Code block
editor-toolbar-footnote = Footnote
editor-toolbar-math = Math block
editor-toolbar-inline-math = Inline math
editor-hint-notice = Editor heuristic warnings: { $count } — not render errors.
editor-link-prompt = Link target
editor-image-prompt = Image source
editor-preview-current = Preview is up to date.
editor-preview-stale = Preview is stale. Waiting for the latest edit to render.
editor-preview-loading = Rendering preview…
editor-preview-paused = Preview paused. Changes are not being rendered.
editor-preview-error = Preview failed. Editing and saving remain available.
editor-preview-timeout = Preview render timed out.
editor-preview-failed = Preview failed.
editor-preview-failure = Preview render failed: { $message }
editor-preview-pause = Pause preview
editor-preview-resume = Resume preview
editor-preview-retry = Retry preview
editor-back-to-source = Back to source
editor-properties-heading = Page properties
editor-properties-title = Title
editor-properties-alt-title = Alternate title
editor-properties-layout = Layout
editor-properties-default-layout = Default
editor-properties-layout-hint = Change layout from the page's Options menu.
editor-properties-template = Initial template
editor-properties-no-template = No template
editor-properties-tags = Tags
editor-properties-comments = Revision comments
editor-properties-parent-heading = Page-tree move (parent)
editor-properties-parent-description = Changing the parent is a structural page-tree move, not a metadata edit. It is applied after the content save, creates its own revision, and needs edit permission on this page.
editor-properties-parent-denied = You do not have permission to move this page in the page tree. Ask a site administrator for edit permission before changing the parent.
editor-properties-parent-load-error = The current parent could not be loaded. Reload the editor to retry.
editor-properties-parent = Parent page
editor-properties-parent-hint-create = Applied when the page is created. Separate multiple parents with spaces.
editor-properties-parent-hint-existing = Current parents: { $parents }. Leave the field empty to remove all parents. Separate multiple parents with spaces.
editor-properties-no-parents = none
editor-properties-retry-move = Retry page-tree move
editor-section-heading = Edit Section
editor-create-heading = Create
editor-edit-heading = Edit
editor-checking-permission = Checking edit permission…
editor-acquiring-lock = Acquiring the page edit lock…
editor-lock-conflict = This page is being edited by another user.
editor-lock-superseded = Your edit lock was taken by another user. Saving will be rejected until you take the lock back.
editor-take-lock-back = Take the lock back
editor-draft-sync-error = The page draft is not synchronized: { $message }
editor-draft-check-error = The page draft could not be checked.
editor-draft-sync-failure = The page draft could not be synchronized.
editor-draft-discard-failure = The page draft could not be discarded.
editor-check-properties = Check the page properties.
editor-save-content-and-parent = Saving page content, then applying the page-tree move…
editor-save-properties = Saving page properties…
editor-save-parent = Page content saved. Applying the page-tree move…
editor-save-parent-apply = Applying the page-tree move…
editor-parent-move-failure = The page-tree move request failed. Check the parent page and try again.
editor-save-parent-success = Page properties and the page-tree move were saved.
editor-lock-request-failure = The edit lock request failed.
editor-draft-title = A saved draft is available
editor-draft-description = A draft exists for this page. It has not been published as a revision, and the current page text is still in the editor.
editor-draft-title-label = Draft title:
editor-draft-choice = You can restore the draft into the editor or discard it. The draft will not be changed until you choose.
editor-draft-restore = Restore draft
editor-draft-discard = Discard draft
editor-draft-restored = Draft restored into the editor.
editor-draft-discarded = Draft discarded.
editor-save-result = Page saved.
editor-save-partial = Content saved, but the page-tree move was not applied.
editor-lease-title-conflict = The page is being edited
editor-lease-title-changed = The page has changed
editor-lease-title-taken = Your edit lock was taken
editor-lease-conflict-description = It seems that the page is currently being edited by another user. The details follow:
editor-lease-conflict-user = User { $user } — lock mode: { $mode } — time remaining: { $remaining }
editor-lease-conflict-choice = You can wait for the lock to expire, or force the edit and take the lock over. The other editor will then no longer be able to save.
editor-lease-changed-description = The page was changed after you started editing, so your save was rejected. Your text has not been merged with the current version.
editor-lease-changed-choice = You can view the current page, reload the editor with the current text (losing your changes), or copy your text before leaving.
editor-lease-taken-description = Another editor took over the page edit lock, so your save was rejected. You can take the lock back, which restarts your editing session against the current version, or leave the editor.
editor-lease-edit-anyway = Edit anyway
editor-lease-cancel = Cancel
editor-lease-view-page = View current page
editor-lease-reload = Reload editor
editor-lease-copy-text = Copy my text
editor-lease-close = Close
editor-lease-leave = Leave editor
editor-lease-dialog-title = Page edit lock
