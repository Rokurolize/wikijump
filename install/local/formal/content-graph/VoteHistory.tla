---- MODULE VoteHistory ----
EXTENDS Integers

CONSTANTS ScoreIgnoresDisabled, RecastKeepsDisabled, RemoveKeepsDisabled

MaxHist == 3
Values == {-1, 1}

VARIABLES kind, value, score, wasDisabled, moderator, history, last

vars == <<kind, value, score, wasDisabled, moderator, history, last>>

TypeOK ==
  /\ kind \in {"absent", "current", "disabled"}
  /\ value \in Values
  /\ score \in -2..2
  /\ wasDisabled \in BOOLEAN
  /\ moderator \in BOOLEAN
  /\ history \in 0..MaxHist
  /\ last \in {"init", "add", "disable", "enable", "remove", "recast"}

Init ==
  /\ kind = "absent"
  /\ value = 1
  /\ score = 0
  /\ wasDisabled = FALSE
  /\ moderator = FALSE
  /\ history = 0
  /\ last = "init"

ScoreOf(k, v) == IF k = "current" THEN v ELSE 0

Add(v) ==
  \/ /\ kind = "absent"
     /\ kind' = "current"
     /\ value' = v
     /\ score' = v
     /\ last' = "add"
     /\ UNCHANGED <<wasDisabled, moderator, history>>
  \/ /\ kind = "current"
     /\ value # v
     /\ history < MaxHist
     /\ history' = history + 1
     /\ value' = v
     /\ score' = v
     /\ last' = "add"
     /\ UNCHANGED <<kind, wasDisabled, moderator>>
  \/ /\ kind = "disabled"
     /\ value # v
     /\ ~RecastKeepsDisabled
     /\ history < MaxHist
     /\ history' = history + 1
     /\ kind' = "current"
     /\ value' = v
     /\ score' = v
     /\ last' = "recast"
     /\ UNCHANGED <<wasDisabled, moderator>>

Disable ==
  /\ kind = "current"
  /\ kind' = "disabled"
  /\ score' = IF ScoreIgnoresDisabled THEN 0 ELSE value
  /\ wasDisabled' = TRUE
  /\ moderator' = FALSE
  /\ last' = "disable"
  /\ UNCHANGED <<value, history>>

Enable ==
  /\ kind = "disabled"
  /\ kind' = "current"
  /\ score' = value
  /\ moderator' = TRUE
  /\ last' = "enable"
  /\ UNCHANGED <<value, wasDisabled, history>>

Remove ==
  /\ kind \in {"current", "disabled"}
  /\ (kind = "disabled" => ~RemoveKeepsDisabled)
  /\ history < MaxHist
  /\ kind' = "absent"
  /\ score' = 0
  /\ history' = history + 1
  /\ last' = "remove"
  /\ UNCHANGED <<value, wasDisabled, moderator>>

ScoreFollows == score = ScoreOf(kind, value)

DisabledStays == kind # "current" \/ ~wasDisabled \/ moderator

NeverCast == kind = "absent"
NeverDisabled == kind # "disabled"

Next ==
  \/ \E v \in Values: Add(v)
  \/ Disable
  \/ Enable
  \/ Remove

Spec == Init /\ [][Next]_vars
====
