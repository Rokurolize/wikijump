## DOM Compatibility

DOM compatibility is a required part of this fork's Wikidot-emulator contract, not an optional migration aid. For every browser surface exposed by live Wikidot, the Wikidot layout and browser-facing routes must preserve the observable tree structure, element order, IDs, classes, attributes, CSS cascade, interactions, navigation states, intermediate visible states, and settled layout. Controlled live Wikidot observations are canonical when documentation or local output disagrees.

No UI category is exempt from compatibility in advance. Login and logout, user settings, site administration, user profiles, page editing, and page options are all required observation surfaces and must be reproduced from evidence rather than assigned replacement markup merely because themes or customization are limited there.

The existence of another internal layout or a transition mechanism does not relax the `Layout::Wikidot` contract and must not change imported-content behavior. Unverified compatibility behavior must remain unspecified until controlled evidence is collected; implementations must not invent replacement markup or silently redesign the interface. Security-sensitive trust boundaries continue to fail closed.

Intentional differences are limited to explicit security boundaries such as escaping, sanitization, content security policy, credential handling, and access control. Each such difference must be narrowly documented, justified, and covered by regression evidence; it is not a general license to modernize Wikidot behavior.
