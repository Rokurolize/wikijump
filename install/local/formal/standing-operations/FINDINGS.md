# Standing parking and the PostgreSQL move-up

`NoUnverifiedImage`, `NoRebuildWhenAllPresent`, `ActivatedRunsNew`, and `SurvivingContainerKept` hold on the current source. `PassMeansVerified` holds. `upgrade-move` holds: the move-up hardlinks the sidecar into the volume root before removing the sidecar, so every kill leaves the sidecar or the root complete.
