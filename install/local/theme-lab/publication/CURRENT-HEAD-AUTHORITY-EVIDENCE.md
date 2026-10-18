# Current-head authority-evidence supplement (2026-10-18)

The signed **2026-10-07 acceptance archive** described in
[ACCEPTANCE-ARCHIVE.md](ACCEPTANCE-ARCHIVE.md) remains immutable. It validates
its own accepted Git-tag state. The current maintained Theme Lab contains
later SHA-pinned adaptation receipts that the historic tag archive does not
carry. A fresh `develop` checkout therefore fails `check-adaptation-authority.mjs`
with missing `ports/authority-evidence/` files, even though their source bytes
are still retained in the old Theme Lab worktree. This is an independent,
current-head supplemental evidence-delivery problem (issue #2506).

## Verified restore procedure

`restore-authority-evidence.py` requires a separately delivered inventory
whose **whole-file SHA-256 is known in advance** (pinned above); it does not trust filenames or
an unchecked inventory. The inventory identifies each file's repository-relative
path, byte count and SHA-256, plus 104 current-head adaptation ledger roots (100 authority receipts and 4
shared-fixture receipts).
The script verifies source file hashes, exact ledger-root hash equality, safe
relative paths, and destination pre-existing bytes *before* it can copy anything.
It disallows symlinked path components, different existing files and copying
between overlapping source/destination roots. Without `--restore` it is read-only.
With `--restore` it uses per-file temporary copies and atomic no-overwrite
hardlinks, leaving restored evidence files read-only in a **disposable checkout**.

Example for this workstation's measured inventory (an external supplement,
**not** part of the signed archive):

```sh
inventory=/absolute/path/to/this-repository/install/local/theme-lab/publication/current-head-authority-supplement.json
inventory_sha=c3281ffb59e94a0cea2f0d054617bbdf38e2b6395ebed9d8414dbdea23aa016f
source=/home/roku/.devspace/worktrees/theme-final-audit
clean=/absolute/path/to/an/independent/disposable/develop-worktree
python3 "$clean/install/local/theme-lab/scripts/restore-authority-evidence.py" \
  --source-root "$source" --destination-root "$clean" \
  --inventory "$inventory" --inventory-sha256 "$inventory_sha"
# Inspect the plan and disk space first; then, only on a task-owned checkout:
python3 "$clean/install/local/theme-lab/scripts/restore-authority-evidence.py" \
  --source-root "$source" --destination-root "$clean" \
  --inventory "$inventory" --inventory-sha256 "$inventory_sha" --restore
node "$clean/install/local/theme-lab/ports/scripts/check-adaptation-authority.mjs"
```

The original measured direct receipt closure had 1,894 files
(5,391,903,415 bytes). The maintained supplement adds 227 SHA-addressed
frozen replay objects referenced indirectly by receipts and 22 current-head
shared-fixture files, plus 12 native-history replay receipt/response
artifacts explicitly bound by SHA in their parent receipts, and two
additional native-page-preview receipt/response files. On the measured
clean October 18 checkout, the manifest covers 2,157 files; the actual number
to restore depends on which validated files are already present.
The manifest and its source are authenticated by the independent ledger-root
checks and the exact SHA-pinned content-addressed object paths. These numbers apply to that inventory snapshot only.
Its direct receipt traversal was not proven to cover *all* Theme Lab test inputs.
A full maintenance gate additionally needs shared fixtures, Basalt CSS imports,
current-campaign acceptance contracts and evidence, and Python validation
fixtures. A successful restore and adaptation-authority check **do not**
constitute full Theme Lab acceptance, a new browser screenshot review, or
approval to publish a changed candidate. Verify the separate Sigma-10
historical contract provenance fix (#2509), retain an independent current-head
final validation receipt, and do not alter signed accepted source identities.

The retained source worktree is a local recovery source, not a reproducible
public download. Before calling the current-head restoration portable, issue
an independently sealed/split evidence supplement with the source manifest,
verify its downloaded bytes against its published SHA-256, and re-run in a
clean isolated checkout *without access to the original worktree*.
