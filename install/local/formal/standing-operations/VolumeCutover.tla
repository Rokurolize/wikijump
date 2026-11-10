---- MODULE VolumeCutover ----
EXTENDS Integers

CONSTANTS QuiesceGuard, DigestGuard, RecordGuard, MountGuard, LegacyGuard

Roles == {"database", "files", "cache"}
RoleOrder == <<"database", "files", "cache">>

VARIABLES quiesced, migrating, digestOk, copied, next, record,
          mounted, legacy, legacyAtCheck, cutover

vars == <<quiesced, migrating, digestOk, copied, next, record,
          mounted, legacy, legacyAtCheck, cutover>>

TypeOK ==
  /\ quiesced \in BOOLEAN
  /\ migrating \in BOOLEAN
  /\ digestOk \in [Roles -> BOOLEAN]
  /\ copied \in [Roles -> BOOLEAN]
  /\ next \in 0..3
  /\ record \in {"none", "verified", "failed"}
  /\ mounted \in {"legacy", "down", "durable"}
  /\ legacy \in BOOLEAN
  /\ legacyAtCheck \in BOOLEAN
  /\ cutover \in {"pending", "pass", "refused"}

Init ==
  /\ quiesced = FALSE
  /\ migrating = FALSE
  /\ digestOk = [r \in Roles |-> TRUE]
  /\ copied = [r \in Roles |-> FALSE]
  /\ next = 0
  /\ record = "none"
  /\ mounted = "legacy"
  /\ legacy = TRUE
  /\ legacyAtCheck = TRUE
  /\ cutover = "pending"

Stop ==
  /\ ~quiesced
  /\ quiesced' = TRUE
  /\ mounted' = "down"
  /\ UNCHANGED <<migrating, digestOk, copied, next, record, legacy, legacyAtCheck, cutover>>

StartMigrate ==
  /\ ~migrating
  /\ quiesced \/ ~QuiesceGuard
  /\ migrating' = TRUE
  /\ UNCHANGED <<quiesced, digestOk, copied, next, record, mounted, legacy, legacyAtCheck, cutover>>

Corrupt(r) ==
  /\ digestOk[r]
  /\ ~copied[r]
  /\ digestOk' = [digestOk EXCEPT ![r] = FALSE]
  /\ UNCHANGED <<quiesced, migrating, copied, next, record, mounted, legacy, legacyAtCheck, cutover>>

Copy ==
  /\ migrating
  /\ record = "none"
  /\ next < 3
  /\ LET r == RoleOrder[next + 1] IN
       IF ~digestOk[r] /\ DigestGuard THEN
         /\ record' = "failed"
         /\ next' = 3
         /\ UNCHANGED <<quiesced, migrating, digestOk, copied, mounted, legacy, legacyAtCheck, cutover>>
       ELSE
         /\ copied' = [copied EXCEPT ![r] = TRUE]
         /\ next' = next + 1
         /\ UNCHANGED <<quiesced, migrating, digestOk, record, mounted, legacy, legacyAtCheck, cutover>>

WriteRecord ==
  /\ next = 3
  /\ record = "none"
  /\ \A r \in Roles: copied[r]
  /\ record' = "verified"
  /\ UNCHANGED <<quiesced, migrating, digestOk, copied, next, mounted, legacy, legacyAtCheck, cutover>>

MountDurable ==
  /\ mounted # "durable"
  /\ mounted' = "durable"
  /\ UNCHANGED <<quiesced, migrating, digestOk, copied, next, record, legacy, legacyAtCheck, cutover>>

RemoveLegacy ==
  /\ legacy
  /\ legacy' = FALSE
  /\ UNCHANGED <<quiesced, migrating, digestOk, copied, next, record, mounted, legacyAtCheck, cutover>>

canPass ==
  /\ record = "verified" \/ ~RecordGuard
  /\ quiesced \/ ~QuiesceGuard
  /\ legacy \/ ~LegacyGuard
  /\ mounted = "durable" \/ ~MountGuard
  /\ next = 3
  /\ \A r \in Roles: copied[r] /\ (digestOk[r] \/ ~DigestGuard)

PostCutover ==
  /\ cutover = "pending"
  /\ legacyAtCheck' = legacy
  /\ IF canPass THEN cutover' = "pass" ELSE cutover' = "refused"
  /\ UNCHANGED <<quiesced, migrating, digestOk, copied, next, record, mounted, legacy>>

Next ==
  \/ Stop
  \/ StartMigrate
  \/ \E r \in Roles: Corrupt(r)
  \/ Copy
  \/ WriteRecord
  \/ MountDurable
  \/ RemoveLegacy
  \/ PostCutover

Spec == Init /\ [][Next]_vars

PassMeansVerified ==
  cutover = "pass" =>
    /\ record = "verified"
    /\ quiesced
    /\ legacyAtCheck
    /\ mounted = "durable"
    /\ \A r \in Roles: copied[r] /\ digestOk[r]

NeverPasses == cutover # "pass"
NeverFailed == record # "failed"

====
