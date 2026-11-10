# Standing parking and the PostgreSQL move-up

`NoUnverifiedImage`, `NoRebuildWhenAllPresent`, and `ActivatedRunsNew` hold on the current source. `PassMeansVerified` holds. Two checks do not, and they were not weakened.

`SurvivingContainerKept` fails when Compose has removed one parked container and another is still present. `restore_or_recreate_previous_containers` restores the remaining container, then `compose up --force-recreate` replaces every service. The surviving service comes back as a new container on the pinned image. Its container id is not the pre-switch id. TLC's shortest trace is `Remove` of `deepwell`, then `Rollback`. `wws` is still present, `containerKept` is false, and `started` is `base`.

A kill inside the move-up `mv` of `upgrade-cluster.sh` fails the startability check. The script deletes every top-level name except `.pg-upgrade-new`, then moves the new cluster up one name at a time. After `PG_VERSION` has moved and before `pg_hba.conf`, `postgresql.conf`, `base`, and `global` have moved, neither directory is a cluster the old binaries or the new binaries can start. A kill before that `mv`, and a kill before every earlier command, still leaves one of those directories startable. `EXPECTED-FAIL upgrade-move` is that window. The product script was not changed.

If `compose up` stops force-recreating a parked container that is still present, move `SurvivingContainerKept` to the pass list and delete that finding. If the move-up becomes one replacement that leaves either the sidecar or the volume root complete at every crash, delete the move finding and make that kill pass.
