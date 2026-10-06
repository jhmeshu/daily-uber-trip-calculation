import { useEffect,useRef,useState } from 'react';
import { api } from './api.ts';
import { TesseractAdapter } from './ocr.ts';
import type { ImportItem } from './shared/intake.ts';
export function SourceViewer({rideId,onRecognized}:{rideId:string|null;onRecognized:()=>void}) {
 const [items,setItems]=useState<ImportItem[]>([]);const [index,setIndex]=useState(0);const [zoom,setZoom]=useState(1);const [error,setError]=useState('');const [reading,setReading]=useState(false);const [progress,setProgress]=useState('');
 const controller=useRef<AbortController|null>(null);const mounted=useRef(false);const notify=useRef(onRecognized);notify.current=onRecognized;
 async function read(sources:ImportItem[]){
  if(controller.current||!sources.length)return;
  const control=new AbortController();controller.current=control;setReading(true);setError('');
  try{for(const item of sources){
   if(control.signal.aborted)break;
   let token:string|undefined;
   try{
    setProgress(`Reading ${item.attachment.source_name}…`);
    const job=await api<{token:string}>(`/api/items/${item.id}/job`,'POST',{action:'start'});token=job.token;
    if(control.signal.aborted)throw new DOMException('Recognition cancelled','AbortError');
    const response=await fetch(`/api/items/${item.id}/image`,{signal:control.signal});if(!response.ok)throw new Error('Cannot load the screenshot for recognition.');
    const result=await new TesseractAdapter().recognize(await response.blob(),control.signal,(value,status)=>{if(mounted.current)setProgress(`${item.attachment.source_name}: ${status} ${Math.round(value*100)}%`);});
    await api(`/api/items/${item.id}/job`,'POST',{action:'complete',token,result});
   }catch(e){const message=e instanceof Error?e.message:String(e);if(token)await api(`/api/items/${item.id}/job`,'POST',{action:control.signal.aborted?'cancel':'fail',token,result:message}).catch(()=>undefined);throw e;}
  }}catch(e){if(mounted.current)setError(control.signal.aborted?'Reading cancelled. Use Read screenshots / retry to try again.':`Cannot read screenshot: ${e instanceof Error?e.message:String(e)}. Retry or enter the fields manually.`);}
  finally{controller.current=null;if(mounted.current){setReading(false);setProgress('');try{setItems(await api<ImportItem[]>(`/api/rides/${rideId}/sources`));notify.current();}catch(e){setError(e instanceof Error?e.message:String(e));}}}
 }
 useEffect(()=>{mounted.current=true;let alive=true;if(rideId)api<ImportItem[]>(`/api/rides/${rideId}/sources`).then(x=>{if(alive){setItems(x);setIndex(0);const unread=x.filter(item=>['ready','interrupted'].includes(item.status));if(unread.length)void read(unread);else notify.current();}}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;mounted.current=false;controller.current?.abort();};},[rideId]);
 if(!items.length)return error?<p role="alert">{error}</p>:null;const item=items[index]!;
 return <aside className="source-viewer"><h3>Source screenshots</h3><button type="button" disabled={reading} onClick={()=>void read(items)}>Read screenshots / retry</button>{reading&&<><p role="status">{progress}</p><button type="button" onClick={()=>controller.current?.abort()}>Cancel reading</button></>}{error&&<p role="alert">{error}</p>}<label>Image<select aria-label="Source image" value={index} onChange={e=>setIndex(Number(e.target.value))}>{items.map((x,i)=><option value={i} key={x.id}>{x.attachment.source_name}</option>)}</select></label><label>Zoom<input type="range" min="0.5" max="3" step="0.1" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label><div className="image-scroll"><img src={`/api/attachments/${item.attachment_id}/original`} alt={item.attachment.source_name} style={{width:`${zoom*100}%`,maxWidth:'none'}}/></div><a href={`/api/attachments/${item.attachment_id}/original`} target="_blank" rel="noreferrer">Open original image</a><details open><summary>Raw OCR text and previous runs</summary>{item.runs.length?item.runs.map(r=><article key={r.id}><small>{r.engine} · {new Date(r.created_at).toLocaleString()} · confidence {r.result.confidence.toFixed(1)}%</small><pre>{r.result.text}</pre></article>):<p>No recognized text yet. You can fill the form manually.</p>}</details></aside>;
}
