import { useEffect, useRef, useState } from 'react';
import { api } from './api.ts';
import { TesseractAdapter } from './ocr.ts';
import { validateBatch, type ImportGroup, type ImportItem } from './shared/intake.ts';
import type { Ride } from './shared/domain.ts';
export function ImportPanel({ onReview }: { onReview: (ride: Ride) => void }) {
 const [groups, setGroups] = useState<ImportGroup[]>([]); const [error,setError] = useState(''); const [notice,setNotice] = useState('');
 const [duplicates,setDuplicates] = useState<any[]>([]); const [busy,setBusy] = useState(false); const [job,setJob] = useState<string | null>(null);
 const [progress,setProgress] = useState({ value: 0, status: '' }); const [available,setAvailable] = useState(false);
 const controller = useRef<AbortController | null>(null); const token = useRef<string | null>(null); const jobId = useRef<string | null>(null); const mounted = useRef(true);
 async function load() { const data = await api<ImportGroup[]>('/api/import'); if (mounted.current) setGroups(data); }
 useEffect(() => { mounted.current = true; void load().catch(e=>setError(e.message)); api<{available:boolean}>('/api/ocr').then(x=>setAvailable(x.available)).catch(e=>setError(e.message)); return () => { mounted.current = false; controller.current?.abort(); if (jobId.current && token.current) void api(`/api/items/${jobId.current}/job`, 'POST', { action:'cancel', token:token.current }).catch(()=>undefined); }; }, []);
 async function intake(files: File[]) {
  setError(''); setNotice('');
  try {
   const descriptors = validateBatch(files.map(f => ({ name:f.name,size:f.size,type:f.type })));
   setBusy(true); const batch = await api<{id:string}>('/api/import/batch','POST',{files:descriptors});
   for (let slot=0; slot<files.length; slot++) {
    setNotice(`Saving original ${slot+1}/${files.length}…`);
    const response = await fetch(`/api/import/upload/${batch.id}/${slot}`, { method:'PUT', body:files[slot] }); const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (result.duplicate) setDuplicates(d=>[...d,result]);
   }
   setNotice('Originals saved. Each new image starts its own trip group; combine only images of the same ride.'); await load();
  } catch(e) { setError((e as Error).message); await load().catch(()=>undefined); } finally { setBusy(false); }
 }
 async function run(item: ImportItem) {
  if (jobId.current) return;
  const c = new AbortController(); controller.current = c; jobId.current = item.id; setJob(item.id); setError('');
  try {
   const started = await api<{token:string}>(`/api/items/${item.id}/job`,'POST',{action:'start'}); token.current = started.token;
   if (c.signal.aborted) throw new DOMException('Cancelled','AbortError');
   const response = await fetch(`/api/items/${item.id}/image`,{signal:c.signal}); if (!response.ok) throw new Error('Working image could not be loaded.');
   const result = await new TesseractAdapter().recognize(await response.blob(),c.signal,(value,status)=>{ if(mounted.current) setProgress({value,status}); });
   if (!c.signal.aborted) await api(`/api/items/${item.id}/job`,'POST',{action:'complete',token:started.token,result});
  } catch(e) {
   if (token.current) await api(`/api/items/${item.id}/job`,'POST',{action:c.signal.aborted?'cancel':'fail',token:token.current,result:(e as Error).message}).catch(()=>undefined);
   if (mounted.current && !c.signal.aborted) setError((e as Error).message);
  } finally { jobId.current = null; token.current = null; controller.current = null; if(mounted.current) {setJob(null); await load().catch(e=>setError(e.message));} }
 }
 async function runAll() {
  setBusy(true);
  try { for (const item of groups.filter(g=>!g.ride_id).flatMap(g=>g.items).filter(i=>i.status!=='complete')) { if (!mounted.current) break; await run(item); } }
  finally { if(mounted.current) setBusy(false); }
 }
 async function action(fn:()=>Promise<unknown>) { try { setError(''); await fn(); await load(); } catch(e) { setError((e as Error).message); } }
 return <section className="panel import-panel" onDragOver={e=>e.preventDefault()} onDrop={e=>{ e.preventDefault(); if(!busy) void intake(Array.from(e.dataTransfer.files)); }} onPaste={e=>{ const files = Array.from(e.clipboardData.files); if(files.length && !busy) {e.preventDefault();void intake(files);} }}>
  <div className="section-title"><h2>Import screenshots</h2><span>{available?'English OCR ready · local assets':'OCR assets unavailable — run npm run setup:ocr and rebuild'}</span></div>
  <p>Choose, drop or paste PNG, JPEG or WebP images. Up to 20 images per batch, 10,000,000 bytes each. If paste is unavailable, save the image and use the file picker.</p>
  <label className="drop-zone">Choose screenshots<input aria-label="Choose screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple disabled={busy} onChange={e=>{if(e.target.files) void intake(Array.from(e.target.files)); e.target.value='';}}/></label>
  <div className="actions"><button disabled={busy||!!job||!available} onClick={()=>void runAll()}>Recognize pending images</button>{job && <button className="secondary" onClick={()=>controller.current?.abort()}>Cancel recognition</button>}</div>
  {notice && <p role="status">{notice}</p>}{error && <p role="alert" className="error-text">{error}</p>}
  {duplicates.map((d,i)=><article className="alert" key={`${d.attachment.id}-${i}`}><strong>Exact image duplicate: {d.attachment.source_name}</strong><p>Original already retained in {d.groups.length} trip group(s). Existing records are unchanged.</p><div className="actions"><a className="button secondary" href={`/api/attachments/${d.attachment.id}/original`} target="_blank" rel="noreferrer">Compare original</a><button className="secondary" onClick={()=>void action(async()=>{await api('/api/import/groups','POST',{attachments:[d.attachment.id]});setDuplicates(x=>x.filter((_,n)=>n!==i));})}>Reuse for another group</button><button className="text-button" onClick={()=>setDuplicates(x=>x.filter((_,n)=>n!==i))}>Skip</button></div></article>)}
  {groups.map((g,index)=><article className="trip-group" key={g.id}><div className="section-title"><h3>Trip group {index+1} · {g.items.length} image(s)</h3><button disabled={!!job} onClick={()=>void action(async()=>onReview(await api<Ride>(`/api/import/groups/${g.id}/draft`,'POST',{})))}>{g.ride_id?'Open ride':'Review this trip'}</button></div>
   <div className="image-queue">{g.items.map(item=><div className="queue-card" key={item.id}><img src={`/api/attachments/${item.attachment_id}/preview`} alt={item.attachment.source_name}/><strong>{item.attachment.source_name}</strong><p>{item.status}{item.error?`: ${item.error}`:''}</p>
    {job===item.id&&<div role="status"><progress max={1} value={progress.value}/><small>{progress.status} · {Math.round(progress.value*100)}%</small></div>}
    <button className="secondary" disabled={!!job||!available} onClick={()=>void run(item)}>{item.status==='complete'?'Reprocess OCR':'Recognize / retry'}</button>
    {!g.ride_id&&<><label>Move to trip group<select aria-label={`Move ${item.attachment.source_name}`} value="" disabled={!!job} onChange={e=>void action(()=>api(`/api/items/${item.id}/move`,'POST',{group_id:e.target.value}))}><option value="">Choose group</option>{groups.filter(x=>x.id!==g.id&&!x.ride_id).map((x,n)=><option value={x.id} key={x.id}>{x.items[0]?.attachment.source_name??`Group ${n+1}`}</option>)}</select></label><button className="text-button" disabled={!!job} onClick={()=>void action(async()=>{await api('/api/import/groups','POST',{attachments:[item.attachment_id]});await api(`/api/items/${item.id}/remove`,'POST',{});})}>Separate into own trip</button><button className="text-button danger" disabled={!!job} onClick={()=>{if(confirm('Remove this image from this unsaved trip? Originals still referenced by other groups will remain.')) void action(()=>api(`/api/items/${item.id}/remove`,'POST',{}));}}>Remove attachment</button></>}
    <ImagePreparation item={item} disabled={!!job} onChange={load}/>
    {item.runs[0]&&<details><summary>Raw OCR text</summary><pre>{item.runs[0].result.text}</pre><small>Confidence is a review aid, not financial confirmation.</small></details>}
   </div>)}</div>
  </article>)}
  {!groups.length&&<div className="empty">No screenshots imported yet. Manual entry is available in Rides.</div>}
 </section>;
}
export function ImagePreparation({item,disabled,onChange}:{item:ImportItem;disabled:boolean;onChange:()=>Promise<unknown>}) {
 const [crop,setCrop] = useState('');const [error,setError] = useState('');
 async function apply(rotation: number, rectangle: any) { try { setError('');await api(`/api/items/${item.id}/transform`,'POST',{transform:{rotation,crop:rectangle}});await onChange(); }catch(e){setError((e as Error).message);} }
 return <details><summary>Rotate or crop before OCR</summary><p>Original unchanged. Rotation {item.transform.rotation}°. Crop pixels are relative to the rotated image.</p><button className="text-button" disabled={disabled} onClick={()=>void apply((item.transform.rotation+90)%360,null)}>Rotate 90°</button><label>Crop: left, top, width, height<input aria-label={`Crop ${item.attachment.source_name}`} value={crop} disabled={disabled} placeholder="0, 0, 800, 600" onChange={e=>setCrop(e.target.value)}/></label><button className="text-button" disabled={disabled} onClick={()=>{ const [left,top,width,height]=crop.split(',').map(x=>Number(x.trim()));void apply(item.transform.rotation,{left,top,width,height}); }}>Apply crop</button><button className="text-button" disabled={disabled} onClick={()=>void apply(0,null)}>Reset image</button>{error&&<p role="alert" className="error-text">{error}</p>}</details>;
}
