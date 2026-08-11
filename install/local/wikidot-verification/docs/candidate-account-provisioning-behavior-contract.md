# Candidate account provisioning behavior contract

Referent table: `referent-table-candidate-account-provisioning.md`

## User-visible goal

An operator can prepare an existing Wikidot sandbox identity for login on one disposable Wikijump candidate without proxying credentials to Wikidot, changing a standing runtime, or granting access to a mirror site.

## Target

Type: operator CLI and public web action.

Launch or access: `node scripts/provision-candidate-account.mjs --candidate-identity <sealed-candidate.json> --private-input <mode-0600.json> --receipt <new-receipt.json>`.

Allowed credential source: the exact mode-0600 private input file sealed to the candidate identity SHA-256. The externally owned disposable candidate lifecycle creates the short-lived platform user `-1` session through private fixture setup and seals it into this file. Credentials must not be supplied in arguments, stored in the receipt, or echoed to standard output.

## User tasks

1. Attach to a sealed non-443 `scpaiueouiuiuiui.wikijump.localhost` candidate and activate the exact existing Wikidot numeric user ID as a regular local account.

2. Assign membership only on `scpaiueouiuiuiui` and leave mirror authoring untouched.

3. Submit the provisioned login identifier and password through the ordinary `/-/login` form action, then submit a different password through the same action.

## Expected observable behavior

1. The activation preserves the numeric user ID, public name, and public slug already present in the candidate Wikidot identity record.

2. A previously activated exact identity receives only a local password update, so the command is safe to repeat on a disposable candidate.

3. The correct password produces one ordinary login session for the exact numeric user ID; the different password produces no session; the successful probe session is logged out before publication.

4. The no-replace receipt contains candidate and private-input hashes, public identity, hashed login identifier, editable-site membership result, and login observations. It contains no password, operator session, Deepwell token, TLS material, or created login session.

5. A standing origin, port 443, a non-loopback Deepwell endpoint, an input sealed to another candidate, a non-platform operator, a target ID equal to platform user `-1`, a missing or mismatched public Wikidot identity, or any site other than `scpaiueouiuiuiui` fails closed before receipt publication.

## Anti-cheat probes

1. Change the private password while preserving public identity and observe only the private-input hash and subsequent successful login behavior change.

2. Submit the generated different password and confirm that no `wikijump_token` cookie is issued.

3. Replace the editable site or candidate host with a mirror identity and confirm that provisioning is rejected.

4. Repeat provisioning for the same already activated identity and confirm that the public identity remains unchanged while the new password succeeds.

## Evidence required

The command returns a receipt path and SHA-256, and the receipt records the exact numeric identity, activation outcome, editable-site membership outcome, correct-password session identity, wrong-password rejection, and successful session cleanup without recording any credential value.

## Out of scope

Building or launching the candidate, changing standing state, importing a Wikidot identity missing from the candidate corpus, assigning administrator or moderator roles, authoring into `scp-wiki` or `scp-jp`, and proxying authentication to Wikidot are outside this command.
