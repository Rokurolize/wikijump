---- MODULE ParkingRollback ----
EXTENDS Integers

CONSTANTS IdentityGuard, SnapshotGuard, EnvGuard, RecreateGuard, PresentGuard

Services == {"deepwell", "wws"}

VARIABLES present, identityOk, snap, envPinned, inspectFails, lie,
          outcome, started, containerKept

vars == <<present, identityOk, snap, envPinned, inspectFails, lie,
          outcome, started, containerKept>>

SnapKind == {"intact", "mutated", "absent"}
StartKind == {"none", "same", "snapshot", "base", "new", "other"}

TypeOK ==
  /\ present \in [Services -> BOOLEAN]
  /\ identityOk \in [Services -> BOOLEAN]
  /\ snap \in [Services -> SnapKind]
  /\ envPinned \in BOOLEAN
  /\ inspectFails \in BOOLEAN
  /\ lie \in BOOLEAN
  /\ outcome \in {"pending", "restored", "recreated", "refused", "activated"}
  /\ started \in [Services -> StartKind]
  /\ containerKept \in [Services -> BOOLEAN]

Init ==
  /\ present = [s \in Services |-> TRUE]
  /\ identityOk = [s \in Services |-> TRUE]
  /\ snap = [s \in Services |-> "intact"]
  /\ envPinned = TRUE
  /\ inspectFails = FALSE
  /\ lie = FALSE
  /\ outcome = "pending"
  /\ started = [s \in Services |-> "none"]
  /\ containerKept = [s \in Services |-> FALSE]

Pending == outcome = "pending"

Remove(s) ==
  /\ Pending
  /\ present[s]
  /\ present' = [present EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<identityOk, snap, envPinned, inspectFails, lie, outcome, started, containerKept>>

BreakIdentity(s) ==
  /\ Pending
  /\ identityOk[s]
  /\ identityOk' = [identityOk EXCEPT ![s] = FALSE]
  /\ UNCHANGED <<present, snap, envPinned, inspectFails, lie, outcome, started, containerKept>>

MutateSnap(s) ==
  /\ Pending
  /\ snap[s] = "intact"
  /\ snap' = [snap EXCEPT ![s] = "mutated"]
  /\ UNCHANGED <<present, identityOk, envPinned, inspectFails, lie, outcome, started, containerKept>>

DropSnap(s) ==
  /\ Pending
  /\ snap[s] # "absent"
  /\ snap' = [snap EXCEPT ![s] = "absent"]
  /\ UNCHANGED <<present, identityOk, envPinned, inspectFails, lie, outcome, started, containerKept>>

Unpin ==
  /\ Pending
  /\ envPinned
  /\ envPinned' = FALSE
  /\ UNCHANGED <<present, identityOk, snap, inspectFails, lie, outcome, started, containerKept>>

SetLie ==
  /\ Pending
  /\ ~lie
  /\ lie' = TRUE
  /\ UNCHANGED <<present, identityOk, snap, envPinned, inspectFails, outcome, started, containerKept>>

SetInspectFail ==
  /\ Pending
  /\ ~inspectFails
  /\ inspectFails' = TRUE
  /\ UNCHANGED <<present, identityOk, snap, envPinned, lie, outcome, started, containerKept>>

Freeze == UNCHANGED <<present, identityOk, snap, envPinned, inspectFails, lie>>

RefusedNone ==
  /\ outcome' = "refused"
  /\ started' = [s \in Services |-> "none"]
  /\ containerKept' = [s \in Services |-> FALSE]
  /\ Freeze

RefusedAfterFirst ==
  /\ outcome' = "refused"
  /\ started' = [s \in Services |-> IF s = "deepwell" THEN "same" ELSE "none"]
  /\ containerKept' = [s \in Services |-> s = "deepwell"]
  /\ Freeze

Want(s) ==
  IF ~present[s] /\ snap[s] = "intact" THEN "snapshot"
  ELSE IF ~present[s] /\ snap[s] = "mutated" THEN "other"
  ELSE IF present[s] THEN "same"
  ELSE "base"

RecreateFrom(image) ==
  /\ outcome' = "recreated"
  /\ started' = [s \in Services |-> IF present[s] THEN "same" ELSE image[s]]
  /\ containerKept' = [s \in Services |-> present[s]]
  /\ Freeze

RecreateChecked ==
  IF lie /\ RecreateGuard THEN
    /\ outcome' = "refused"
    /\ started' = [s \in Services |-> Want(s)]
    /\ containerKept' = [s \in Services |-> present[s]]
    /\ Freeze
  ELSE IF lie /\ ~RecreateGuard THEN
    RecreateFrom([s \in Services |-> "other"])
  ELSE
    RecreateFrom([s \in Services |-> Want(s)])

MissingPath ==
  IF ~envPinned /\ EnvGuard THEN
    RefusedNone
  ELSE IF \E s \in Services: ~present[s] /\ snap[s] = "mutated" /\ SnapshotGuard THEN
    RefusedNone
  ELSE IF ~envPinned /\ ~EnvGuard THEN
    RecreateFrom([s \in Services |-> "other"])
  ELSE
    RecreateChecked

IdentityFail(s) == present[s] /\ ~identityOk[s] /\ IdentityGuard

AllPresent == \A s \in Services: present[s]

Rollback ==
  /\ Pending
  /\ IF inspectFails /\ AllPresent THEN
       IF PresentGuard THEN RefusedNone ELSE RecreateChecked
     ELSE IF ~present["deepwell"] \/ ~present["wws"] THEN
       MissingPath
     ELSE IF IdentityFail("deepwell") THEN
       RefusedNone
     ELSE IF IdentityFail("wws") THEN
       RefusedAfterFirst
     ELSE IF \E s \in Services: ~identityOk[s] THEN
       /\ outcome' = "restored"
       /\ started' = [s \in Services |-> IF identityOk[s] THEN "same" ELSE "other"]
       /\ containerKept' = [s \in Services |-> TRUE]
       /\ Freeze
     ELSE
       /\ outcome' = "restored"
       /\ started' = [s \in Services |-> "same"]
       /\ containerKept' = [s \in Services |-> TRUE]
       /\ Freeze

Activate ==
  /\ Pending
  /\ outcome' = "activated"
  /\ started' = [s \in Services |-> "new"]
  /\ containerKept' = [s \in Services |-> FALSE]
  /\ Freeze

Next ==
  \/ \E s \in Services: Remove(s)
  \/ \E s \in Services: BreakIdentity(s)
  \/ \E s \in Services: MutateSnap(s)
  \/ \E s \in Services: DropSnap(s)
  \/ Unpin
  \/ SetLie
  \/ SetInspectFail
  \/ Rollback
  \/ Activate

Spec == Init /\ [][Next]_vars

NoUnverifiedImage ==
  outcome \in {"restored", "recreated", "activated"} =>
    \A s \in Services: started[s] \in {"same", "snapshot", "base", "new"}

NoRebuildWhenAllPresent ==
  outcome = "recreated" => \E s \in Services: ~present[s]

ActivatedRunsNew ==
  outcome = "activated" => \A s \in Services: started[s] = "new"

SurvivingContainerKept ==
  outcome # "recreated" \/ \A s \in Services: present[s] => containerKept[s]

NeverRestored == outcome # "restored"
NeverRefused == outcome # "refused"
NeverRecreated == outcome # "recreated"

====
