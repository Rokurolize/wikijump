// Shared pointer parking. Any harness screenshot must leave the pointer outside
// hover/focus-sensitive chrome (for example the top-left hamburger, whose hover opens
// the Basalt side drawer). This is the same safe-area search capture-interactive used
// after each action; it now also runs before full-check visual screenshots.
export async function movePointerToSafeArea(page){
 const point=await page.evaluate(()=>{
  const candidates=[
   [innerWidth-3,innerHeight-3],
   [innerWidth-3,innerHeight*.75],
   [innerWidth-3,innerHeight*.25],
   [innerWidth-3,3],
   [innerWidth*.75,innerHeight-3],
   [innerWidth*.9,innerHeight*.5],
  ];
  const interactive='#side-bar,#top-bar,.mobile-top-bar,#header,#footer a,a,button,input,select,textarea,[role="button"]';
  for(const [x,y] of candidates){
   const px=Math.max(1,Math.min(innerWidth-2,x)),py=Math.max(1,Math.min(innerHeight-2,y));
   const hit=document.elementFromPoint(px,py);
   if(!hit||hit===document.body||hit===document.documentElement||!hit.closest(interactive))return{x:px,y:py};
  }
  return{x:Math.max(1,innerWidth-2),y:Math.max(1,innerHeight-2)};
 });
 await page.mouse.move(point.x,point.y);
}
