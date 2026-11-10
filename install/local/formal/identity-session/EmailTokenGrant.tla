---- MODULE EmailTokenGrant ----
EXTENDS Integers

CONSTANTS ConsumeOnce, CompleteRequiresGrant

VARIABLES phase, grants, redeems, completes

vars == <<phase, grants, redeems, completes>>

TypeOK ==
    /\ phase \in {"none", "link", "grant", "done"}
    /\ grants \in 0..2
    /\ redeems \in 0..2
    /\ completes \in 0..2

Init ==
    /\ phase = "none"
    /\ grants = 0
    /\ redeems = 0
    /\ completes = 0

Issue ==
    /\ phase = "none"
    /\ phase' = "link"
    /\ UNCHANGED <<grants, redeems, completes>>

Redeem ==
    /\ grants < 2
    /\ IF ConsumeOnce THEN phase = "link" ELSE phase \in {"link", "grant"}
    /\ phase' = "grant"
    /\ grants' = grants + 1
    /\ redeems' = redeems + 1
    /\ UNCHANGED completes

Complete ==
    /\ completes < 1
    /\ IF CompleteRequiresGrant THEN phase = "grant" ELSE phase \in {"link", "grant"}
    /\ phase' = "done"
    /\ completes' = completes + 1
    /\ UNCHANGED <<grants, redeems>>

Next == Issue \/ Redeem \/ Complete

Spec == Init /\ [][Next]_vars

OneGrant == grants <= 1

CompleteAfterRedeem == completes = 0 \/ redeems >= 1

NeverCompleted == completes = 0

====
