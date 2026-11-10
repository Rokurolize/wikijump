---- MODULE PostCommitOutbox ----
EXTENDS Integers, Sequences

CONSTANTS RunIffCommit, InvalidateFirst, AuthCommits, ImmediateSplit

VARIABLES phase, q, ran, marked, authDurable

vars == <<phase, q, ran, marked, authDurable>>

Phases == {"idle", "open", "committed", "rolledback", "authreject"}

Queue(s) == Len(s) <= 3 /\ \A i \in 1..Len(s): s[i] \in {"inv", "page", "imm"}

TypeOK ==
  /\ phase \in Phases
  /\ Queue(q)
  /\ Queue(ran)
  /\ marked \in BOOLEAN
  /\ authDurable \in BOOLEAN

Init ==
  /\ phase = "idle"
  /\ q = <<>>
  /\ ran = <<>>
  /\ marked = FALSE
  /\ authDurable = FALSE

Has(s, name) == \E i \in 1..Len(s): s[i] = name

RECURSIVE InsertInv(_)
InsertInv(s) ==
  IF s = <<>> THEN <<"inv">>
  ELSE IF Head(s) = "page" \/ (ImmediateSplit /\ Head(s) = "imm")
       THEN <<"inv">> \o s
       ELSE <<Head(s)>> \o InsertInv(Tail(s))

Begin ==
  /\ phase = "idle"
  /\ phase' = "open"
  /\ q' = <<>>
  /\ ran' = <<>>
  /\ marked' = FALSE
  /\ authDurable' = FALSE

QueueInv ==
  /\ phase = "open"
  /\ Len(q) < 3
  /\ ~Has(q, "inv")
  /\ q' = IF InvalidateFirst THEN InsertInv(q) ELSE Append(q, "inv")
  /\ UNCHANGED <<phase, ran, marked, authDurable>>

QueuePage ==
  /\ phase = "open"
  /\ Len(q) < 3
  /\ ~Has(q, "page")
  /\ q' = Append(q, "page")
  /\ UNCHANGED <<phase, ran, marked, authDurable>>

QueueImm ==
  /\ phase = "open"
  /\ Len(q) < 3
  /\ ~Has(q, "imm")
  /\ q' = Append(q, "imm")
  /\ UNCHANGED <<phase, ran, marked, authDurable>>

Mark ==
  /\ phase = "open"
  /\ ~marked
  /\ marked' = TRUE
  /\ UNCHANGED <<phase, q, ran, authDurable>>

Commit ==
  /\ phase = "open"
  /\ ~marked
  /\ phase' = "committed"
  /\ ran' = q
  /\ UNCHANGED <<q, marked, authDurable>>

Rollback ==
  /\ phase = "open"
  /\ ~marked
  /\ phase' = "rolledback"
  /\ ran' = IF RunIffCommit THEN <<>> ELSE q
  /\ UNCHANGED <<q, marked, authDurable>>

AuthReject ==
  /\ phase = "open"
  /\ marked
  /\ phase' = "authreject"
  /\ authDurable' = IF AuthCommits THEN TRUE ELSE FALSE
  /\ ran' = <<>>
  /\ UNCHANGED <<q, marked>>

Step == Begin \/ QueueInv \/ QueuePage \/ QueueImm \/ Mark \/ Commit \/ Rollback \/ AuthReject
Done == ~(ENABLED Step) /\ UNCHANGED vars
Next == Step \/ Done

NoLater(s, earlier, later) ==
  ~\E i, j \in 1..Len(s): i < j /\ s[i] = earlier /\ s[j] = later

ActionsIffCommit ==
  /\ (phase \in {"idle", "open", "rolledback", "authreject"}) => ran = <<>>
  /\ phase = "committed" => ran = q

InvalidateBeforePage == NoLater(q, "page", "inv") /\ NoLater(ran, "page", "inv")

InvalidateBeforeImmediate == NoLater(q, "imm", "inv") /\ NoLater(ran, "imm", "inv")

AuthCountersOnReject == phase = "authreject" => authDurable

NeverRolledBack == phase # "rolledback"

Spec == Init /\ [][Next]_vars
====
