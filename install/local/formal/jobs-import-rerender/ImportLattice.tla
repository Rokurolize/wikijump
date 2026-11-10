------------------------------ MODULE ImportLattice ------------------------------
EXTENDS Integers
CONSTANTS MaxAttempts, SeparatePasses, RespectBound, AllowFinalCrash
VARIABLES phase, attempts, hold1, hold2, lease, pass
vars == <<phase, attempts, hold1, hold2, lease, pass>>

Init ==
    /\ phase = "pending"
    /\ attempts = 0
    /\ hold1 = FALSE
    /\ hold2 = FALSE
    /\ lease = "none"
    /\ pass = 0

TypeOK ==
    /\ phase \in {"pending", "running", "rendered", "failed", "done"}
    /\ attempts \in 0..(MaxAttempts + 1)
    /\ hold1 \in BOOLEAN /\ hold2 \in BOOLEAN
    /\ lease \in {"none", "open", "expired"}
    /\ pass \in 0..2

room == attempts < MaxAttempts + 1 /\ (RespectBound => attempts < MaxAttempts)

Claim1 ==
    /\ room
    /\ ~hold1
    /\ IF SeparatePasses
       THEN /\ ~hold2
            /\ \/ phase = "pending"
               \/ /\ pass = 1
                  /\ \/ phase = "failed"
                     \/ (phase = "running" /\ lease = "expired")
       ELSE phase # "done"
    /\ phase' = "running"
    /\ attempts' = attempts + 1
    /\ hold1' = TRUE
    /\ lease' = "open"
    /\ pass' = 1
    /\ UNCHANGED <<hold2>>

Claim2 ==
    /\ room
    /\ ~hold2
    /\ IF SeparatePasses
       THEN /\ ~hold1
            /\ \/ phase = "rendered"
               \/ /\ pass = 2
                  /\ \/ phase = "failed"
                     \/ (phase = "running" /\ lease = "expired")
       ELSE phase # "done"
    /\ phase' = "running"
    /\ attempts' = attempts + 1
    /\ hold2' = TRUE
    /\ lease' = "open"
    /\ pass' = 2
    /\ UNCHANGED <<hold1>>

Complete ==
    /\ lease = "open"
    /\ \/ /\ hold1 /\ phase' = "rendered" /\ hold1' = FALSE /\ UNCHANGED hold2
       \/ /\ hold2 /\ phase' = "done" /\ hold2' = FALSE /\ UNCHANGED hold1
    /\ lease' = "none"
    /\ UNCHANGED <<attempts, pass>>

Fail ==
    /\ lease = "open"
    /\ (hold1 \/ hold2)
    /\ phase' = "failed"
    /\ lease' = "none"
    /\ hold1' = FALSE
    /\ hold2' = FALSE
    /\ UNCHANGED <<attempts, pass>>

Crash ==
    /\ lease = "open"
    /\ (hold1 \/ hold2)
    /\ (AllowFinalCrash \/ attempts < MaxAttempts)
    /\ lease' = "expired"
    /\ hold1' = FALSE
    /\ hold2' = FALSE
    /\ UNCHANGED <<phase, attempts, pass>>

Rest ==
    /\ \/ phase = "done"
       \/ (phase = "failed" /\ attempts >= MaxAttempts)
    /\ UNCHANGED vars

Next == Claim1 \/ Claim2 \/ Complete \/ Fail \/ Crash \/ Rest
Spec == Init /\ [][Next]_vars /\ SF_vars(Claim1) /\ SF_vars(Claim2) /\ SF_vars(Complete)

AttemptsBound == attempts <= MaxAttempts
OneHolder == ~(hold1 /\ hold2)
Restartable == (phase = "running" /\ lease = "expired") => attempts < MaxAttempts
EarlyRecovers ==
    (phase = "running" /\ lease = "expired" /\ attempts < MaxAttempts)
    ~> (lease = "open" \/ phase \in {"rendered", "done", "failed"})
Pass2Claims ==
    (phase = "rendered" /\ attempts < MaxAttempts) ~> (phase # "rendered")
TerminalOrRetry ==
    \/ phase \in {"done", "failed"}
    \/ attempts < MaxAttempts
    \/ (phase = "running" /\ lease = "open")
=============================================================================
