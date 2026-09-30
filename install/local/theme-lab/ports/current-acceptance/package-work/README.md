# Current package acceptance run

This work subtree records the 36 maintained package checks from HEAD
`65a3583e4388e689c7b3cc3214707dfa90adb5d9`. All daemons used
`/usr/bin/google-chrome` 154.0.8037.57, the run-owned acceptance page,
the frozen Sigma-9 CSS/header/navigation/sidebar fixtures, and
`ports/shared-replay-assets`.

## Results

- `nonvisual/results.jsonl` contains all 36 full nonvisual package results;
  `nonvisual/blocker-summary.json` summarizes actual port and local-target
  blockers. The completed sweep has 21 warning-only rows and 15 failing rows,
  with no runner errors.
- `visual/raw/` contains all 36 unabridged Theme Lab responses.
  `visual/artifacts/` contains 360 candidate/reference PNGs covering five
  viewports per package. `visual/results.jsonl` contains the maintained runner
  rows and `visual/run-summary.json` the run totals.
- `review-worklist.json` binds all 180 paired screenshots to their exact hashes
  and candidate input hashes. All pairs remain pending direct review because
  no retained review binds the exact current screenshots and inputs. Four
  historical reference PNGs are byte-identical; that alone does not establish
  reusable review provenance.
- `run-manifest.json` records browser, fixture, asset-pool and run identities.

The nonvisual sweep confirmed Inkblot passes all five viewports and torture on
Chrome 154. The remaining failures are package-specific: measured viewport
escapes, two port-authority failures, and one torture regression. No package
CSS was changed. Current combined visual acceptance remains pending review;
no package receipt was finalized. Browser-state matrices and the Sigma-10
migration campaign were not run.

The maintained runner previously imposed a 120-second subprocess timeout. A
full Aesthetic check measured 157.2 seconds, including 120.3 seconds in the
surface contract, and therefore demonstrated that the old timeout reported a
false runner error. The timeout is now 300 seconds; the focused policy test is
`tests/package-check-policy.test.mjs`.
