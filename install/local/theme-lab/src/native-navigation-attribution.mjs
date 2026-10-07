// Geometry of the same native parent action with and without the candidate.
// Existing target overflow is preserved as an observation, not a port defect.
export function nativeNavigationDoesNotWorsen(candidate,baseline,tolerance=1){
 if(candidate.interaction_error||baseline?.interaction_error||candidate.width!==baseline?.width||candidate.state!==baseline.state||candidate.index!==baseline.index)return false;
 const current=candidate.measurement,before=baseline.measurement;
 if(!Number.isFinite(current?.document_width)||!Number.isFinite(before?.document_width)||current.document_width>before.document_width+tolerance)return false;
 if(candidate.bounds?.length!==baseline.bounds?.length||!candidate.bounds?.length||current.rows?.length!==before.rows?.length)return false;
 return candidate.bounds.every((bound,index)=>{
  const original=baseline.bounds[index],row=current.rows[index],old=before.rows[index];
  return row?.selector===old?.selector&&row?.text===old?.text&&
   ['off_left_px','off_right_px'].every(edge=>Number.isFinite(bound[edge])&&Number.isFinite(original[edge])&&bound[edge]<=original[edge]+tolerance);
 });
}
