// Browser-only geometry: transparent padding is not text ink. Generated content
// is projected into an equivalent temporary inline box, then fully restored.
export async function measureVisibleTextBounds(page,selectors){
 return page.evaluate(selectors=>{
  const result={};let serial=0;
  for(const selector of selectors){
   const boxes=[];
   for(const element of document.querySelectorAll(selector)){
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);
    for(let node=walker.nextNode();node;node=walker.nextNode()){
     const style=getComputedStyle(node.parentElement);
     if(!node.textContent.trim()||parseFloat(style.fontSize)===0||style.display==='none'||style.visibility==='hidden')continue;
     const range=document.createRange();range.selectNodeContents(node);
     boxes.push(...[...range.getClientRects()].map(rect=>rect.toJSON()));
    }
    for(const owner of [element,...element.querySelectorAll('*')])for(const pseudo of ['::before','::after']){
     const style=getComputedStyle(owner,pseudo);let content;
     try{content=JSON.parse(style.content)}catch{continue}
     if(!content||style.display==='none'||style.visibility==='hidden'||parseFloat(style.fontSize)===0)continue;
     const projection=document.createElement('span');projection.textContent=content;
     for(const property of style)projection.style.setProperty(property,style.getPropertyValue(property),'important');
     const attribute=owner.getAttribute('data-theme-lab-ink');const key=String(serial++);
     const hide=document.createElement('style');hide.textContent=`[data-theme-lab-ink="${key}"]${pseudo}{content:none!important}`;
     try{
      owner.setAttribute('data-theme-lab-ink',key);document.head.append(hide);
      if(pseudo==='::before')owner.prepend(projection);else owner.append(projection);
      boxes.push(projection.getBoundingClientRect().toJSON());
     }finally{
      projection.remove();hide.remove();if(attribute===null)owner.removeAttribute('data-theme-lab-ink');else owner.setAttribute('data-theme-lab-ink',attribute);
     }
    }
   }
   result[selector]=boxes;
  }
  return result;
 },selectors);
}
