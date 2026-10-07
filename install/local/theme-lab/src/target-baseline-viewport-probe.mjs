import {applyStylesheet,collectViewportOverflow} from './browser-lab.mjs';

// Measure one exact preview DOM twice without moving the candidate style in
// the cascade: first with the candidate layer blank, then with it restored.
// Restoration is guaranteed even when baseline measurement fails.
export async function measureTargetBaselineViewportOverflow({page,styleId,effectiveCss,viewports}){
  await applyStylesheet(page,'',styleId);
  let baseline;
  try{
    baseline=await collectViewportOverflow(page,viewports);
  }finally{
    await applyStylesheet(page,effectiveCss,styleId);
  }
  const candidate=await collectViewportOverflow(page,viewports);
  return {baseline,candidate};
}
