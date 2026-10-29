// Waiver-aware canonical matrix row predicate (TL13-RULINGS-A-B ruling (a), OD-T1b-V).
//
// A non-pass canonical-matrix row is acceptable iff a ledger_waiver on it
// RE-MATCHES an in-tree ledger entry exactly (key, px, css/source shas).
// The predicate re-runs the TL-05 match itself (matchCanonicalContainmentWaivers
// over row-measured values); it never trusts the waiver record's own claims:
// the re-matched record must name the same entry id, carry the same
// finding_sha256, and belong to this matrix scenario. target_acceptance is
// acceptable only if every non-pass state row in its profile is acceptable
// (the runner's derived-cover rule). Checks other than target_acceptance and
// semantic probes are never waiver-eligible.
import {matchCanonicalContainmentWaivers} from './canonical-ledger-waiver.mjs';

const rowLabel=(engine,profile,id)=>`canonical execution contains a failure for ${engine}/${profile}: row ${id}`;

// Recompute what the waiver record's finding_sha256 must be from trusted
// values (row measurement + re-matched entry + context), and compare with
// the waiver's own claim. Any drift — px, viewport, entry, package,
// scenario — fails the comparison.
function waiverRecordMatches({waiver,rematch,scenarioSha256}){
  if(waiver?.scenario_sha256!==scenarioSha256)return false;
  if(rematch?.entry_id!==waiver?.entry_id)return false;
  return rematch?.finding_sha256===waiver?.finding_sha256;
}

export function validateCanonicalMatrixWaivers({packageName,matrix,themeCssSha256,themeSourceSha256,scenarioSha256,ledgerDocument}){
  const failures=[];
  const claimsByRow=new Map();
  for(const waiver of matrix?.ledger_waivers??[]){
    const key=`${waiver?.engine}/${waiver?.session_profile}/${waiver?.state}`;
    if(!claimsByRow.has(key))claimsByRow.set(key,[]);
    claimsByRow.get(key).push(waiver);
  }
  const acceptableState=(engine,profile,row)=>{
    const label=rowLabel(engine,profile,row?.id);
    const obs=row?.observation??{};
    const claims=claimsByRow.get(`${engine}/${profile}/${row?.id}`)??[];
    if(!claims.length){failures.push(`${label} fails with no ledger waiver`);return false;}
    const failure={engine,sessionProfile:profile,kind:'state',id:row?.id,viewportWidth:obs.viewport_width,
      candidateOverflowPx:obs.candidate_document_overflow_px,baselineOverflowPx:obs.baseline_document_overflow_px};
    const rematched=matchCanonicalContainmentWaivers(ledgerDocument,{packageName,themeCssSha256,themeSourceSha256,scenarioSha256,failures:[failure]});
    const verified=claims.some(claim=>rematched.some(rematch=>waiverRecordMatches({waiver:claim,rematch,scenarioSha256})));
    if(!verified){
      const claimedIds=[...new Set(claims.map(claim=>claim?.entry_id))].join(',');
      const entries=ledgerDocument?.entries??[];
      const known=claims.some(claim=>entries.some(entry=>entry?.id===claim?.entry_id));
      failures.push(known
        ?`${label} waiver [${claimedIds}] does not re-match the in-tree ledger exactly (key, px or css/source shas differ)`
        :`${label} waiver references entry [${claimedIds}] absent from the in-tree ledger`);
      return false;
    }
    return true;
  };
  for(const [engine,profiles] of Object.entries(matrix?.engines??{})){
    for(const [profile,cell] of Object.entries(profiles??{})){
      const execution=cell?.canonical_execution??{};
      for(const [id,status] of Object.entries(execution.check_evidence??{})){
        if(status==='pass')continue;
        if(id!=='target_acceptance')failures.push(`${rowLabel(engine,profile,id)} check ${id} fails (never waiver-eligible)`);
      }
      for(const row of execution.semantic_probes??[]){
        if(row?.status!=='pass')failures.push(`${rowLabel(engine,profile,row?.id)} semantic probe fails (never waiver-eligible)`);
      }
      const stateRows=(execution.interaction_states??[]).filter(row=>row?.status!=='pass');
      const statesOk=stateRows.map(row=>acceptableState(engine,profile,row));
      if(execution.check_evidence?.target_acceptance!==undefined&&execution.check_evidence?.target_acceptance!=='pass'){
        if(!stateRows.length||!statesOk.every(Boolean))failures.push(`${rowLabel(engine,profile,'target_acceptance')} target_acceptance fails with an unwaived state`);
      }
    }
  }
  return failures;
}
