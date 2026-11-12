# Membership, bans, and the role forest

The pass invariants hold on the current source. This check does not report a product defect.

`ActiveBanClearsMember`, `ActiveBanClearsGrants`, `MemberOnlyByAccept`, `CleanupOnlyObserved`, `InviteAtMostOnce`, `ReviewAtMostOnce`, and `RemoveRevokesGrants` hold. `Acyclic`, `ParentSubset`, and `LiveParent` hold. The witnesses fail because those steps are reachable, so the passes are not empty.

`active_site_ban_exists` treats `banned_until >= today` as active. `lift_expired_site_ban_if_current` skips only `banned_until > today`. On the expiry date those two comparisons disagree until the cleanup job runs. This model has no calendar, so that disagreement is outside the check. The checked cleanup property is the current-row filter. The update names the observed `relation_id` and requires `overwritten_at` and `deleted_at` to be null.
