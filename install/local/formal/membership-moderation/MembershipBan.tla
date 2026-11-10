---- MODULE MembershipBan ----
EXTENDS Integers, FiniteSets

CONSTANTS BanBlocksCreate, BanClearsMember, BanClearsRoles, CleanupCurrentOnly,
          GrantBlockedByBan, InviteOnce, ReviewOnce

VARIABLES member, cause, application, invite, inviteReused, reviewReused, grants,
          row, seen, phase, wrongGone

vars == <<member, cause, application, invite, inviteReused, reviewReused, grants,
          row, seen, phase, wrongGone>>

Rows == {"a", "b"}
Roles == {1, 2}
Causes == {"none", "self", "password", "review", "invite"}
Apps == {"none", "pending", "accepted"}
Invites == {"none", "open", "used"}
RowState == {"empty", "active", "expired", "over-active", "over-expired", "gone"}

CurrentIds == {id \in Rows: row[id] \in {"active", "expired"}}
ActiveBan == \E id \in Rows: row[id] = "active"

TypeOK ==
  /\ member \in BOOLEAN
  /\ cause \in Causes
  /\ application \in Apps
  /\ invite \in Invites
  /\ inviteReused \in BOOLEAN
  /\ reviewReused \in BOOLEAN
  /\ grants \subseteq Roles
  /\ row \in [Rows -> RowState]
  /\ Cardinality(CurrentIds) <= 1
  /\ seen \in {"none"} \union Rows
  /\ phase \in {"idle", "listed"}
  /\ wrongGone \in BOOLEAN

Init ==
  /\ member = FALSE
  /\ cause = "none"
  /\ application = "none"
  /\ invite = "none"
  /\ inviteReused = FALSE
  /\ reviewReused = FALSE
  /\ grants = {}
  /\ row = [id \in Rows |-> "empty"]
  /\ seen = "none"
  /\ phase = "idle"
  /\ wrongGone = FALSE

Accept(kind) ==
  /\ ~member
  /\ BanBlocksCreate => ~ActiveBan
  /\ \/ /\ kind = "self"
        /\ application = "none"
        /\ cause' = "self"
        /\ application' = application
        /\ invite' = invite
        /\ inviteReused' = inviteReused
        /\ reviewReused' = reviewReused
     \/ /\ kind = "password"
        /\ cause' = "password"
        /\ application' = "none"
        /\ invite' = invite
        /\ inviteReused' = inviteReused
        /\ reviewReused' = reviewReused
     \/ /\ kind = "review"
        /\ ~reviewReused
        /\ \/ application = "pending"
           \/ /\ ~ReviewOnce
              /\ application = "accepted"
        /\ cause' = "review"
        /\ application' = "accepted"
        /\ invite' = invite
        /\ inviteReused' = inviteReused
        /\ reviewReused' = (application # "pending")
     \/ /\ kind = "invite"
        /\ ~inviteReused
        /\ \/ invite = "open"
           \/ /\ ~InviteOnce
              /\ invite = "used"
        /\ cause' = "invite"
        /\ application' = application
        /\ invite' = "used"
        /\ inviteReused' = (invite = "used")
        /\ reviewReused' = reviewReused
  /\ member' = TRUE
  /\ UNCHANGED <<grants, row, seen, phase, wrongGone>>

Apply ==
  /\ ~member
  /\ application = "none"
  /\ application' = "pending"
  /\ UNCHANGED <<member, cause, invite, inviteReused, reviewReused, grants, row, seen, phase, wrongGone>>

IssueInvite ==
  /\ invite = "none"
  /\ invite' = "open"
  /\ UNCHANGED <<member, cause, application, inviteReused, reviewReused, grants, row, seen, phase, wrongGone>>

RemoveMember ==
  /\ member
  /\ member' = FALSE
  /\ cause' = "none"
  /\ UNCHANGED <<application, invite, inviteReused, reviewReused, grants, row, seen, phase, wrongGone>>

Grant(role) ==
  /\ role \in Roles
  /\ role \notin grants
  /\ GrantBlockedByBan => ~ActiveBan
  /\ grants' = grants \union {role}
  /\ UNCHANGED <<member, cause, application, invite, inviteReused, reviewReused, row, seen, phase, wrongGone>>

Place(id, kind) ==
  /\ id \in Rows
  /\ row[id] = "empty"
  /\ kind \in {"active", "expired"}
  /\ row' = [r \in Rows |->
       IF r = id THEN kind
       ELSE IF row[r] = "active" THEN "over-active"
       ELSE IF row[r] = "expired" THEN "over-expired"
       ELSE row[r]]
  /\ IF kind = "active"
     THEN /\ member' = IF BanClearsMember THEN FALSE ELSE member
          /\ cause' = IF BanClearsMember /\ member THEN "none" ELSE cause
          /\ grants' = IF BanClearsRoles THEN {} ELSE grants
     ELSE UNCHANGED <<member, cause, grants>>
  /\ UNCHANGED <<application, invite, inviteReused, reviewReused, seen, phase, wrongGone>>

Unban ==
  /\ Cardinality(CurrentIds) = 1
  /\ LET id == CHOOSE x \in CurrentIds: TRUE IN
       row' = [row EXCEPT ![id] = "gone"]
  /\ UNCHANGED <<member, cause, application, invite, inviteReused, reviewReused, grants, seen, phase, wrongGone>>

Observe(id) ==
  /\ phase = "idle"
  /\ id \in Rows
  /\ row[id] \in {"expired", "over-expired"}
  /\ seen' = id
  /\ phase' = "listed"
  /\ UNCHANGED <<member, cause, application, invite, inviteReused, reviewReused, grants, row, wrongGone>>

Lift ==
  /\ phase = "listed"
  /\ seen \in Rows
  /\ row[seen] \in {"expired", "over-expired"}
  /\ IF CleanupCurrentOnly
     THEN /\ IF row[seen] = "expired"
             THEN row' = [row EXCEPT ![seen] = "gone"]
             ELSE UNCHANGED row
          /\ UNCHANGED wrongGone
     ELSE /\ IF Cardinality(CurrentIds) = 1
             THEN LET id == CHOOSE x \in CurrentIds: TRUE IN
                    /\ row' = [row EXCEPT ![id] = "gone"]
                    /\ wrongGone' = (wrongGone \/ (id # seen))
             ELSE UNCHANGED <<row, wrongGone>>
  /\ phase' = "idle"
  /\ UNCHANGED <<member, cause, application, invite, inviteReused, reviewReused, grants, seen>>

AcceptA == \E kind \in {"self", "password", "review", "invite"}: Accept(kind)
GrantA == \E role \in Roles: Grant(role)
PlaceA == \E id \in Rows, kind \in {"active", "expired"}: Place(id, kind)
ObserveA == \E id \in Rows: Observe(id)
Step ==
  \/ AcceptA
  \/ Apply
  \/ IssueInvite
  \/ RemoveMember
  \/ GrantA
  \/ PlaceA
  \/ Unban
  \/ ObserveA
  \/ Lift
Done == ~(ENABLED Step) /\ UNCHANGED vars
Next == Step \/ Done
Spec == Init /\ [][Next]_vars

ActiveBanClearsMember == ActiveBan => ~member
ActiveBanClearsGrants == ActiveBan => grants = {}
MemberOnlyByAccept == member => cause \in {"self", "password", "review", "invite"}
CleanupOnlyObserved == ~wrongGone
InviteAtMostOnce == ~inviteReused
ReviewAtMostOnce == ~reviewReused

NeverJoined == ~member
NeverBanned == \A id \in Rows: row[id] = "empty"
RemoveRevokesGrants == member \/ grants = {}
ReplacementRemoved ==
  \/ phase = "listed"
  \/ seen \notin Rows
  \/ Cardinality(CurrentIds) = 0
  \/ \A id \in CurrentIds: id = seen

====
