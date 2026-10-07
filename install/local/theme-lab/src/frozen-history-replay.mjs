import fs from 'node:fs/promises';
import crypto from 'node:crypto';
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');

export function validateFrozenHistoryResponse({receiptBytes,responseBytes,requestId},url,moduleName){
  const receipt=JSON.parse(receiptBytes),response=JSON.parse(responseBytes);
  if((receipt.public_writes!==undefined&&receipt.public_writes!==0)||(receipt.actor?.mutations!==undefined&&receipt.actor.mutations!==0)||(receipt.public_writes===undefined&&receipt.actor?.mutations===undefined))throw new Error('history acquisition lacks read-only authority');
  const request=[...(receipt.requests??[]),...(receipt.sites??[]).flatMap(site=>site.acquisition_requests??[])].find(row=>row.request_id===requestId);
  const pageId=Number(request?.request?.page_id);
  if(!request||request.response_sha256!==hash(responseBytes)||request.response_bytes!==responseBytes.length||request.status!==200||request.host!==new URL(url).hostname||request.path!=='/ajax-module-connector.php'||request.request?.moduleName!==moduleName||!/^\d+$/u.test(String(request.request?.page_id))||!Number.isSafeInteger(pageId)||pageId<=0||response.status!=='ok'||typeof response.body!=='string'||!response.body.trim())throw new Error('history response does not match its native acquisition');
  return {moduleName,pageId,body:response.body,receiptBytes,responseBytes,receipt_sha256:hash(receiptBytes),response_sha256:hash(responseBytes),request_id:requestId};
}

// Replay the exact native read responses inside their own page's native shell.
// This establishes list geometry and standard radio selection only. It does
// not establish Ajax filtering, revision diff/source, or editing behavior.
export async function loadFrozenHistoryReplay({pageHistory,revisionList},url){
  const entries=[];
  for(const [binding,moduleName,target]of[[pageHistory,'history/PageHistoryModule','#action-area'],[revisionList,'history/PageRevisionListModule','#revision-list']]){
    if(!binding?.receipt||!binding.response||!binding.requestId)throw new Error('history replay requires bound response and acquisition receipt');
    const receiptBytes=await fs.readFile(binding.receipt),responseBytes=await fs.readFile(binding.response);
    entries.push({target,...validateFrozenHistoryResponse({receiptBytes,responseBytes,requestId:binding.requestId},url,moduleName)});
  }
  if(entries[0].pageId!==entries[1].pageId)throw new Error('history responses belong to different pages');
  return entries;
}

export async function applyFrozenHistoryReplay(page,entries){
  return page.evaluate(entries=>{
    const pageId=Number(globalThis.WIKIREQUEST?.info?.pageId);
    if(!Number.isSafeInteger(pageId)||entries.some(row=>row.pageId!==pageId))throw new Error('history replay root page identity differs');
    const open=globalThis.WIKIDOT?.page?.callbacks?.historyClick;
    if(typeof open!=='function')throw new Error('native history opening callback missing');
    // Use the retained site's own callback: it installs the response, opens
    // #action-area, and adds the native close control. A hidden fragment cannot
    // count as source-side geometry evidence.
    open({status:'ok',body:entries[0].body});
    for(const row of entries.slice(1)){const target=document.querySelector(row.target);if(!target)throw new Error('native history insertion target missing');target.innerHTML=row.body;}
    if(!document.querySelector('table.page-history input[name="from"]')||!document.querySelector('table.page-history input[name="to"]'))throw new Error('native history radio contract missing');
    const table=document.querySelector('table.page-history'),rect=table.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||getComputedStyle(table).visibility!=='visible')throw new Error('native history replay remains hidden');
    return {page_id:pageId,modules:entries.map(row=>row.moduleName)};
  },entries.map(({target,moduleName,pageId,body})=>({target,moduleName,pageId,body})));
}
