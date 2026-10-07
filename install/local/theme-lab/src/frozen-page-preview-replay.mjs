import fs from 'node:fs/promises';
import {sha256Hex} from './reference-cache.mjs';

export function validateFrozenPagePreview({receiptBytes,responseBytes},url){
  const receipt=JSON.parse(receiptBytes),response=JSON.parse(responseBytes);
  if(receipt.schema!=='theme_lab_native_page_preview.v1'||receipt.public_writes!==0||receipt.actor!=='anonymous'||receipt.status!==200||receipt.site!==new URL(url).hostname||receipt.url!==new URL('/ajax-module-connector.php',url).href||receipt.module!=='edit/PagePreviewModule'||receipt.request?.moduleName!==receipt.module||receipt.request.mode!=='page'||typeof receipt.request.source!=='string'||sha256Hex(receipt.request.source)!==receipt.source_sha256||sha256Hex(responseBytes)!==receipt.response_sha256||responseBytes.length!==receipt.response_bytes||response.status!=='ok'||typeof response.body!=='string'||!response.body.trim())throw new Error('preview response does not match its native read acquisition');
  return {receiptBytes,responseBytes,receipt_sha256:sha256Hex(receiptBytes),response_sha256:sha256Hex(responseBytes),body:response.body};
}

export async function loadFrozenPagePreview(binding,url){
  return validateFrozenPagePreview({receiptBytes:await fs.readFile(binding.receipt),responseBytes:await fs.readFile(binding.response)},url);
}

// Native anonymous preview HTML in an unchanged frozen SCP-JP shell. This is
// preview component geometry authority, not a saved-page observation.
export async function applyFrozenPagePreview(page,entry,{cache,replay,state}){
  const scripts=[...entry.body.matchAll(/<script\b[^>]*src="([^"]+)"/gu)].map(match=>match[1]);
  const dependencies=[];
  for(const url of scripts){
    const record=cache.manifest.urls[url];
    if(!record)throw new Error('native preview script is not retained');
    await cache.readObject(record.digest);
    dependencies.push({url,sha256:record.digest});
    await page.addScriptTag({url:replay.origin+'/o/'+record.digest});
  }
  await page.evaluate(body=>{
    const content=document.querySelector('#page-content');
    if(!content)throw new Error('native preview insertion target missing');
    content.innerHTML=body;
    // Use the same retained YUI implementation and IDs named by the response.
    for(const element of content.querySelectorAll('.yui-navset')){
      if(typeof globalThis.YAHOO?.widget?.TabView!=='function')throw new Error('native preview tab implementation missing');
      new globalThis.YAHOO.widget.TabView(element.id);
    }
  },entry.body);
  if(state==='second-tab-selected')await page.locator('.native-tabs .yui-nav li').nth(1).locator('a').click();
  return dependencies;
}
