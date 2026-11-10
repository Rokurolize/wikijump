---- MODULE RoleForest ----
EXTENDS Integers, FiniteSets

CONSTANTS ParentEditGuard, ChildEditGuard, CascadeRemoves, ReparentCycleGuard,
          ReparentSubsetGuard, ReparentLiveParent, DeleteKeepsLiveParent

VARIABLES parent, perm, live

vars == <<parent, perm, live>>

Roles == 1..3
Perms == {"p", "q"}

TypeOK ==
  /\ parent \in [Roles -> 0..3]
  /\ perm \in [Roles -> SUBSET Perms]
  /\ live \in [Roles -> BOOLEAN]

Init ==
  /\ parent = [r \in Roles |-> 0]
  /\ perm = [r \in Roles |-> {}]
  /\ live = [r \in Roles |-> TRUE]

NextParent(x) == IF x \in Roles THEN parent[x] ELSE 0

Acyclic ==
  \A r \in {x \in Roles: live[x]}:
    LET a == NextParent(r)
        b == NextParent(a)
        c == NextParent(b)
    IN /\ a # r
       /\ b # r
       /\ c # r

LiveParent ==
  \A r \in {x \in Roles: live[x]}:
    IF parent[r] = 0 THEN TRUE ELSE live[parent[r]]

ParentSubset ==
  \A r \in {x \in Roles: live[x]}:
    IF parent[r] = 0 THEN TRUE ELSE perm[r] \subseteq perm[parent[r]]

WouldCycle(role, np) ==
  \/ np = role
  \/ \E child \in Roles: live[child] /\ parent[child] = role /\ np = child
  \/ \E child \in Roles:
       /\ live[child]
       /\ parent[child] = role
       /\ \E grand \in Roles: live[grand] /\ parent[grand] = child /\ np = grand

Edit(role, new, cascade) ==
  /\ live[role]
  /\ new \in SUBSET Perms
  /\ cascade \in BOOLEAN
  /\ LET parentOk ==
           IF parent[role] = 0 THEN TRUE
           ELSE ~ParentEditGuard \/ new \subseteq perm[parent[role]]
         blocked == {child \in Roles:
           live[child] /\ parent[child] = role /\ ~(perm[child] \subseteq new)}
         canApply ==
           /\ parentOk
           /\ \/ blocked = {}
              \/ cascade
              \/ ~ChildEditGuard
         shrink == cascade /\ CascadeRemoves /\ blocked # {}
     IN
       /\ canApply
       /\ perm' = [q \in Roles |->
            IF q = role THEN new
            ELSE IF shrink /\ live[q] /\ (q \in blocked \/ \E child \in blocked: parent[q] = child)
                 THEN perm[q] \intersect new
                 ELSE perm[q]]
       /\ UNCHANGED <<parent, live>>

Reparent(role, np) ==
  /\ live[role]
  /\ np \in 0..3
  /\ ReparentCycleGuard => ~WouldCycle(role, np)
  /\ IF np = 0 THEN TRUE ELSE live[np] \/ ~ReparentLiveParent
  /\ IF np = 0 THEN TRUE ELSE ~ReparentSubsetGuard \/ perm[role] \subseteq perm[np]
  /\ parent' = [parent EXCEPT ![role] = np]
  /\ UNCHANGED <<perm, live>>

Delete(role, reparentKids) ==
  /\ live[role]
  /\ reparentKids \in BOOLEAN
  /\ LET kids == {child \in Roles: live[child] /\ parent[child] = role}
         canReparent ==
           IF parent[role] \in Roles THEN reparentKids /\ live[parent[role]] ELSE FALSE
         allowed ==
           \/ kids = {}
           \/ canReparent
           \/ ~DeleteKeepsLiveParent
     IN
       /\ allowed
       /\ parent' = [q \in Roles |->
            IF q \in kids /\ canReparent THEN parent[role] ELSE parent[q]]
       /\ live' = [live EXCEPT ![role] = FALSE]
       /\ UNCHANGED perm

EditA == \E role \in Roles, new \in SUBSET Perms, cascade \in BOOLEAN: Edit(role, new, cascade)
ReparentA == \E role \in Roles, np \in 0..3: Reparent(role, np)
DeleteA == \E role \in Roles, reparentKids \in BOOLEAN: Delete(role, reparentKids)
Step == EditA \/ ReparentA \/ DeleteA
Done == ~(ENABLED Step) /\ UNCHANGED vars
Next == Step \/ Done
Spec == Init /\ [][Next]_vars

StaysFlat == \A role \in Roles: parent[role] = 0
StaysEmpty == \A role \in Roles: perm[role] = {}

====
