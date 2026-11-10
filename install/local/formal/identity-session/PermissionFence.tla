---- MODULE PermissionFence ----
EXTENDS Integers

CONSTANTS ReadBeforeFence, CasGuards, KeyHasFence

VARIABLES
    truth, ver, cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
    rpc, loaded, loadedVer, sampled, returned, returnedVer,
    wpc, spc, staleVer, staleGrant, rejected

vars == <<truth, ver, cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
          rpc, loaded, loadedVer, sampled, returned, returnedVer,
          wpc, spc, staleVer, staleGrant, rejected>>

TypeOK ==
    /\ truth \in {0, 1}
    /\ ver \in 0..2
    /\ cacheVer \in -1..2
    /\ cacheGrant \in {0, 1}
    /\ entryBorn \in -1..2
    /\ cacheWriter \in {"none", "reader", "stale"}
    /\ fromCache \in BOOLEAN
    /\ hitVer \in -1..2
    /\ wroteLate \in BOOLEAN
    /\ rpc \in {"start", "loaded", "sampled", "done"}
    /\ loaded \in -1..1
    /\ loadedVer \in -1..2
    /\ sampled \in -1..2
    /\ returned \in -1..1
    /\ returnedVer \in -1..2
    /\ wpc \in {"start", "bumped", "dropped"}
    /\ spc \in {"start", "held", "done"}
    /\ staleVer \in -1..2
    /\ staleGrant \in -1..1
    /\ rejected \in BOOLEAN

Init ==
    /\ truth = 1
    /\ ver = 0
    /\ cacheVer = -1
    /\ cacheGrant = 0
    /\ entryBorn = -1
    /\ cacheWriter = "none"
    /\ fromCache = FALSE
    /\ hitVer = -1
    /\ wroteLate = FALSE
    /\ rpc = "start"
    /\ loaded = -1
    /\ loadedVer = -1
    /\ sampled = -1
    /\ returned = -1
    /\ returnedVer = -1
    /\ wpc = "start"
    /\ spc = "start"
    /\ staleVer = -1
    /\ staleGrant = -1
    /\ rejected = FALSE

Bump ==
    /\ wpc = "start"
    /\ ver < 2
    /\ truth' = 0
    /\ ver' = ver + 1
    /\ wpc' = "bumped"
    /\ UNCHANGED <<cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
                   rpc, loaded, loadedVer, sampled, returned, returnedVer,
                   spc, staleVer, staleGrant, rejected>>

Drop ==
    /\ wpc = "bumped"
    /\ cacheVer' = -1
    /\ cacheGrant' = 0
    /\ entryBorn' = -1
    /\ cacheWriter' = "none"
    /\ wpc' = "dropped"
    /\ UNCHANGED <<truth, ver, fromCache, hitVer, wroteLate, rpc, loaded, loadedVer, sampled,
                   returned, returnedVer, spc, staleVer, staleGrant, rejected>>

Load ==
    /\ ReadBeforeFence
    /\ rpc = "start"
    /\ loaded' = truth
    /\ loadedVer' = ver
    /\ rpc' = "loaded"
    /\ UNCHANGED <<truth, ver, cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
                   sampled, returned, returnedVer, wpc, spc, staleVer, staleGrant, rejected>>

Sample ==
    /\ rpc = (IF ReadBeforeFence THEN "loaded" ELSE "start")
    /\ sampled' = ver
    /\ rpc' = "sampled"
    /\ IF ReadBeforeFence
         THEN UNCHANGED <<loaded, loadedVer>>
         ELSE /\ loaded' = truth
              /\ loadedVer' = ver
    /\ UNCHANGED <<truth, ver, cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
                   returned, returnedVer, wpc, spc, staleVer, staleGrant, rejected>>

Publish ==
    /\ rpc = "sampled"
    /\ loaded # -1
    /\ LET isHit == IF KeyHasFence
                      THEN cacheVer = sampled /\ cacheVer # -1
                      ELSE cacheVer # -1
           grant == IF isHit THEN cacheGrant ELSE loaded
           born == IF isHit THEN entryBorn ELSE loadedVer
           write == ~isHit /\ (CasGuards => ver = sampled)
           dest == IF KeyHasFence THEN sampled ELSE ver
       IN
         /\ returned' = grant
         /\ returnedVer' = born
         /\ fromCache' = isHit
         /\ hitVer' = IF isHit THEN cacheVer ELSE -1
         /\ rpc' = "done"
         /\ IF write
              THEN /\ cacheVer' = dest
                   /\ cacheGrant' = loaded
                   /\ entryBorn' = loadedVer
                   /\ cacheWriter' = "reader"
              ELSE UNCHANGED <<cacheVer, cacheGrant, entryBorn, cacheWriter>>
         /\ UNCHANGED <<truth, ver, loaded, loadedVer, sampled, wpc, spc, staleVer,
                        staleGrant, rejected, wroteLate>>

StaleSample ==
    /\ spc = "start"
    /\ staleVer' = ver
    /\ staleGrant' = truth
    /\ spc' = "held"
    /\ UNCHANGED <<truth, ver, cacheVer, cacheGrant, entryBorn, cacheWriter, fromCache, hitVer, wroteLate,
                   rpc, loaded, loadedVer, sampled, returned, returnedVer, wpc, rejected>>

StaleWrite ==
    /\ spc = "held"
    /\ IF CasGuards /\ ver # staleVer
         THEN /\ rejected' = TRUE
              /\ spc' = "done"
              /\ UNCHANGED <<cacheVer, cacheGrant, entryBorn, cacheWriter, wroteLate>>
         ELSE /\ cacheVer' = IF KeyHasFence THEN staleVer ELSE ver
              /\ cacheGrant' = IF staleGrant = 1 THEN 1 ELSE 0
              /\ entryBorn' = staleVer
              /\ cacheWriter' = "stale"
              /\ wroteLate' = (wroteLate \/ (ver # staleVer))
              /\ spc' = "done"
              /\ UNCHANGED rejected
    /\ UNCHANGED <<truth, ver, fromCache, hitVer, rpc, loaded, loadedVer, sampled, returned, returnedVer,
                   wpc, staleVer, staleGrant>>

Next == Bump \/ Drop \/ Load \/ Sample \/ Publish \/ StaleSample \/ StaleWrite

Spec == Init /\ [][Next]_vars

GrantNotBeforeFence == returned # 1 \/ returnedVer >= sampled

NoLateStaleWrite == ~wroteLate

HitMatchesSample == ~fromCache \/ hitVer = sampled

NeverRevoked == truth = 1

====
