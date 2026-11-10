---- MODULE ParentGraph ----
EXTENDS Integers, FiniteSets

CONSTANTS CheckLiveCycle, CheckLiveOnly, RestoreRechecks

Pages == 1..3

VARIABLES born, dead, edges, restored, rejected, last

vars == <<born, dead, edges, restored, rejected, last>>

TypeOK ==
  /\ born \subseteq Pages
  /\ dead \subseteq born
  /\ edges \subseteq (Pages \X Pages)
  /\ restored \subseteq Pages
  /\ rejected \in BOOLEAN
  /\ last \in {"init", "create", "add", "remove", "delete", "restore", "reject"}

Init ==
  /\ born = {}
  /\ dead = {}
  /\ edges = {}
  /\ restored = {}
  /\ rejected = FALSE
  /\ last = "init"

LiveParent(deadNow, child, parent) ==
  /\ <<parent, child>> \in edges
  /\ parent \notin deadNow
  /\ child \notin deadNow

P1(deadNow, n) == {p \in Pages: LiveParent(deadNow, n, p)}

P2(deadNow, n) ==
  P1(deadNow, n) \union UNION {P1(deadNow, p) : p \in P1(deadNow, n)}

P3(deadNow, n) ==
  P2(deadNow, n) \union UNION {P1(deadNow, p) : p \in P2(deadNow, n)}

Cyclic(deadNow) ==
  \/ \E n \in Pages: n \in P3(deadNow, n)
  \/ \E p \in Pages: <<p, p>> \in edges /\ p \notin deadNow

CheckDead == IF CheckLiveOnly THEN dead ELSE (Pages \ Pages)

ClosesCycle(p, c) ==
  \/ p = c
  \/ c \in P3(CheckDead, p)

Create(p) ==
  /\ p \notin born
  /\ born' = born \union {p}
  /\ last' = "create"
  /\ UNCHANGED <<dead, edges, restored, rejected>>

Add(p, c) ==
  /\ p \in born /\ c \in born
  /\ p \notin dead /\ c \notin dead
  /\ <<p, c>> \notin edges
  /\ CheckLiveCycle => ~ClosesCycle(p, c)
  /\ edges' = edges \union {<<p, c>>}
  /\ last' = "add"
  /\ UNCHANGED <<born, dead, restored, rejected>>

RejectAdd(p, c) ==
  /\ CheckLiveCycle
  /\ p \in born /\ c \in born
  /\ p \notin dead /\ c \notin dead
  /\ <<p, c>> \notin edges
  /\ ClosesCycle(p, c)
  /\ rejected' = TRUE
  /\ last' = "reject"
  /\ UNCHANGED <<born, dead, edges, restored>>

Remove(p, c) ==
  /\ <<p, c>> \in edges
  /\ p \notin dead /\ c \notin dead
  /\ p \in born /\ c \in born
  /\ edges' = edges \ {<<p, c>>}
  /\ last' = "remove"
  /\ UNCHANGED <<born, dead, restored, rejected>>

Delete(p) ==
  /\ p \in born
  /\ p \notin dead
  /\ dead' = dead \union {p}
  /\ last' = "delete"
  /\ UNCHANGED <<born, edges, restored, rejected>>

WouldCycle(p) == Cyclic(dead \ {p})

Restore(p) ==
  /\ p \in dead
  /\ RestoreRechecks => ~WouldCycle(p)
  /\ dead' = dead \ {p}
  /\ restored' = restored \union {p}
  /\ last' = "restore"
  /\ UNCHANGED <<born, edges, rejected>>

RejectRestore(p) ==
  /\ RestoreRechecks
  /\ p \in dead
  /\ WouldCycle(p)
  /\ rejected' = TRUE
  /\ last' = "reject"
  /\ UNCHANGED <<born, dead, edges, restored>>

LiveAcyclic == ~Cyclic(dead)

NoCycleWithoutRestore == restored = {} => LiveAcyclic

NeverRejected == ~rejected

Next ==
  \/ \E p \in Pages: Create(p) \/ Delete(p) \/ Restore(p) \/ RejectRestore(p)
  \/ \E p \in Pages: \E c \in Pages: Add(p, c) \/ RejectAdd(p, c) \/ Remove(p, c)

Spec == Init /\ [][Next]_vars
====
