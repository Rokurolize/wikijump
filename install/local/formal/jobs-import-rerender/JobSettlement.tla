------------------------------ MODULE JobSettlement ------------------------------
EXTENDS Integers
CONSTANTS MaxAttempts, FinalOnEqual, SuccessorFirst, Recurring, Outcome
VARIABLES phase, rc, successor, deleted
vars == <<phase, rc, successor, deleted>>

Init ==
    /\ phase = "queued"
    /\ rc = 0
    /\ successor = FALSE
    /\ deleted = FALSE

finalNow == IF FinalOnEqual THEN rc >= MaxAttempts ELSE rc > MaxAttempts

Receive ==
    /\ phase = "queued"
    /\ rc < MaxAttempts + 1
    /\ rc' = rc + 1
    /\ phase' = "hidden"
    /\ UNCHANGED <<successor, deleted>>

Succeed ==
    /\ Outcome = "ok"
    /\ phase = "hidden"
    /\ IF ~Recurring
       THEN /\ deleted' = TRUE
            /\ phase' = "gone"
            /\ UNCHANGED <<rc, successor>>
       ELSE IF SuccessorFirst
            THEN /\ successor' = TRUE
                 /\ phase' = "armed"
                 /\ UNCHANGED <<rc, deleted>>
            ELSE /\ deleted' = TRUE
                 /\ phase' = "dropping"
                 /\ UNCHANGED <<rc, successor>>

FinishSuccessor ==
    /\ phase = "armed"
    /\ deleted' = TRUE
    /\ phase' = "gone"
    /\ UNCHANGED <<rc, successor>>

QueueAfterDelete ==
    /\ phase = "dropping"
    /\ successor' = TRUE
    /\ phase' = "gone"
    /\ UNCHANGED <<rc, deleted>>

Fail ==
    /\ Outcome = "err"
    /\ phase = "hidden"
    /\ IF finalNow
       THEN /\ deleted' = TRUE
            /\ phase' = "gone"
            /\ UNCHANGED <<rc, successor>>
       ELSE /\ phase' = "queued"
            /\ UNCHANGED <<rc, successor, deleted>>

Rest ==
    /\ phase = "gone"
    /\ UNCHANGED vars

Next == Receive \/ Succeed \/ FinishSuccessor \/ QueueAfterDelete \/ Fail \/ Rest
Spec == Init /\ [][Next]_vars /\ SF_vars(Receive) /\ SF_vars(Succeed) /\ SF_vars(Fail)
        /\ SF_vars(FinishSuccessor) /\ SF_vars(QueueAfterDelete)

TypeOK ==
    /\ phase \in {"queued", "hidden", "armed", "dropping", "gone"}
    /\ rc \in 0..(MaxAttempts + 1)
    /\ successor \in BOOLEAN
    /\ deleted \in BOOLEAN

AckedOrExhausted ==
    phase = "gone" =>
        /\ rc \in 1..MaxAttempts
        /\ (Outcome = "err" => rc = MaxAttempts)

ChainLives ==
    Outcome = "ok" /\ Recurring => (deleted => successor)

Settles == <>(phase = "gone")

NeverGone == phase # "gone"
NeverArmed == phase # "armed"
=============================================================================
