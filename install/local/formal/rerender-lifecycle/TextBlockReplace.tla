----------------------------- MODULE TextBlockReplace -----------------------------
EXTENDS Integers
CONSTANTS RetryOn, MaxAttempts
Writers == {"w1", "w2"}
VARIABLES pc, tries, row, live, upload
vars == <<pc, tries, row, live, upload>>

Init ==
    /\ pc = [w \in Writers |-> "idle"]
    /\ tries = [w \in Writers |-> 0]
    /\ row = 0
    /\ live = {0}
    /\ upload = [w \in Writers |-> 0]

id(w) == IF w = "w1" THEN 1 ELSE 2

Upload(w) ==
    /\ pc[w] = "idle"
    /\ upload' = [upload EXCEPT ![w] = id(w)]
    /\ live' = live \cup {id(w)}
    /\ pc' = [pc EXCEPT ![w] = "up"]
    /\ UNCHANGED <<tries, row>>

OtherActive(w) == \E o \in Writers : o # w /\ pc[o] \in {"up", "retry"}

Commit(w) ==
    /\ pc[w] \in {"up", "retry"}
    /\ row' = upload[w]
    /\ pc' = [pc EXCEPT ![w] = "committed"]
    /\ UNCHANGED <<tries, live, upload>>

Lose(w) ==
    /\ pc[w] \in {"up", "retry"}
    /\ OtherActive(w)
    /\ tries[w] < MaxAttempts
    /\ IF RetryOn
       THEN /\ tries' = [tries EXCEPT ![w] = tries[w] + 1]
            /\ pc' = [pc EXCEPT ![w] = "retry"]
            /\ UNCHANGED <<row, live, upload>>
       ELSE /\ pc' = [pc EXCEPT ![w] = "failed"]
            /\ live' = live \ {upload[w]}
            /\ UNCHANGED <<tries, row, upload>>

Rest ==
    /\ \A w \in Writers : pc[w] \in {"committed", "failed"}
    /\ UNCHANGED vars

Next == Rest \/ (\E w \in Writers : Upload(w) \/ Commit(w) \/ Lose(w))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ pc \in [Writers -> {"idle", "up", "retry", "committed", "failed"}]
    /\ tries \in [Writers -> 0..MaxAttempts]
    /\ row \in 0..2
    /\ live \subseteq 0..2
    /\ upload \in [Writers -> 0..2]

Quiescent == \A w \in Writers : pc[w] \in {"committed", "failed"}
RowsLive == row \in live
OverlapCommits == Quiescent => (\A w \in Writers : pc[w] = "committed") /\ RowsLive
NeverBoth == ~(\A w \in Writers : pc[w] = "committed")
=============================================================================
