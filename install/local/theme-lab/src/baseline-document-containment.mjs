import crypto from 'node:crypto';

export const BASELINE_DOCUMENT_CONTAINMENT_SCHEMA = 'theme_lab_baseline_document_containment.v1';

// Measure the same already-reached DOM/action state with only the target
// baseline layers painted. The candidate screenshot and semantic state stay
// untouched; the candidate stylesheet is restored before returning.
export async function measureBaselineDocumentContainment(page,{styleSelector,baselineCss}){
  return page.evaluate(async({styleSelector,baselineCss,schema})=>{
    const style=document.querySelector(styleSelector);
    if(!(style instanceof HTMLStyleElement))throw new Error('candidate acceptance stylesheet is absent');
    const candidateCss=style.textContent??'';
    const settle=async()=>{
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      for(const animation of document.getAnimations())if(Number.isFinite(animation.effect?.getTiming().iterations))try{animation.finish()}catch{}
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    };
    try{
      style.textContent=baselineCss;
      await settle();
      return {schema,complete:true,viewport_width:document.documentElement.clientWidth,
        document_width:document.documentElement.scrollWidth,body_width:document.body.scrollWidth};
    }finally{
      style.textContent=candidateCss;
      await settle();
    }
  },{styleSelector,baselineCss,schema:BASELINE_DOCUMENT_CONTAINMENT_SCHEMA});
}

export const BASELINE_DOCUMENT_CONTAINMENT_CONTRACT_SHA256=crypto.createHash('sha256')
  .update(measureBaselineDocumentContainment.toString()).digest('hex');
