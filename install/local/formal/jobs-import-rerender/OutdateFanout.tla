------------------------------ MODULE OutdateFanout ------------------------------
EXTENDS Integers
CONSTANTS SkipAt, SkipWhenOlder, DedupeOn, BoundAge
Pages == {"p1", "p2", "p3"}
VARIABLES edited, dup, queued, renders, skips, content
vars == <<edited, dup, queued, renders, skips, content>>

Depth == [p1 |-> 1, p2 |-> 2, p3 |-> SkipAt]
Age == [p1 |-> "old", p2 |-> "old", p3 |-> BoundAge]

Init ==
    /\ edited = FALSE
    /\ dup = FALSE
    /\ queued = [p \in Pages |-> 0]
    /\ renders = [p \in Pages |-> 0]
    /\ skips = [p \in Pages |-> 0]
    /\ content = [p \in Pages |-> 1]

ActionSkip(p) ==
    /\ Depth[p] >= SkipAt
    /\ IF SkipWhenOlder THEN Age[p] = "old" ELSE Age[p] = "recent"

Pending(p) == queued[p] > renders[p] + skips[p]

Edit ==
    /\ ~edited
    /\ edited' = TRUE
    /\ dup' = TRUE
    /\ queued' = [queued EXCEPT !["p1"] = 1]
    /\ UNCHANGED <<renders, skips, content>>

Again ==
    /\ dup
    /\ dup' = FALSE
    /\ IF DedupeOn THEN UNCHANGED queued
       ELSE queued' = [queued EXCEPT !["p1"] = queued["p1"] + 1]
    /\ UNCHANGED <<edited, renders, skips, content>>

Run(p) ==
    /\ Pending(p)
    /\ ~ActionSkip(p)
    /\ renders' = [renders EXCEPT ![p] = renders[p] + 1]
    /\ content' = [content EXCEPT ![p] = 2]
    /\ IF p = "p1" /\ queued["p2"] = 0 THEN queued' = [queued EXCEPT !["p2"] = 1]
       ELSE IF p = "p2" /\ queued["p3"] = 0 THEN queued' = [queued EXCEPT !["p3"] = 1]
       ELSE UNCHANGED queued
    /\ UNCHANGED <<edited, dup, skips>>

Skip(p) ==
    /\ Pending(p)
    /\ ActionSkip(p)
    /\ skips' = [skips EXCEPT ![p] = skips[p] + 1]
    /\ UNCHANGED <<edited, dup, queued, renders, content>>

Rest ==
    /\ edited /\ ~dup
    /\ \A p \in Pages : ~Pending(p)
    /\ UNCHANGED vars

Next == Edit \/ Again \/ Rest \/ (\E p \in Pages : Run(p) \/ Skip(p))
Spec == Init /\ [][Next]_vars

TypeOK ==
    /\ edited \in BOOLEAN /\ dup \in BOOLEAN
    /\ \A p \in Pages : queued[p] \in 0..2 /\ renders[p] \in 0..2 /\ skips[p] \in 0..2
    /\ \A p \in Pages : content[p] \in 1..2

Quiescent == edited /\ ~dup /\ \A p \in Pages : queued[p] = renders[p] + skips[p]

MustRender(p) == Depth[p] < SkipAt \/ Age[p] = "recent"

BelowBoundOnce ==
    Quiescent =>
        \A p \in Pages :
            /\ renders[p] <= 1
            /\ IF MustRender(p)
               THEN renders[p] = 1 /\ content[p] = 2
               ELSE renders[p] = 0 /\ content[p] = 1

NeverEdited == ~edited
NeverRendered == renders["p1"] = 0
=============================================================================
