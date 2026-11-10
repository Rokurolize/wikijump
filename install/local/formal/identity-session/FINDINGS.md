# Permission fence read

`NoLateStaleWrite` and `HitMatchesSample` hold on the current source. `GrantNotBeforeFence` does not.

`batch_check_user_can` calls `get_permissions_for_user` before `permission_in_set_helper`. The helper samples `PermissionCache::cache_fence`, misses, evaluates the set it was given, and `set_user_permission_if_fence_current` writes when that sampled pair is still current. A revoke can land between the load and the sample. The compare-and-set then stores the old allow under the new fence.

TLC's shortest trace is `Load`, `Bump`, `Sample`, `Publish`. The load records allow at fence 0 (`loaded = 1`, `loadedVer = 0`). The bump revokes the grant and moves the fence to 1. The sample reads 1. The publish returns that allow (`returned = 1`, `returnedVer = 0`) and writes it on fence 1 (`cacheVer = 1`, `cacheGrant = 1`).

`ArticleCacheFence.tla` checks the public-content version key. This finding is the permission-cache pair. The property stays as stated.

If the permission load moves to after the fence sample, `extract.py` clears `ReadBeforeFence` and `check.sh` requires `GrantNotBeforeFence` to pass. Delete this finding in that change.
