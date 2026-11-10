---- MODULE PageLifecycle ----
EXTENDS Integers

CONSTANTS Writers, MaxHead, MaxTries, CommitGuarded, DeleteSetsDeleted, RestoreKeepsIdentity

VARIABLES head, deleted, headType, pageId, identity, phase, seen, op, tries, claims

vars == <<head, deleted, headType, pageId, identity, phase, seen, op, tries, claims>>

Live == {"Create", "Regular", "Move", "Undelete", "Rollback"}

TypeOK ==
  /\ head \in 0..MaxHead
  /\ deleted \in BOOLEAN
  /\ headType \in {"none"} \union Live \union {"Delete"}
  /\ pageId \in 0..3
  /\ identity \in 0..3
  /\ phase \in [Writers -> {"idle", "armed", "done", "rejected"}]
  /\ seen \in [Writers -> 0..MaxHead]
  /\ op \in [Writers -> {"create", "edit", "move", "delete", "restore", "rollback"}]
  /\ tries \in [Writers -> 0..MaxTries]
  /\ claims \in [0..MaxHead -> 0..4]

Init ==
  /\ head = 0
  /\ deleted = FALSE
  /\ headType = "none"
  /\ pageId = 0
  /\ identity = 0
  /\ phase = [w \in Writers |-> "idle"]
  /\ seen = [w \in Writers |-> 0]
  /\ op = [w \in Writers |-> "create"]
  /\ tries = [w \in Writers |-> 0]
  /\ claims = [n \in 0..MaxHead |-> 0]

Legal(choice) ==
  \/ /\ choice = "create"
     /\ head = 0
  \/ /\ choice \in {"edit", "move", "rollback", "delete"}
     /\ head > 0
     /\ ~deleted
  \/ /\ choice = "restore"
     /\ head > 0
     /\ deleted

CanApply(w) ==
  /\ head = seen[w]
  /\ claims[seen[w]] = 0
  /\ Legal(op[w])

Arm(w) ==
  /\ phase[w] # "armed"
  /\ tries[w] < MaxTries
  /\ \E choice \in {"create", "edit", "move", "delete", "restore", "rollback"}:
       /\ Legal(choice)
       /\ op' = [op EXCEPT ![w] = choice]
       /\ seen' = [seen EXCEPT ![w] = head]
       /\ phase' = [phase EXCEPT ![w] = "armed"]
       /\ tries' = [tries EXCEPT ![w] = tries[w] + 1]
       /\ UNCHANGED <<head, deleted, headType, pageId, identity, claims>>

Commit(w) ==
  /\ phase[w] = "armed"
  /\ seen[w] < MaxHead
  /\ CommitGuarded => CanApply(w)
  /\ LET pred == seen[w] IN
       /\ head' = pred + 1
       /\ claims' = [claims EXCEPT ![pred] = claims[pred] + 1]
       /\ phase' = [phase EXCEPT ![w] = "done"]
       /\ CASE op[w] = "create" ->
              /\ pageId' = 1
              /\ identity' = 1
              /\ deleted' = FALSE
              /\ headType' = "Create"
          [] op[w] = "edit" ->
              /\ pageId' = pageId
              /\ identity' = identity
              /\ deleted' = FALSE
              /\ headType' = "Regular"
          [] op[w] = "move" ->
              /\ pageId' = pageId
              /\ identity' = identity
              /\ deleted' = FALSE
              /\ headType' = "Move"
          [] op[w] = "rollback" ->
              /\ pageId' = pageId
              /\ identity' = identity
              /\ deleted' = FALSE
              /\ headType' = "Rollback"
          [] op[w] = "delete" ->
              /\ pageId' = pageId
              /\ identity' = identity
              /\ deleted' = IF DeleteSetsDeleted THEN TRUE ELSE FALSE
              /\ headType' = "Delete"
          [] op[w] = "restore" ->
              /\ pageId' = IF RestoreKeepsIdentity THEN pageId ELSE pageId + 1
              /\ identity' = IF RestoreKeepsIdentity THEN identity ELSE identity + 1
              /\ deleted' = FALSE
              /\ headType' = "Undelete"
       /\ UNCHANGED <<seen, op, tries>>

Reject(w) ==
  /\ phase[w] = "armed"
  /\ CommitGuarded
  /\ ~CanApply(w)
  /\ phase' = [phase EXCEPT ![w] = "rejected"]
  /\ UNCHANGED <<head, deleted, headType, pageId, identity, seen, op, tries, claims>>

ArmW == \E w \in Writers: Arm(w)
CommitW == \E w \in Writers: Commit(w)
RejectW == \E w \in Writers: Reject(w)
Done == ~(ENABLED (ArmW \/ CommitW \/ RejectW)) /\ UNCHANGED vars
Next == ArmW \/ CommitW \/ RejectW \/ Done

OneWriterPerPredecessor == \A n \in 0..MaxHead: claims[n] <= 1

HeadMonotone == \A n \in 0..MaxHead: (claims[n] >= 1) <=> (n < head)

DeletedAgrees ==
  \/ /\ head = 0
     /\ ~deleted
     /\ headType = "none"
  \/ /\ head > 0
     /\ headType = "Delete"
     /\ deleted
  \/ /\ head > 0
     /\ headType \in Live
     /\ ~deleted

IdentityPreserved ==
  \/ /\ head = 0
     /\ pageId = 0
     /\ identity = 0
  \/ /\ head > 0
     /\ pageId = 1
     /\ identity = 1

NoRejection == \A w \in Writers: phase[w] # "rejected"
NeverRestored == headType # "Undelete"

Spec == Init /\ [][Next]_vars
====
