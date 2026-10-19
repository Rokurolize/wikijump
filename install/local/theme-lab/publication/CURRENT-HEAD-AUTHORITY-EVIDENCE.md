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

## Frozen package input recovery (2026-10-19)

The historical Git tree `1685a1a976` contains 42 content-addressed assets
missing from the maintained shared replay pool (including Basalt's 43-byte
`theme:basalt/5` CSS import). Each restored asset was independently checked
against the SHA-256 embedded in its filename and verified to exist at that
historical Git revision. The SCP-FR `quand-le-soleil-se-couche` package also
requires its two SHA-pinned local attachments; these were recovered from the
same historical revision with exact byte counts and manifest hashes.

After recovery, `real-port-regression.mjs --verify-only` passed for all 35
default campaign packages without a running Theme Lab daemon or Wikidot
requests. The standalone SCP-FR Python contract tests passed 30/30 after
restoring the two attachments and updating assertions to match the existing
authority-composed CSS and the already-recorded `warn-no-actionable-issues`
target receipt. These checks validate frozen package inputs; they do **not**
replace present-day browser/runtime acceptance or make the remaining 36-theme
campaign-completion evidence current.

The retained source worktree is a local recovery source, not a reproducible
public download. Before calling the current-head restoration portable, issue
an independently sealed/split evidence supplement with the source manifest,
verify its downloaded bytes against its published SHA-256, and re-run in a
clean isolated checkout *without access to the original worktree*.

The optional `scripts/content-addressed-authority-store.py` implements the
local import/recovery half of this requirement without producing a multi-GB
single-file tarball. For the exact SHA-pinned inventory above, first import
from the retained worktree to a dedicated, independently stored object pool:

```sh
python3 "$clean/install/local/theme-lab/scripts/content-addressed-authority-store.py" \
  --mode ingest --source-root "$source" --destination-root "$clean" \
  --store-root /path/to/independent/authority-store \
  --inventory "$inventory" --inventory-sha256 "$inventory_sha" --apply
```

On another checkout (or another machine with the independently copied blob
pool), restore without the original source worktree:

```sh
python3 "$clean/install/local/theme-lab/scripts/content-addressed-authority-store.py" \
  --mode restore --destination-root "$clean" \
  --store-root /path/to/independent/authority-store \
  --inventory "$inventory" --inventory-sha256 "$inventory_sha" --apply
```

Omit `--apply` for a read-only plan. The store deduplicates equal SHA-256
objects and refuses tampering, unsafe paths and overwrites; it does not fetch
from a remote service or replace a durable, backed-up evidence store. See
`../ports/LONG-TERM-VALIDATION-OPERATIONS.md` for the long-term requirements.

## Relocating frozen BHL screenshot references

The twelve frozen BHL option receipts from October 2026 record screenshots
using their original absolute worktree paths. Those receipt bytes are
SHA-pinned in the frozen publication set and must not be rewritten to fake a
new capture. The verifier now recognizes only the archived
`install/local/theme-lab/ports/black-highlighter-theme/option-scenarios/captures/`
suffix and resolves that path within the current checked-out evidence root.
It refuses symlinks, traversal, and unrelated absolute paths, then verifies
every resolved image against the screenshot SHA-256 in the original receipt.

During an isolated diagnostic replay, **82 original screenshots** were copied
after exact hash checks (11,128,165 bytes). Once present, the current-campaign
failure count went from 243 to 75; 164 duplicated cross-baseline screenshot
path failures and their four derivative review failures disappeared. Remaining
failures are 36 superseded runtime sources, 36 missing visual-review artifacts
plus a missing Sigma-10 browser audit,
and two stale BHL Framerail fingerprint checks. These are expected **blocking**
current-head acceptance findings, not authorization to reuse old runtime
observations or to repin the frozen evidence. No copied diagnostic acceptance
artifacts are part of the PR.
