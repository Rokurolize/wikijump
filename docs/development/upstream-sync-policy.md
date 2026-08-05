# Upstream sync policy

The `web/` directory is deliberately deleted in this fork. When an upstream merge reports a delete/modify conflict under `web/`, resolve it as a deletion with `git rm -r web` and never restore the directory to settle the merge.

The fork serves Framerail, and the legacy frontend was removed on 2026-08-05 because it is no longer built or shipped.

This rule is part of the `Remove legacy web frontend` pull request.
