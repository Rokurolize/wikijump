---- MODULE SessionPhase ----
EXTENDS Integers

CONSTANTS
    RestrictedInvisible,
    CookieOnlyAfterFactors,
    ClearDeadCookie,
    RetainFaultCookie,
    StepAdvances

VARIABLES
    phase, cookie, outcome, used, restrictedAuth, lastStep, badStep, relogin, ended

vars == <<phase, cookie, outcome, used, restrictedAuth, lastStep, badStep, relogin, ended>>

TypeOK ==
    /\ phase \in {"none", "restricted", "normal", "dead"}
    /\ cookie \in {"none", "held", "cleared"}
    /\ outcome \in {"pending", "session", "anonymous", "fault"}
    /\ used \in BOOLEAN
    /\ restrictedAuth \in BOOLEAN
    /\ lastStep \in 0..2
    /\ badStep \in BOOLEAN
    /\ relogin \in 0..2
    /\ ended \in {"", "revoked", "expired"}

Init ==
    /\ phase = "none"
    /\ cookie = "none"
    /\ outcome = "pending"
    /\ used = FALSE
    /\ restrictedAuth = FALSE
    /\ lastStep = 0
    /\ badStep = FALSE
    /\ relogin = 0
    /\ ended = ""

Login ==
    /\ phase = "none"
    /\ \E needsMfa \in BOOLEAN:
         /\ phase' = IF needsMfa THEN "restricted" ELSE "normal"
         /\ cookie' = IF needsMfa /\ CookieOnlyAfterFactors THEN "none" ELSE "held"
    /\ outcome' = "pending"
    /\ used' = FALSE
    /\ UNCHANGED <<restrictedAuth, lastStep, badStep, relogin, ended>>

Relogin ==
    /\ phase \in {"normal", "dead"}
    /\ relogin < 2
    /\ phase' = "restricted"
    /\ cookie' = IF CookieOnlyAfterFactors THEN "none" ELSE "held"
    /\ outcome' = "pending"
    /\ used' = FALSE
    /\ relogin' = relogin + 1
    /\ ended' = ""
    /\ UNCHANGED <<restrictedAuth, lastStep, badStep>>

Mfa(step) ==
    /\ phase = "restricted"
    /\ step \in 1..2
    /\ \/ /\ StepAdvances
          /\ step <= lastStep
          /\ UNCHANGED vars
       \/ /\ (~StepAdvances \/ step > lastStep)
          /\ phase' = "normal"
          /\ cookie' = "held"
          /\ lastStep' = step
          /\ badStep' = (badStep \/ (step <= lastStep))
          /\ outcome' = "pending"
          /\ used' = FALSE
          /\ UNCHANGED <<restrictedAuth, relogin, ended>>

Authorize ==
    /\ phase = "restricted"
    /\ ~RestrictedInvisible
    /\ restrictedAuth' = TRUE
    /\ UNCHANGED <<phase, cookie, outcome, used, lastStep, badStep, relogin, ended>>

End(kind) ==
    /\ kind \in {"revoked", "expired"}
    /\ phase \in {"restricted", "normal"}
    /\ phase' = "dead"
    /\ ended' = kind
    /\ outcome' = "pending"
    /\ used' = FALSE
    /\ UNCHANGED <<cookie, restrictedAuth, lastStep, badStep, relogin>>

Resolve ==
    /\ outcome = "pending"
    /\ IF phase = "normal"
         THEN /\ outcome' = "session"
              /\ cookie' = "held"
              /\ used' = TRUE
         ELSE /\ outcome' = "anonymous"
              /\ used' = FALSE
              /\ cookie' = IF ClearDeadCookie THEN "cleared" ELSE cookie
    /\ UNCHANGED <<phase, restrictedAuth, lastStep, badStep, relogin, ended>>

Fault ==
    /\ outcome = "pending"
    /\ phase = "normal"
    /\ cookie = "held"
    /\ outcome' = "fault"
    /\ used' = FALSE
    /\ cookie' = IF RetainFaultCookie THEN "held" ELSE "cleared"
    /\ UNCHANGED <<phase, restrictedAuth, lastStep, badStep, relogin, ended>>

Next ==
    \/ Login
    \/ Relogin
    \/ Authorize
    \/ Resolve
    \/ Fault
    \/ \E kind \in {"revoked", "expired"}: End(kind)
    \/ \E step \in 1..2: Mfa(step)

Spec == Init /\ [][Next]_vars

AuthorityIsPhase == ~restrictedAuth

NoPendingCookie == ~(phase = "restricted" /\ cookie = "held")

StepsMonotone == ~badStep

CookieFollows ==
    /\ (outcome = "session" => phase = "normal" /\ cookie = "held" /\ used)
    /\ (outcome = "anonymous" => cookie # "held" /\ ~used)
    /\ (outcome = "fault" => cookie = "held" /\ ~used)

NeverRestricted == phase # "restricted"

NeverDead == phase # "dead"

NeverSession == outcome # "session"

====
