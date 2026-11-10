---- MODULE DiscussionBinding ----

CONSTANTS UniquePageId, CrossPageRejected

Writers == {"w1", "w2"}

VARIABLES pointer, holder, holderDeleted, extra, phase, bound

vars == <<pointer, holder, holderDeleted, extra, phase, bound>>

TypeOK ==
  /\ pointer \in {"none", "t1", "t2"}
  /\ holder \in {"none", "t1", "t2"}
  /\ holderDeleted \in BOOLEAN
  /\ extra \in BOOLEAN
  /\ phase \in [Writers -> {"idle", "done", "rejected"}]
  /\ bound \in BOOLEAN

Init ==
  /\ pointer = "none"
  /\ holder = "none"
  /\ holderDeleted = FALSE
  /\ extra = FALSE
  /\ phase = [w \in Writers |-> "idle"]
  /\ bound = FALSE

Create(w) ==
  /\ phase[w] = "idle"
  /\ holder = "none"
  /\ pointer' = "t1"
  /\ holder' = "t1"
  /\ holderDeleted' = FALSE
  /\ phase' = [phase EXCEPT ![w] = "done"]
  /\ bound' = TRUE
  /\ UNCHANGED extra

Join(w) ==
  /\ phase[w] = "idle"
  /\ holder # "none"
  /\ ~holderDeleted
  /\ UniquePageId
  /\ pointer' = holder
  /\ phase' = [phase EXCEPT ![w] = "done"]
  /\ bound' = TRUE
  /\ UNCHANGED <<holder, holderDeleted, extra>>

Duplicate(w) ==
  /\ phase[w] = "idle"
  /\ holder # "none"
  /\ ~holderDeleted
  /\ ~UniquePageId
  /\ extra' = TRUE
  /\ phase' = [phase EXCEPT ![w] = "done"]
  /\ UNCHANGED <<pointer, holder, holderDeleted, bound>>

SeedImport ==
  /\ pointer = "none"
  /\ holder = "none"
  /\ ~bound
  /\ \A w \in Writers: phase[w] = "idle"
  /\ pointer' = "t1"
  /\ UNCHANGED <<holder, holderDeleted, extra, phase, bound>>

SeedAssociated ==
  /\ pointer = "none"
  /\ holder = "none"
  /\ ~bound
  /\ \A w \in Writers: phase[w] = "idle"
  /\ holder' = "t1"
  /\ UNCHANGED <<pointer, holderDeleted, extra, phase, bound>>

Claim(w) ==
  /\ phase[w] = "idle"
  /\ pointer # "none"
  /\ holder = "none"
  /\ holder' = pointer
  /\ phase' = [phase EXCEPT ![w] = "done"]
  /\ bound' = TRUE
  /\ UNCHANGED <<pointer, holderDeleted, extra>>

Backfill(w) ==
  /\ phase[w] = "idle"
  /\ pointer = "none"
  /\ holder # "none"
  /\ ~holderDeleted
  /\ pointer' = holder
  /\ phase' = [phase EXCEPT ![w] = "done"]
  /\ bound' = TRUE
  /\ UNCHANGED <<holder, holderDeleted, extra>>

DeleteThread ==
  /\ holder # "none"
  /\ ~holderDeleted
  /\ holderDeleted' = TRUE
  /\ UNCHANGED <<pointer, holder, extra, phase, bound>>

BlockDeleted(w) ==
  /\ phase[w] = "idle"
  /\ holder # "none"
  /\ holderDeleted
  /\ phase' = [phase EXCEPT ![w] = "rejected"]
  /\ UNCHANGED <<pointer, holder, holderDeleted, extra, bound>>

Mispoint ==
  /\ ~CrossPageRejected
  /\ pointer' = "t2"
  /\ holder' = "t1"
  /\ holderDeleted' = FALSE
  /\ UNCHANGED <<extra, phase, bound>>

AtMostOne == ~extra

PointerAgrees ==
  \/ pointer = "none"
  \/ holder = "none"
  \/ pointer = holder

NeverBound == ~bound
NeverRejected == \A w \in Writers: phase[w] # "rejected"

Next ==
  \/ \E w \in Writers:
       Create(w) \/ Join(w) \/ Duplicate(w) \/ Claim(w) \/ Backfill(w) \/ BlockDeleted(w)
  \/ DeleteThread
  \/ SeedImport
  \/ SeedAssociated
  \/ Mispoint

Spec == Init /\ [][Next]_vars
====
