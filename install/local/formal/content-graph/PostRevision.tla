---- MODULE PostRevision ----
EXTENDS Integers

CONSTANTS Writers, MaxRev, MaxTries, UniqueRevision

VARIABLES latest, claims, phase, seen, tries

vars == <<latest, claims, phase, seen, tries>>

TypeOK ==
  /\ latest \in 0..MaxRev
  /\ claims \in [0..MaxRev -> 0..4]
  /\ phase \in [Writers -> {"idle", "armed", "done", "rejected"}]
  /\ seen \in [Writers -> 0..MaxRev]
  /\ tries \in [Writers -> 0..MaxTries]

Init ==
  /\ latest = 0
  /\ claims = [n \in 0..MaxRev |-> IF n = 0 THEN 1 ELSE 0]
  /\ phase = [w \in Writers |-> "idle"]
  /\ seen = [w \in Writers |-> 0]
  /\ tries = [w \in Writers |-> 0]

CanCommit(w) ==
  /\ seen[w] < MaxRev
  /\ latest = seen[w]
  /\ claims[seen[w] + 1] = 0

Arm(w) ==
  /\ phase[w] # "armed"
  /\ tries[w] < MaxTries
  /\ seen' = [seen EXCEPT ![w] = latest]
  /\ phase' = [phase EXCEPT ![w] = "armed"]
  /\ tries' = [tries EXCEPT ![w] = tries[w] + 1]
  /\ UNCHANGED <<latest, claims>>

Commit(w) ==
  /\ phase[w] = "armed"
  /\ seen[w] < MaxRev
  /\ UniqueRevision => CanCommit(w)
  /\ LET nxt == seen[w] + 1 IN
       /\ latest' = nxt
       /\ claims' = [claims EXCEPT ![nxt] = claims[nxt] + 1]
       /\ phase' = [phase EXCEPT ![w] = "done"]
       /\ UNCHANGED <<seen, tries>>

Reject(w) ==
  /\ phase[w] = "armed"
  /\ UniqueRevision
  /\ ~CanCommit(w)
  /\ phase' = [phase EXCEPT ![w] = "rejected"]
  /\ UNCHANGED <<latest, claims, seen, tries>>

OneSuccessor == \A n \in 1..MaxRev: claims[n] <= 1

LatestIsTip ==
  /\ claims[latest] = 1
  /\ \A n \in 0..MaxRev: n > latest => claims[n] = 0

Dense == \A n \in 0..latest: claims[n] = 1

NoRejection == \A w \in Writers: phase[w] # "rejected"

Next == \E w \in Writers: Arm(w) \/ Commit(w) \/ Reject(w)

Spec == Init /\ [][Next]_vars
====
