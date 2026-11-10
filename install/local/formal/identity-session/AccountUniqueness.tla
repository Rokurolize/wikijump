---- MODULE AccountUniqueness ----
EXTENDS Integers

CONSTANTS Users, SlugUnique, EmailUnique, DeleteMarks

VARIABLES slot, slug, email, verified, deletedOnce, rereg

vars == <<slot, slug, email, verified, deletedOnce, rereg>>

TypeOK ==
    /\ slot \in [Users -> {"empty", "live", "deleted"}]
    /\ slug \in [Users -> {"", "a", "b"}]
    /\ email \in [Users -> {"", "e", "f"}]
    /\ verified \in [Users -> BOOLEAN]
    /\ deletedOnce \in [Users -> BOOLEAN]
    /\ rereg \in [Users -> BOOLEAN]

Init ==
    /\ slot = [u \in Users |-> "empty"]
    /\ slug = [u \in Users |-> ""]
    /\ email = [u \in Users |-> ""]
    /\ verified = [u \in Users |-> FALSE]
    /\ deletedOnce = [u \in Users |-> FALSE]
    /\ rereg = [u \in Users |-> FALSE]

SlugTaken(u, s) ==
    \E v \in Users: v # u /\ slot[v] = "live" /\ slug[v] = s

EmailTaken(u, e) ==
    \E v \in Users: v # u /\ slot[v] = "live" /\ email[v] = e

Create(u) ==
    /\ slot[u] = "empty"
    /\ \E s \in {"a", "b"}:
         \E e \in {"e", "f"}:
           /\ SlugUnique => ~SlugTaken(u, s)
           /\ EmailUnique => ~EmailTaken(u, e)
           /\ slot' = [slot EXCEPT ![u] = "live"]
           /\ slug' = [slug EXCEPT ![u] = s]
           /\ email' = [email EXCEPT ![u] = e]
           /\ UNCHANGED <<verified, deletedOnce, rereg>>

Rename(u) ==
    /\ slot[u] = "live"
    /\ \E s \in {"a", "b"}:
         /\ s # slug[u]
         /\ SlugUnique => ~SlugTaken(u, s)
         /\ slug' = [slug EXCEPT ![u] = s]
         /\ UNCHANGED <<slot, email, verified, deletedOnce, rereg>>

Delete(u) ==
    /\ slot[u] = "live"
    /\ deletedOnce' = [deletedOnce EXCEPT ![u] = TRUE]
    /\ slot' = IF DeleteMarks THEN [slot EXCEPT ![u] = "deleted"] ELSE slot
    /\ UNCHANGED <<slug, email, verified, rereg>>

Reregister(u) ==
    /\ slot[u] = "deleted"
    /\ ~rereg[u]
    /\ \E s \in {"a", "b"}:
         \E e \in {"e", "f"}:
           /\ SlugUnique => ~SlugTaken(u, s)
           /\ EmailUnique => ~EmailTaken(u, e)
           /\ slot' = [slot EXCEPT ![u] = "live"]
           /\ slug' = [slug EXCEPT ![u] = s]
           /\ email' = [email EXCEPT ![u] = e]
           /\ verified' = [verified EXCEPT ![u] = FALSE]
           /\ rereg' = [rereg EXCEPT ![u] = TRUE]
           /\ UNCHANGED <<deletedOnce>>

Verify(u) ==
    /\ slot[u] = "live"
    /\ ~verified[u]
    /\ verified' = [verified EXCEPT ![u] = TRUE]
    /\ email' = [v \in Users |->
         IF v # u /\ slot[v] = "live" /\ email[v] = email[u] THEN "" ELSE email[v]]
    /\ UNCHANGED <<slot, slug, deletedOnce, rereg>>

Next ==
    \E u \in Users: Create(u) \/ Rename(u) \/ Delete(u) \/ Reregister(u) \/ Verify(u)

Spec == Init /\ [][Next]_vars

LiveUnique ==
    \A u, v \in Users:
        u = v \/ slot[u] # "live" \/ slot[v] # "live"
        \/ (slug[u] # slug[v] /\ (email[u] = "" \/ email[u] # email[v]))

DeleteFrees ==
    \A u \in Users: ~deletedOnce[u] \/ slot[u] = "deleted" \/ rereg[u]

NeverReregistered == \A u \in Users: ~rereg[u]

====
