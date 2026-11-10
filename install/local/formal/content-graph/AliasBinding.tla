---- MODULE AliasBinding ----
EXTENDS FiniteSets

CONSTANTS DirectUnique, RenameMovesDirect, RejectForeignAlias

Ids == {"i1", "i2"}
Slugs == {"s1", "s2", "s3"}
None == "none"

VARIABLES direct, alias, rejected, aliased, last

vars == <<direct, alias, rejected, aliased, last>>

TypeOK ==
  /\ direct \in [Ids -> Slugs]
  /\ alias \in [Slugs -> Ids \union {None}]
  /\ rejected \in BOOLEAN
  /\ aliased \in BOOLEAN
  /\ last \in {"init", "reject", "collide", "swap", "rename", "overlap", "remove"}

Init ==
  /\ direct = [i \in Ids |-> IF i = "i1" THEN "s1" ELSE "s2"]
  /\ alias = [s \in Slugs |-> None]
  /\ rejected = FALSE
  /\ aliased = FALSE
  /\ last = "init"

Rename(i, new) ==
  LET old == direct[i]
      otherDirect == \E j \in Ids: j # i /\ direct[j] = new
      foreign == alias[new] # None /\ alias[new] # i
      own == alias[new] = i
      free == alias[new] = None
  IN
    /\ old # new
    /\ \/ /\ otherDirect
          /\ DirectUnique
          /\ rejected' = TRUE
          /\ last' = "reject"
          /\ UNCHANGED <<direct, alias, aliased>>
       \/ /\ otherDirect
          /\ ~DirectUnique
          /\ direct' = [direct EXCEPT ![i] = new]
          /\ alias' = [alias EXCEPT ![old] = i]
          /\ aliased' = TRUE
          /\ last' = "collide"
          /\ UNCHANGED rejected
       \/ /\ ~otherDirect
          /\ foreign
          /\ RejectForeignAlias
          /\ rejected' = TRUE
          /\ last' = "reject"
          /\ UNCHANGED <<direct, alias, aliased>>
       \/ /\ ~otherDirect
          /\ foreign
          /\ ~RejectForeignAlias
          /\ LET owner == alias[new] IN
               alias' = [alias EXCEPT ![new] = None, ![old] = owner]
          /\ direct' = [direct EXCEPT ![i] = new]
          /\ aliased' = TRUE
          /\ last' = "swap"
          /\ UNCHANGED rejected
       \/ /\ ~otherDirect
          /\ own
          /\ alias' = [alias EXCEPT ![new] = None, ![old] = i]
          /\ direct' = [direct EXCEPT ![i] = new]
          /\ aliased' = TRUE
          /\ last' = "swap"
          /\ UNCHANGED rejected
       \/ /\ ~otherDirect
          /\ free
          /\ direct' = IF RenameMovesDirect THEN [direct EXCEPT ![i] = new] ELSE direct
          /\ alias' = [alias EXCEPT ![old] = i]
          /\ aliased' = TRUE
          /\ last' = IF RenameMovesDirect THEN "rename" ELSE "overlap"
          /\ UNCHANGED rejected

RemoveAll(i) ==
  /\ \E s \in Slugs: alias[s] = i
  /\ alias' = [s \in Slugs |-> IF alias[s] = i THEN None ELSE alias[s]]
  /\ last' = "remove"
  /\ UNCHANGED <<direct, rejected, aliased>>

Next ==
  \/ \E i \in Ids: \E new \in Slugs: Rename(i, new)
  \/ \E i \in Ids: RemoveAll(i)

OneOwner ==
  /\ \A i, j \in Ids: i # j => direct[i] # direct[j]
  /\ \A s \in Slugs: alias[s] = None \/ ~\E i \in Ids: direct[i] = s

NeverAliased == ~aliased

Spec == Init /\ [][Next]_vars
====
