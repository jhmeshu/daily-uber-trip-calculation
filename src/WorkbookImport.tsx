import { useEffect,useRef,useState } from 'react';
import { api } from './api.ts';
import { money,type RideInput } from './shared/domain.ts';
import { mappedFields } from './shared/workbook.ts';
type Disposition='imported'|'skipped'|'needs_field';
type PreviewRow={sheetRow:number;layout:string;disposition:Disposition;missingFields:string[];mapped:RideInput;cells:unknown[];warning:boolean};
type PreviewTab={sheet:string;layout:string;ledger:boolean;headerRow:number;rows:PreviewRow[];appTotalPaisa:number|null;statedPaisa:number|null;verdict:string;reason:string;excludedAbsent:number;comparable:boolean};
type Defect={sheet:string;cell:string;range:string|null;kind:string;detail:string};
type Preview={token:string;sha256:string;bytes:number;tabs:PreviewTab[];defects:Defect[];duplicate:{importedAt:string;rowCount:number}|null};
type ReportTab={sheet:string;appTotalPaisa:number|null;statedPaisa:number|null;differencePaisa:number|null;verdict:string;reason:string;excludedAbsent:number};
type VarianceRecord={sheet_name:string;location:string;metric:string;workbook_reported:string|null;workbook_formula:string|null;app_value_paisa:number|null;difference_paisa:number|null;verdict:string;note:string};
type Report={source:{id:string;filename:string;sha256:string;bytes:number;importedAt:string;note:string};tabs:ReportTab[];variance:VarianceRecord[]};
const layoutLabels:Record<string,string>={A:'Layout A',B:'Layout B',C:'Layout C',unrecognised:'Not a ride ledger'};
// Plain-language defect labels so the classification is readable without colour or a legend (A45).
const defectLabels:Record<string,string>={'row-mismatch':'Formula points at the wrong row','cross-tab-carry-forward':'Formula carries a value from another tab','embedded-numeric-literal':'Formula contains a typed number','typed-literal-where-sibling-has-formula':'A typed value where a sibling tab carries a formula'};
const verdictLabels:Record<string,string>={match:'Amounts match',variance:'Amounts differ',not_comparable:'Not comparable',defect:'Formula defect'};
const fieldLabel=(field:string)=>field.replaceAll('_',' ');
const mappedList=(row:PreviewRow)=>mappedFields.filter(field=>{const value=row.mapped[field];return value!==null&&value!==undefined&&value!=='';});
export function WorkbookImport(){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 const [preview,setPreview]=useState<Preview|null>(null);const [committed,setCommitted]=useState<{sourceId:string;imported:number}|null>(null);
 const [report,setReport]=useState<Report|null>(null);const [reason,setReason]=useState('');
 const mounted=useRef(true);const reportSequence=useRef(0);
 async function loadReport(){const sequence=++reportSequence.current;try{const data=await api<Report>('/api/import/workbook/report');if(mounted.current&&sequence===reportSequence.current)setReport(data);}catch{/* No workbook import exists yet, so there is nothing to list. */}}
 useEffect(()=>{mounted.current=true;void loadReport();return()=>{mounted.current=false;};},[]);
 async function upload(file:File){
  setError('');setNotice('');setCommitted(null);setPreview(null);setBusy(true);
  try{const response=await fetch('/api/import/workbook/preview',{method:'POST',body:file});const result=await response.json();if(!response.ok)throw new Error(result.error);if(!mounted.current)return;setPreview(result as Preview);setNotice('Preview ready. Nothing has been written yet.');}
  catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}
 }
 async function commit(){
  if(!preview)return;setError('');
  const count=preview.tabs.filter(tab=>tab.ledger).reduce((sum,tab)=>sum+tab.rows.length,0);
  if(!window.confirm(`Import ${count} workbook rides as drafts? They are excluded from income until you review and confirm each one.`))return;
  setBusy(true);
  try{const result=await api<{sourceId:string;imported:number}>('/api/import/workbook/commit','POST',{token:preview.token,confirmed:true,reason});if(!mounted.current)return;setCommitted(result);setPreview(null);setNotice(`Imported ${result.imported} draft rides.`);await loadReport();}
  catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setBusy(false);}
 }
 return <section className="panel workbook-import">
  <div className="section-title"><h2>Import historical workbook</h2><span>Preview only · nothing is saved until you confirm</span></div>
  <p>Choose the monthly Uber calculation workbook (.xlsx). The server reads each tab in memory, detects its layout, and lists what it would import. Rows with absent amounts stay unknown and are never read as zero; the server recomputes every total and the local preview is not trusted.</p>
  <label className="drop-zone">Choose historical workbook<input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="Choose historical workbook" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file);e.target.value='';}}/></label>
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error-text">{error}</p>}
  {preview&&<>
   <div className="table-wrap"><table aria-label="Workbook import preview"><thead><tr>{['Tab','Row','Detected layout','Mapped fields','Missing fields','Disposition'].map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>
    {preview.tabs.filter(tab=>tab.ledger).flatMap(tab=>tab.rows.map(row=><tr key={`${tab.sheet}-${row.sheetRow}`}><td>{tab.sheet}</td><td>{row.sheetRow}</td><td>{layoutLabels[tab.layout]??tab.layout}</td><td>{mappedList(row).map(fieldLabel).join(', ')||'None'}</td><td>{row.missingFields.length?<span className="missing-fields">Missing: {row.missingFields.map(fieldLabel).join(', ')}</span>:'None'}</td><td><span className={`badge ${row.disposition==='imported'?'match':row.disposition==='needs_field'?'variance':'not_comparable'}`}>{row.disposition==='needs_field'?'needs field':row.disposition}</span>{row.warning&&<small>Matches an existing reviewed ride on date, time, distance and cash.</small>}</td></tr>))}
   </tbody></table></div>
   <div className="review-notes"><h3>Per-tab variance</h3>
    {preview.tabs.map(tab=>{const defects=preview.defects.filter(defect=>defect.sheet===tab.sheet);const verdict=tab.ledger?tab.verdict:'not_comparable';const difference=tab.appTotalPaisa===null||tab.statedPaisa===null?null:tab.appTotalPaisa-tab.statedPaisa;return <article key={tab.sheet}>
     <p><strong>{tab.sheet} · {layoutLabels[tab.layout]??tab.layout}</strong> <span className={`badge ${verdict}`}>{verdict}</span></p>
     {tab.ledger?<p>{verdictLabels[tab.verdict]??'Unknown verdict'}. App total {money(tab.appTotalPaisa)} · workbook stated {money(tab.statedPaisa)} · difference {money(difference)} · {tab.rows.length} row(s), {tab.excludedAbsent} absent amount(s) excluded. {tab.reason}</p>:<p>Not a ride ledger. No rows are read from this tab.</p>}
     {defects.map(defect=><p key={`${defect.sheet}-${defect.cell}-${defect.kind}`}><span className="badge defect">defect</span> {defectLabels[defect.kind]??defect.kind}: {defect.cell}{defect.range?` (${defect.range})`:''} — {defect.detail}</p>)}
    </article>;})}
   </div>
   <div className="review-notes"><h3>Commit import</h3>
    <p>This writes every ledger row as a draft. The workbook net stays evidence only; review each ride before it counts toward income.</p>
    {preview.duplicate&&<p role="alert" className="error-text">This workbook was imported on {new Date(preview.duplicate.importedAt).toLocaleString()} with {preview.duplicate.rowCount} rows. Importing it again requires a reason.</p>}
    <label>Reason for re-importing a previously imported workbook<input value={reason} disabled={busy} onChange={e=>setReason(e.target.value)} placeholder="Why is this workbook imported again?"/></label>
    <div className="actions"><button disabled={busy} onClick={()=>void commit()}>Import workbook as drafts</button></div>
   </div>
  </>}
  {committed&&<p role="status">Committed {committed.imported} draft rides from the workbook.</p>}
  {report&&<div className="review-notes"><h3>Past imports</h3>
   <article><strong>{report.source.filename}</strong><p>Imported {new Date(report.source.importedAt).toLocaleString()} · {report.source.sha256.slice(0,12)}… · {report.variance.length} variance record(s){report.source.note?` · ${report.source.note}`:''}</p>
    <a className="button secondary" href={`/api/import/workbook/variance.csv?source_id=${encodeURIComponent(report.source.id)}`}>Download variance CSV</a>
   </article>
  </div>}
  {!preview&&!committed&&!report&&<div className="empty">No workbook imported yet. Choose an .xlsx file to preview its tabs.</div>}
 </section>;
}
