export interface ShareActivity { t:number; kind:'view'|'play'|'download'|'zip'; visitor:string; client:string; name?:string }
export interface TrackedShare {
  views:number; downloads:number; lastAccess?:number; activity?:ShareActivity[]; visitors?:string[];
}
// Counts describe observed requests / started downloads, never completed transfers.
// A visitor is an opaque, salted fingerprint, not an identified person.
export function trackShare(s:TrackedShare, event:ShareActivity):boolean {
  const history=s.activity ||= [];
  const duplicate=history.some(e=>e.visitor===event.visitor && e.kind===event.kind && e.name===event.name && event.t-e.t < (event.kind==='view'?300_000:30_000));
  if(duplicate)return false;
  if(event.kind==='view')s.views++;
  if(event.kind==='download'||event.kind==='zip')s.downloads++;
  s.lastAccess=event.t;
  const visitors=s.visitors ||= [];
  if(!visitors.includes(event.visitor)&&visitors.length<2000)visitors.push(event.visitor);
  history.push(event);
  if(history.length>100)history.splice(0,history.length-100);
  return true;
}
