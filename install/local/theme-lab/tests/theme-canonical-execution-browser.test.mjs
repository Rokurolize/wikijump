import test from 'node:test';
import assert from 'node:assert/strict';

import {loadChromium} from '../src/browser-lab.mjs';
import {CANONICAL_INTERACTION_STATES,CANONICAL_SEMANTIC_PROBES,runCanonicalInteractionStates,runCanonicalSemanticProbes} from '../src/theme-canonical-execution.mjs';

const html=`<!doctype html><html><body><div id="header"></div><div class="mobile-top-bar"></div><div id="side-bar"></div><div id="page-content">
<div class="tl-heading"><h1>One</h1><h2>Two</h2><strong>b</strong><em>i</em><span style="text-decoration:underline">u</span><span style="text-decoration:line-through">s</span><tt>m</tt><a href="https://example.invalid">x</a></div>
<div class="tl-links"><a href="/run-owned:theme-lab-corpus-existing">Existing internal page</a><a class="newpage" href="/run-owned:theme-lab-corpus-missing">Missing internal page</a></div>
<div class="tl-list"><ul><li>a<ul><li>b</li></ul></li><li>c</li></ul><ol><li>d</li><li>e</li></ol></div><div class="tl-quote"><blockquote>q</blockquote></div>
<div class="tl-table"><table class="wiki-content-table"><tr><th>a</th><th>b</th><th>c</th></tr><tr><td>1</td><td>2</td><td>3</td></tr><tr><td>4</td><td>5</td><td>6</td></tr></table></div><div class="tl-code"><div class="code"><pre><code>x</code></pre></div></div>
<div class="tl-collapsible"><div class="collapsible-block"><div class="collapsible-block-folded"><a class="collapsible-block-link" href="javascript:;">Open</a></div><div class="collapsible-block-unfolded" style="display:none"><div class="collapsible-block-unfolded-link"><a class="collapsible-block-link" href="javascript:;">Close</a></div></div></div></div>
<div class="tl-tabview"><div class="yui-navset"><ul class="yui-nav"><li class="selected"><a href="javascript:;">First</a></li><li><a href="javascript:;">Second</a></li></ul><div class="yui-content"><div style="display:block">one</div><div style="display:none">two</div></div></div></div>
<div class="tl-footnote"><a class="footnoteref" href="javascript:;">1</a></div><div class="footnotes-footer"><div class="footnote-footer">note</div></div>
<div class="tl-bibliography-reference"><a class="bibcite">[1]</a></div><div class="bibitems"><div class="bibitem">entry</div></div><div class="tl-math"><div class="math-equation">x</div></div><div class="tl-toc"><div id="toc"><div id="toc-list"><a>a</a><a>b</a></div></div></div>
<div class="tl-rate"><div class="page-rate-widget-box"><span class="rate-points">1</span><span class="rateup">+</span><span class="ratedown">-</span><span class="cancel">x</span></div></div><div class="tl-tag-positive">THEME_TAG_ACTIVE</div><div class="tl-tag-negative"></div></div>
<script>document.querySelectorAll('.tl-collapsible .collapsible-block-link').forEach(a=>a.addEventListener('click',()=>{const f=document.querySelector('.collapsible-block-folded'),u=document.querySelector('.collapsible-block-unfolded');const open=getComputedStyle(u).display==='none';f.style.display=open?'none':'block';u.style.display=open?'block':'none'}));const tabs=[...document.querySelectorAll('.tl-tabview .yui-nav li')],bodies=[...document.querySelectorAll('.tl-tabview .yui-content>div')];tabs.forEach((li,i)=>li.querySelector('a').addEventListener('click',()=>{tabs.forEach((x,j)=>{x.classList.toggle('selected',i===j);bodies[j].style.display=i===j?'block':'none'})}));</script></body></html>`;

test('canonical executor runs the exact seven states and seventeen probes as a closed browser set',async t=>{
  const browser=await loadChromium().launch({headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.setContent(html);
  const states=await runCanonicalInteractionStates(page,CANONICAL_INTERACTION_STATES,{baselineViewportStatus:{desktop:{baseline_document_overflow_px:0},mobile:{baseline_document_overflow_px:0}}});const probes=await runCanonicalSemanticProbes(page);
  assert.deepEqual(states.map(row=>row.id),CANONICAL_INTERACTION_STATES);assert.deepEqual(probes.map(row=>row.id),CANONICAL_SEMANTIC_PROBES);
  assert.deepEqual(states.filter(row=>row.status!=='pass'),[]);assert.deepEqual(probes.filter(row=>row.status!=='pass'),[]);
});
