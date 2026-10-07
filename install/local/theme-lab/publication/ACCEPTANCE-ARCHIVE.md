# 2026-10-07 acceptance evidence archive

This seals the existing acceptance. It does not create a new acceptance, rerender
pages, or change publication candidates. The signed annotated tag
`theme-lab-final-acceptance-20261007` remains at object
`d4b36a356a4eac3453c566d3c05e0647f53c9210`, peeled commit
`1685a1a976c6787ad6ec5f1d9f3b3380b56113b3`.

## Three storage boundaries

The maintained repository owns candidate/publication sources and attachments,
fixtures, validator code, small contracts, publication identities and this archive
locator. PR #2048 deliberately omitted raw run payloads; #2049 restored the two
maintained Sigma-9 contracts. Neither clean develop nor the signed tag alone
contains the complete final evidence. The tag signature authenticates its Git
object/tree and the evidence hashes recorded there; it does not sign every
archive member or this later archive descriptor.

The durable external archive supplies the missing acceptance evidence as an
exact-byte overlay on the signed tag. Its whole-file SHA-256 is pinned in
[acceptance-evidence-archive.json](acceptance-evidence-archive.json). It includes
current campaign/package receipts, audits, canonical scenario evidence, exact
required screenshots, semantic/source authority inputs, and final BHL,
rich-body and post-freeze target A/B review evidence. Measurement programs,
reviewed contact sheets and their manifests are retained where bound by those
reviews. Sources already present at the tag are not duplicated.

Unreferenced superseded history, replay responses, bulk compressed per-state DOM
payloads, old failed captures, development scratchpads and the superseded
Sigma-10 contact sheets are omitted. Some frozen replay objects and source-side
failed navigation captures **are required validator inputs** and remain in the
closure. The exclusion is based on evidence integrity, not directory names.

The archive does not claim bibliography presentation parity or expand the
rich-body/A/B review scopes. Existing receipts and internal canonical receipt
hashes are preserved verbatim; whole-file hashes in the archive manifest are a
separate binding. No acceptance runtime was started or modified for archival.

## Closure and manifest

Closure was measured by executing both validators successfully while recording
synchronous/URL/asynchronous filesystem reads and present optional inputs,
including child contract-dump processes.
It was then extended with final-publication direct references and final review
PNG/contact-sheet/manifest/measurement dependencies. The final proof starts from
a fresh signed-tag worktree and overlays only the archive, hiding the original
worktree during validator execution.

`theme-lab-acceptance-archive-manifest.json` is at the archive root. Its `files`
records list every overlay payload's repository-relative path, byte size and
SHA-256. Its `repository_inputs` list records the same identities for required
bytes supplied by the signed tag. It also records tag object/commit,
candidate-set, both run contracts, accepted Framerail/Deepwell identities,
format/version, creation time, counts and closure provenance.

`file_count` and `total_bytes` count payload files. The tar has one additional
member: the manifest itself, excluded from self-hashing. Its own size/SHA and the
compressed archive size/SHA are pinned in the maintained descriptor. The archive
has no absolute or parent-traversing member paths.

## Reverify without the old worktree

Download the assets from the release linked in the descriptor. Check the archive
and manifest SHA-256/size against the descriptor before extraction. Use Node 24
and Python 3.11 or later. The tag validator imports `@playwright/test` 1.63.0
and starts anonymous Chromium only to dump contracts; it opens no page, obtains
no session and captures no pixels. Tooling dependencies/browser executables are
prerequisites, not acceptance evidence. Keep the maintained verifier script outside the clean
tag checkout, or use its identical release asset.

```sh
archive=/absolute/path/theme-lab-final-acceptance-20261007.tar.gz
verifier=/absolute/path/verify-acceptance-archive.py
tooling=$(mktemp -d /tmp/theme-acceptance-tooling.XXXXXX)
npm install --prefix "$tooling" --ignore-scripts --no-audit --no-fund @playwright/test@1.63.0
node "$tooling/node_modules/playwright/cli.js" install chromium
clean=$(mktemp -d /tmp/theme-acceptance-reverify.XXXXXX)
git tag -v theme-lab-final-acceptance-20261007
git worktree add --detach "$clean" 'theme-lab-final-acceptance-20261007^{}'
tar -xzf "$archive" -C "$clean"
python3 "$verifier" "$clean"
mkdir -p "$clean/framerail/node_modules"
```

Some original BHL/full-check receipts bind absolute checkout paths. Rewriting
those paths would change accepted evidence hashes. Therefore use a private Linux
user/mount namespace to expose the clean worktree at the recorded checkout path.
This hides any original worktree at that path for the subprocess only. The
read-only mount prevents either checkout from being written by the validators.
The network namespace prevents external network access during validation.
The separate tooling mount contains only Playwright libraries, not evidence.
On a new machine create the empty mount-point directory first if it is absent.
Do not replace it with a symlink or run against the original dirty worktree.

```sh
recorded=/home/roku/.devspace/worktrees/theme-final-audit
mkdir -p "$recorded"
unshare --user --map-root-user --mount --net sh -eu -c '
  mount --make-rprivate /
  mount --bind "$1" "$2"
  mount --bind "$3" "$2/framerail/node_modules"
  mount -o remount,bind,ro "$2/framerail/node_modules"
  mount -o remount,bind,ro "$2"
  cd "$2"
  node install/local/theme-lab/scripts/check-campaign-completion.mjs
  node --input-type=module -e '\''
    import {validatePublicationCandidateSet} from "./install/local/theme-lab/src/publication-candidate-freeze.mjs";
    const failures = validatePublicationCandidateSet("./install/local/theme-lab");
    console.log(JSON.stringify({failures}, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  '\''
' sh "$clean" "$recorded" "$tooling/node_modules"
```

Expected completion: `CURRENT CAMPAIGN ACCEPTED`, `packages: 36`, `failures: []`.
Expected publication validation: `failures: []`. Manifest verification must pass
for both overlay files and signed-tag repository inputs.

After validation, remove **only the newly created disposable worktree**:

```sh
git worktree remove --force "$clean"
```

The archival verification receipt in the descriptor records the successful clean
reconstruction. The original worktree and its pre-existing untracked evidence
are retained; the temporary validation worktree is removed.
