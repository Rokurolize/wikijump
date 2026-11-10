---- MODULE PageRevisionFreshness ----
EXTENDS Integers

CONSTANTS MaxRev, FreshnessGuard, ServeRequiresCurrentGen

VARIABLES head, artRev, artIn, artGen, inputs, gen, flight, flightIn, flightGen, served, discarded

vars == <<head, artRev, artIn, artGen, inputs, gen, flight, flightIn, flightGen, served, discarded>>

TypeOK ==
  /\ head \in 1..MaxRev
  /\ artRev \in 1..MaxRev
  /\ artIn \in 0..1
  /\ artGen \in 0..1
  /\ inputs \in 0..1
  /\ gen \in 0..1
  /\ flight \in 0..MaxRev
  /\ flightIn \in 0..1
  /\ flightGen \in 0..1
  /\ served \in BOOLEAN
  /\ discarded \in BOOLEAN

Init ==
  /\ head = 1
  /\ artRev = 1
  /\ artIn = 0
  /\ artGen = 0
  /\ inputs = 0
  /\ gen = 0
  /\ flight = 0
  /\ flightIn = 0
  /\ flightGen = 0
  /\ served = TRUE
  /\ discarded = FALSE

StartRender ==
  /\ flight = 0
  /\ flight' = head
  /\ flightIn' = inputs
  /\ flightGen' = gen
  /\ UNCHANGED <<head, artRev, artIn, artGen, inputs, gen, served, discarded>>

Advance ==
  /\ head < MaxRev
  /\ head' = head + 1
  /\ artRev' = head'
  /\ artIn' = inputs
  /\ artGen' = gen
  /\ served' = FALSE
  /\ UNCHANGED <<inputs, gen, flight, flightIn, flightGen, discarded>>

InputBump ==
  /\ inputs < 1
  /\ inputs' = inputs + 1
  /\ served' = FALSE
  /\ UNCHANGED <<head, artRev, artIn, artGen, gen, flight, flightIn, flightGen, discarded>>

GenBump ==
  /\ gen < 1
  /\ gen' = gen + 1
  /\ served' = FALSE
  /\ UNCHANGED <<head, artRev, artIn, artGen, inputs, flight, flightIn, flightGen, discarded>>

CommitRender ==
  /\ flight # 0
  /\ FreshnessGuard => flight = head
  /\ artRev' = flight
  /\ artIn' = flightIn
  /\ artGen' = flightGen
  /\ flight' = 0
  /\ flightIn' = 0
  /\ flightGen' = 0
  /\ served' = FALSE
  /\ UNCHANGED <<head, inputs, gen, discarded>>

Discard ==
  /\ FreshnessGuard
  /\ flight # 0
  /\ flight # head
  /\ flight' = 0
  /\ flightIn' = 0
  /\ flightGen' = 0
  /\ discarded' = TRUE
  /\ UNCHANGED <<head, artRev, artIn, artGen, inputs, gen, served>>

Serve ==
  /\ ServeRequiresCurrentGen => artGen = gen
  /\ served' = TRUE
  /\ UNCHANGED <<head, artRev, artIn, artGen, inputs, gen, flight, flightIn, flightGen, discarded>>

Done ==
  /\ ~(ENABLED (StartRender \/ Advance \/ InputBump \/ GenBump \/ CommitRender \/ Discard \/ Serve))
  /\ UNCHANGED vars

Next == StartRender \/ Advance \/ InputBump \/ GenBump \/ CommitRender \/ Discard \/ Serve \/ Done

StaleNeverOverwrites == artRev = head

ServedFromHead == served => artRev = head /\ artGen = gen

NoDiscard == ~discarded

Spec == Init /\ [][Next]_vars
====
