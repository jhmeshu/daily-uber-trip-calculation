import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { blankRide, bases, calculate, decimal, formatDuration, parseDuration, cleanLocation, cashNet, financialFields, money, parseDecimal, parseMoney, paymentMethods, reviewErrors, serviceTypes, type Ride, type RideInput, type Filters } from './shared/domain.ts';
import './style.css';
import { api } from './api.ts';
import { Dashboard } from './Dashboard.tsx';
import { Settings } from './Settings.tsx';
import { ImportPanel } from './ImportPanel.tsx';
import { EvidenceReview, candidateFormValue, type Observation } from './EvidenceReview.tsx';
import { SourceViewer } from './SourceViewer.tsx';
type Form = Record<keyof RideInput, string | boolean>;
type Session = { id: string; ride_id: string | null; base_revision: number | null; revision: number; payload: { form: Form; manual_fields?: (keyof Form)[] }; updated_at: string };
type Summary = { count: number; drafts: number; measured_count: number; missing_route: number; distance_meters: number; cash: number; credit: number; tips: number; deductions: number; including: number; excluding: number };
const labels: Record<string, string> = { cash_collected_paisa: 'Cash collected', uber_credit_paisa: 'Uber credit', tips_paisa: 'Tips included in receipts', commission_paisa: 'Uber commission', pass_charge_paisa: 'Per-ride pass charge', reported_net_paisa: 'Net earnings' };
function toForm(r: RideInput): Form {
  const f = {} as Form;
  for (const [key, value] of Object.entries(r)) {
    if (!(key in blankRide())) continue;
    f[key as keyof Form] = key.endsWith('_paisa') ? decimal(value as number | null) : key === 'distance_meters' ? decimal(value as number | null, 3) : key==='duration_seconds'?formatDuration(value as number|null): value === null ? '' : typeof value === 'number' ? String(value) : value;
  }
  return f;
}
function toInput(f: Form): RideInput {
  const r = blankRide();
  for (const key of Object.keys(r) as (keyof RideInput)[]) {
    const v = f[key];
    if (key === 'financial_confirmed') { r[key] = v === true; continue; }
    const text = String(v ?? '');
    if (key.endsWith('_paisa')) (r as any)[key] = parseMoney(text);
    else if (key === 'distance_meters') r[key] = parseDecimal(text, 3);
    else if (key === 'duration_seconds') {
      r[key] = parseDuration(text);
    } else if (['trip_date', 'pickup_time', 'pickup_location', 'drop_location'].includes(key)) (r as any)[key] = text || null;
    else (r as any)[key] = text;
  }
  if (r.pickup_time?.length === 5) r.pickup_time += ':00';
  return r;
}
const pendingKey = 'uber-tracker-pending-v1';
function readPending(): Session | null { try { const s = JSON.parse(localStorage.getItem(pendingKey) ?? 'null'); return s?.id && s?.payload?.form ? s : null; } catch { return null; } }
function App() {
  const [page,setPage]=useState<'rides'|'import'|'dashboard'|'settings'>('rides');
  const [rides, setRides] = useState<Ride[]>([]); const [summary, setSummary] = useState<Summary | null>(null);
  const [filters, setFilters] = useState<Filters>({}); const [sessions, setSessions] = useState<Session[]>([]);
  const [editor, setEditor] = useState<Session | null>(null); const [form, setForm] = useState<Form>(toForm(blankRide()));
  const [message, setMessage] = useState(''); const [error, setError] = useState(''); const [saveState, setSaveState] = useState('');
  const [busy, setBusy] = useState(false); const [includeDrafts, setIncludeDrafts] = useState(false);
  const [defaultTimezone,setDefaultTimezone]=useState<string|null>(null);
  const [history, setHistory] = useState<any[] | null>(null); const [dataPath, setDataPath] = useState('');
  const [sourceRevision,setSourceRevision]=useState(0);const touched=useRef(new Set<keyof Form>());
  const active = useRef<Session | null>(null); const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const queue = useRef<Promise<unknown>>(Promise.resolve());
  const filtersRef = useRef(filters); filtersRef.current = filters;
  const loadSequence = useRef(0);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  async function load() {
    const sequence = ++loadSequence.current; const scope = JSON.stringify(filtersRef.current);
    const requestQuery = new URLSearchParams(Object.entries(filtersRef.current).filter(([, v]) => v));
    try {
      const [data, list] = await Promise.all([api<{ rides: Ride[]; summary: Summary }>(`/api/rides?${requestQuery}`), api<Session[]>('/api/sessions')]);
      if (sequence !== loadSequence.current || scope !== JSON.stringify(filtersRef.current)) return;
      setRides(data.rides); setSummary(data.summary);
      const local = readPending(); if (local && !list.some(s => s.id === local.id)) list.unshift(local);
      setSessions(list);
    } catch (e) { if (sequence === loadSequence.current) setError((e as Error).message); }
  }
  useEffect(() => { void load(); api<{timezone:string}>('/api/settings').then(x=>setDefaultTimezone(x.timezone)).catch(e=>setError(e.message)); }, [JSON.stringify(filters),page]);
  useEffect(() => { api<{ data_directory: string;timezone:string }>('/api/health').then(x => {setDataPath(x.data_directory);setDefaultTimezone(x.timezone);}).catch(e => setError(e.message)); }, []);
  function stash(s: Session) {
    try { localStorage.setItem(pendingKey, JSON.stringify(s)); } catch { setError('Browser recovery storage is unavailable. Wait for local autosave before refreshing.'); }
  }
  function persist(snapshot: Session): Promise<unknown> {
    setSaveState('Saving unfinished edits…');
    const job = queue.current.catch(() => undefined).then(async () => {
      const latest = active.current;
      if (!latest || latest.id !== snapshot.id) return;
      const saved = await api<Session>(`/api/sessions/${snapshot.id}`, 'PUT', { payload: snapshot.payload, ride_id: latest.ride_id, base_revision: latest.base_revision, revision: latest.revision });
      if (active.current?.id === saved.id) {
        active.current = { ...active.current, revision: saved.revision };
        const local = readPending(); if (local?.id === saved.id) stash({ ...local, revision: saved.revision });
        setSaveState('Unfinished edits saved locally');
      }
    });
    queue.current = job;
    job.catch(e => { setSaveState('Autosave failed — edits retained in this browser'); setError(e.message); });
    return job;
  }
  function open(s: Session) {
    const local = readPending(); const selected = local?.id === s.id && local.updated_at > s.updated_at ? { ...local, revision: s.revision } : s;
    const duration=String(selected.payload.form.duration_seconds);
    selected.payload={...selected.payload,form:{...selected.payload.form,duration_seconds:/^\d+$/.test(duration)?formatDuration(Number(duration)):duration,pickup_location:cleanLocation(String(selected.payload.form.pickup_location)),drop_location:cleanLocation(String(selected.payload.form.drop_location))}};
    touched.current=new Set(selected.payload.manual_fields??[]);setSourceRevision(0);active.current = selected; setEditor(selected); setForm(selected.payload.form); setHistory(null); setError(''); setMessage(''); setSaveState('Unfinished session recovered'); stash(selected);
  }
  async function create() {
    setBusy(true);setError('');
    try{const settings=await api<{timezone:string}>('/api/settings');
    const now = new Date().toISOString();
    const s: Session = { id: crypto.randomUUID(), ride_id: null, base_revision: null, revision: 0, payload: { form: toForm({...blankRide(),timezone:settings.timezone}) }, updated_at: now };
    open(s); void persist(s);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  function edit(r: Ride) {
    const existing = sessions.find(s => s.ride_id === r.id);
    if (existing) { open(existing); return; }
    const s: Session = { id: crypto.randomUUID(), ride_id: r.id, base_revision: r.revision, revision: 0, payload: { form: toForm(r) }, updated_at: new Date().toISOString() };
    open(s); void persist(s);
  }
  function change(key: keyof Form, value: string | boolean, suggested=false) {
    if(!active.current)return;
    if(!suggested)touched.current.add(key);
    const next = { ...(active.current?.payload.form ?? form), [key]: value };
    if(['cash_collected_paisa','tips_paisa'].includes(key)&&!touched.current.has('reported_net_paisa')){
      try{const net=cashNet({cash_collected_paisa:parseMoney(String(next.cash_collected_paisa)),tips_paisa:parseMoney(String(next.tips_paisa))});next.reported_net_paisa=decimal(net);}catch{/* Keep the current suggestion while the amount is incomplete. */}
    }
    if (financialFields.includes(key as any) || ['financial_basis', 'reported_net_paisa', 'adjustment_reason'].includes(key)) next.financial_confirmed = false;
    setForm(next); setError('');
    const s = { ...active.current!, payload: { form: next, manual_fields:[...touched.current] }, updated_at: new Date().toISOString() };
    active.current = s; stash(s); setSaveState('Edits pending local autosave…');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; void persist(s); }, 400);
  }
  function fillSuggestions(observations:Observation[]) {
    for(const field of new Set(observations.map(o=>o.field))){
      const key=field as keyof Form;const current=active.current?.payload.form[key];
      if(key==='reported_net_paisa'&&['cash_collected_paisa','tips_paisa'].some(field=>new Set(observations.filter(o=>o.field===field).map(o=>JSON.stringify(o.value))).size>1))continue;
      if(key==='reported_net_paisa'&&touched.current.has('tips_paisa')&&active.current?.payload.form.tips_paisa==='')continue;
      if(current===undefined||touched.current.has(key)||['financial_basis','financial_confirmed','trip_id'].includes(key))continue;
      const candidates=observations.filter(o=>o.field===field);
      if(new Set(candidates.map(o=>JSON.stringify(o.value))).size===1&&(current===''||current==='Unknown'))change(key,candidateFormValue(field,candidates[0]!.value),true);
    }
  }
  async function save(status: 'draft' | 'reviewed') {
    setBusy(true); setError('');
    try {
      const input = toInput(form);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      await persist(active.current!);
      const s = active.current!;
      await api(s.ride_id ? `/api/rides/${s.ride_id}` : '/api/rides', s.ride_id ? 'PUT' : 'POST', { input, status, session_id: s.id, ...(s.ride_id ? { revision: s.base_revision } : {}) });
      localStorage.removeItem(pendingKey); active.current = null; setEditor(null); setMessage(status === 'reviewed' ? 'Reviewed ride saved.' : 'Draft saved. It is excluded from income totals.'); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function close(discard = false) {
    setBusy(true);
    try {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      await queue.current.catch(() => undefined);
      if (discard) { await api(`/api/sessions/${active.current!.id}`, 'DELETE'); localStorage.removeItem(pendingKey); }
      else await persist(active.current!);
      active.current = null; setEditor(null); setHistory(null); await load();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function lifecycle(r: Ride, action: 'trash' | 'restore' | 'purge') {
    if (!window.confirm(action === 'purge' ? 'Permanently remove this ride and its correction history? This cannot be undone.' : action === 'trash' ? 'Move this ride to trash? It will be excluded from reports and can be restored.' : 'Restore this ride? Its review eligibility will be checked.')) return;
    try { await api(`/api/rides/${r.id}/${action}`, 'POST', { revision: r.revision, confirmed: true }); setMessage(action === 'purge' ? 'Ride permanently removed.' : action === 'trash' ? 'Ride moved to trash.' : 'Ride restored.'); await load(); } catch (e) { setError((e as Error).message); }
  }
  function field(key: keyof Form, label: string, type = 'text', extra: Record<string, unknown> = {}) {
    return <label>{label}<input name={key} type={type} value={String(form[key] ?? '')} disabled={busy} onChange={e => change(key, e.target.value)} {...extra}/></label>;
  }
  let currentInput:RideInput|null=null;
  let calc: ReturnType<typeof calculate> | null = null; let review: string[] = []; let parseError = '';
  try { const input = toInput(form); currentInput=input; calc = calculate(input); review = reviewErrors(input); } catch (e) { parseError = (e as Error).message; }
  const filter = (key: keyof Filters, value: string) => setFilters(f => ({ ...f, [key]: value }));
  return <div className="shell">
    <header><div><span className="eyebrow">LOCAL • BDT • ASIA/DHAKA</span><h1>Uber Ride Tracker</h1><p>Keep each ride accounted for.</p></div><button onClick={create} disabled={busy||!!editor||!defaultTimezone}>+ Add ride</button></header>
    <nav aria-label="Main navigation"><button className={page==='dashboard'?'':'secondary'} disabled={!!editor} onClick={()=>setPage('dashboard')}>Dashboard</button><button className={page==='rides'?'':'secondary'} disabled={!!editor} onClick={()=>setPage('rides')}>Rides</button><button className={page==='import'?'':'secondary'} disabled={!!editor} onClick={()=>setPage('import')}>Import</button><button className={page==='settings'?'':'secondary'} disabled={!!editor} onClick={()=>setPage('settings')}>Settings & backup</button></nav>
    {error && <div className="alert error" role="alert">{error}</div>}{message && <div className="alert" role="status">{message}</div>}
    {editor ? <section className="panel editor"><div className="section-title"><h2>{editor.ride_id ? 'Edit ride' : 'New ride'}</h2><span role="status">{saveState}</span></div>
      <p className="muted">Unfinished edits are saved separately. Use Save reviewed to update income totals.</p>
      <div className="review-layout"><SourceViewer key={editor.id} rideId={editor.ride_id} onRecognized={()=>setSourceRevision(x=>x+1)}/><form onSubmit={e => { e.preventDefault(); void save('reviewed'); }}>
        <EvidenceReview refreshKey={sourceRevision} onSuggestions={fillSuggestions} onApplying={setBusy} id={editor.ride_id} input={currentInput} pick={change} onAttached={r=>{localStorage.removeItem(pendingKey);active.current=null;setEditor(null);void load();setTimeout(()=>edit(r),0);}}/>
        <fieldset disabled={busy}><legend>Trip details</legend><div className="form-grid">
          {field('trip_date', 'Trip date', 'date')}{field('pickup_time', 'Pickup time', 'time', { step: 1 })}
          {field('pickup_location', 'Pickup location')}{field('drop_location', 'Drop location')}
          {field('distance_meters', 'Distance (km)', 'text', { inputMode: 'decimal' })}{field('duration_seconds', 'Duration (hh:mm:ss)', 'text', { placeholder:'00:53:34' })}
          <label>Payment method<select value={String(form.payment_method)} onChange={e => change('payment_method', e.target.value)}>{paymentMethods.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Service type<select value={String(form.service_type)} onChange={e => change('service_type', e.target.value)}>{serviceTypes.map(x => <option key={x}>{x}</option>)}</select></label>
          {field('timezone', 'Trip timezone')}
        </div></fieldset>
        <fieldset disabled={busy}><legend>Financial review · BDT</legend><p>Leave unknown amounts blank. Enter 0 only when known. Receipts must include tips and be before the listed deductions.</p>
          <label>Financial basis<select value={String(form.financial_basis)} onChange={e => change('financial_basis', e.target.value)}>{bases.map((x, i) => <option value={x} key={x}>{['Worksheet: cash + credit before deductions', 'Already-net earnings (draft only)', 'Unresolved (draft only)'][i]}</option>)}</select></label>
          <div className="form-grid amounts">{financialFields.map(k => <React.Fragment key={k}>{field(k, labels[k]!, 'text', { inputMode: 'decimal' })}</React.Fragment>)}{field('reported_net_paisa', labels.reported_net_paisa!, 'text', { inputMode: 'decimal' })}</div>
          <p className="muted">Only explicitly evidenced per-ride pass charges belong here. Keep monthly subscriptions outside the ride ledger.</p>
          {field('adjustment_reason', 'Explanation for an intentional negative or unusual adjustment')}
          <div className="calculation"><div>Net earnings (cash − tips)<strong>{money(currentInput?cashNet(currentInput):null)}</strong></div><div>Income excluding tips<strong>{money(calc?.excluding ?? null)}</strong></div><div>Income including tips<strong>{money(calc?.including ?? null)}</strong></div></div>
          {parseError && <p className="error-text">{parseError}</p>}{calc?.warnings.map(w => <p key={w} className="error-text">{w}</p>)}
          <label className="check"><input type="checkbox" checked={form.financial_confirmed === true} onChange={e => change('financial_confirmed', e.target.checked)}/>I reviewed all five financial amounts and confirm that cash + credit include tips and precede these per-ride deductions.</label>
        </fieldset>
        <label>Comments<textarea value={String(form.comments)} disabled={busy} onChange={e => change('comments', e.target.value)}/></label>
        {review.length > 0 && <div className="review-notes"><strong>Before review</strong><ul>{review.map(x => <li key={x}>{x}</li>)}</ul></div>}
        <div className="actions"><button type="submit" disabled={busy || !!parseError || review.length > 0}>Save reviewed</button><button type="button" className="secondary" disabled={busy} onClick={() => void save('draft')}>Save draft</button><button type="button" className="secondary" disabled={busy} onClick={() => void close()}>Keep unfinished & close</button><button type="button" className="text-button" disabled={busy} onClick={() => { if (window.confirm('Discard these unfinished edits? The saved ride will remain unchanged.')) void close(true); }}>Discard edits</button></div>
      </form></div>
      {editor.ride_id && <><button className="text-button" onClick={() => api<any[]>(`/api/rides/${editor.ride_id}/history`).then(setHistory).catch(e => setError(e.message))}>View correction history</button>{history && <div className="history">{history.map(h => <article key={h.id}><strong>{h.action} · {new Date(h.created_at).toLocaleString()}</strong><ul>{Object.keys(h.after_data ?? {}).filter(k => !['revision', 'updated_at', 'reviewed_at'].includes(k) && JSON.stringify(h.before_data?.[k]) !== JSON.stringify(h.after_data?.[k])).map(k => <li key={k}>{labels[k] ?? k.replaceAll('_', ' ')}: {k.endsWith('_paisa') ? money(h.before_data?.[k] ?? null) : String(h.before_data?.[k] ?? '—')} → {k.endsWith('_paisa') ? money(h.after_data?.[k] ?? null) : String(h.after_data?.[k] ?? '—')}</li>)}</ul></article>)}</div>}</>}
    </section> : page==='dashboard' ? <Dashboard open={r=>{setPage('rides');edit(r);}}/> : page==='settings' ? <Settings/> : page==='import' ? <ImportPanel onReview={r=>{setPage('rides');edit(r);}}/> : <>
      {sessions.length > 0 && <section className="panel recover"><h2>Unfinished edits</h2><p>Resume a session to recover edits before saving a draft or reviewed ride.</p>{sessions.map(s => <button className="secondary" key={s.id} onClick={() => open(s)}>{s.ride_id ? 'Resume ride edit' : 'Resume new ride'} · {new Date(s.updated_at).toLocaleString()}</button>)}</section>}
      <section className="panel"><div className="section-title"><h2>Ride ledger</h2><span>{rides.length} records</span></div>
        <div className="filters"><label>Month<input type="month" value={filters.month ?? ''} onChange={e => filter('month', e.target.value)}/></label><label>From<input type="date" value={filters.from ?? ''} onChange={e => filter('from', e.target.value)}/></label><label>To<input type="date" value={filters.to ?? ''} onChange={e => filter('to', e.target.value)}/></label>
          <label>Payment<select value={filters.payment ?? ''} onChange={e => filter('payment', e.target.value)}><option value="">All payments</option>{paymentMethods.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Service<select value={filters.service ?? ''} onChange={e => filter('service', e.target.value)}><option value="">All services</option>{serviceTypes.map(x => <option key={x}>{x}</option>)}</select></label>
          <label>Status<select aria-label="Status" value={filters.status ?? ''} onChange={e => filter('status', e.target.value)}><option value="">Drafts & reviewed</option><option value="reviewed">Reviewed</option><option value="draft">Drafts</option><option value="deleted">Trash</option></select></label>
          <label className="search">Search locations or comments<input type="search" value={filters.search ?? ''} onChange={e => filter('search', e.target.value)}/></label><button className="text-button" onClick={() => setFilters({})}>Clear filters</button>
        </div>
        {summary && <><div className="stats"><div><span>Income excluding tips</span><strong>{money(summary.excluding)}</strong></div><div><span>Income including tips</span><strong>{money(summary.including)}</strong></div><div><span>Reviewed rides</span><strong>{summary.count}</strong></div><div><span>Measured distance</span><strong>{decimal(summary.distance_meters, 3)} km</strong><small>{summary.measured_count}/{summary.count} rides measured</small></div></div><p className="muted">Reviewed records in this selection only. {summary.drafts} drafts excluded. {summary.missing_route} reviewed rides lack route information. Income does not subtract fuel, repairs or salary.</p></>}
        <div className="table-wrap"><table><thead><tr>{['#', 'Date / time', 'Route', 'Distance', 'Duration', 'Payment / service', 'Cash', 'Credit', 'Commission', 'Pass', 'Tips', 'Net earnings', 'Income excl. tips', 'Income incl. tips', 'Status', 'Comments', 'Actions'].map(x => <th key={x}>{x}</th>)}</tr></thead><tbody>{rides.map((r, i) => { const c = calculate(r); return <tr key={r.id}><td>{i + 1}</td><td>{r.trip_date ?? 'Unknown'}<small>{r.pickup_time ?? 'Unknown time'}</small></td><td>{r.pickup_location===null?'Unknown pickup':cleanLocation(r.pickup_location)}<small>→ {r.drop_location===null?'Unknown drop':cleanLocation(r.drop_location)}</small></td><td>{r.distance_meters === null ? 'Unknown' : `${decimal(r.distance_meters, 3)} km`}</td><td>{r.duration_seconds === null ? 'Unknown' : formatDuration(r.duration_seconds)}</td><td>{r.payment_method}<small>{r.service_type}</small></td>{[r.cash_collected_paisa, r.uber_credit_paisa, r.commission_paisa, r.pass_charge_paisa, r.tips_paisa, cashNet(r), c.excluding, c.including].map((v, j) => <td key={j} className="number">{v === null ? 'Unknown' : decimal(v)}</td>)}<td><span className={`badge ${r.status}`}>{r.status}</span><small>{c.status}</small></td><td>{r.comments || '—'}</td><td><div className="row-actions">{r.status === 'deleted' ? <><button className="text-button" onClick={() => void lifecycle(r, 'restore')}>Restore</button><button className="text-button danger" onClick={() => void lifecycle(r, 'purge')}>Remove forever</button></> : <><button className="text-button" onClick={() => edit(r)}>Edit</button><button className="text-button danger" onClick={() => void lifecycle(r, 'trash')}>Trash</button></>}</div></td></tr>; })}</tbody></table>{rides.length === 0 && <div className="empty"><h3>No rides in this selection</h3><p>Add a ride or change your filters.</p></div>}</div>
      </section>
      <section className="panel export"><h2>Export CSV</h2><p>CSV contains ledger values. It does not contain screenshots, history or a complete database backup.</p><label className="check"><input type="checkbox" checked={includeDrafts} onChange={e => setIncludeDrafts(e.target.checked)}/>Include drafts explicitly (excluded from totals)</label><div className="actions"><a className="button" href={`/api/export?${query}&include_drafts=${includeDrafts}&scope=filtered`}>Export current selection</a><a className="button secondary" href={`/api/export?scope=all&include_drafts=${includeDrafts}`}>Export all reviewed{includeDrafts ? ' + drafts' : ''}</a></div></section>
    </>}
    <footer>Local Uber Ride Tracker · Experimental field parsing; confirm every financial interpretation.<details><summary>Data location & accounting</summary><p>{dataPath}</p><p>Income excluding tips = cash + credit − commission − per-ride pass − tips. Trip dates determine monthly selection; no prior-month balance is carried forward.</p></details></footer>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
