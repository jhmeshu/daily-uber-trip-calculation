import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { parseFilters, summarize, validateInput, ValidationError } from '../src/shared/domain.ts';
import { exportCsv } from '../src/shared/csv.ts';
import { Backups } from './backup.ts';
import { ocrDiagnostics, binary } from './intake-routes.ts';
import { Evidence } from './evidence.ts';
import { Intake } from './intake.ts';
import { intakeRoutes } from './intake-routes.ts';
import { Store, ConflictError, requireId } from './store.ts';
async function body(req: IncomingMessage): Promise<Record<string, any>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new ValidationError('Use application/json.');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 4_500_000) throw new ValidationError('Request is too large.'); chunks.push(chunk); }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString());
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value;
  } catch { throw new ValidationError('Invalid JSON object.'); }
}
function exact(obj: Record<string, any>, keys: string[]) {
  if (Object.keys(obj).some(k => !keys.includes(k)) || keys.some(k => !(k in obj))) throw new ValidationError('Unexpected or missing request fields.');
}
export function createApp(store: Store, dist = resolve('dist')) {
  const intake = new Intake(store); const evidence = new Evidence(store,intake); const backups=new Backups(store);
  store.reviewGuard=(input,id)=>evidence.check(input,id); store.afterSave=ride=>evidence.finalize(ride);
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const generation=store.directory;
    const readBody=async (request:IncomingMessage)=>{const parsed=await body(request);if(store.directory!==generation)throw new ConflictError('Dataset was replaced. Reload before editing.');return parsed;};
    const send = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      const port = (req.socket.address() as { port: number }).port;
      const authority = `127.0.0.1:${port}`;
      if (req.headers.host !== authority) { send(403, { error: 'Unexpected host. Open the app using its 127.0.0.1 address.' }); return; }
      if (req.headers.origin && req.headers.origin !== `http://${authority}`) { send(403, { error: 'Unexpected origin.' }); return; }
      if (req.headers['sec-fetch-site'] === 'cross-site') { send(403, { error: 'Cross-site requests are not allowed.' }); return; }
      const url = new URL(req.url!, `http://${authority}`); const path = url.pathname;
      if(backups.busy&&!['GET','HEAD'].includes(req.method??'')){send(409,{error:'Restore validation is in progress. Retry your edit after it finishes.'});return;}
      if(path==='/api/settings'&&req.method==='GET'){send(200,{timezone:JSON.parse(String(store.db.prepare("SELECT value FROM settings WHERE key='timezone'").get()!.value)),data_directory:store.directory,root_directory:store.rootDirectory,ocr:ocrDiagnostics(dist)});return;}
      if(path==='/api/settings'&&req.method==='PUT'){const b=await readBody(req);exact(b,['timezone']);if(typeof b.timezone!=='string')throw new ValidationError('Invalid timezone.');try{new Intl.DateTimeFormat('en',{timeZone:b.timezone});}catch{throw new ValidationError('Invalid timezone.');}store.db.prepare("UPDATE settings SET value=? WHERE key='timezone'").run(JSON.stringify(b.timezone));send(200,{ok:true});return;}
      if(path==='/api/dashboard'&&req.method==='GET'){const f=parseFilters(url.searchParams);const rides=store.list(f);send(200,{summary:summarize(rides),recent:rides.slice(0,10),duplicates:rides.filter(r=>r.status==='draft'&&evidence.candidates(r,r.id).length).length});return;}
      if(path==='/api/backup'&&req.method==='GET'){const archive=backups.snapshot();res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="uber-backup.zip"'});res.end(archive);return;}
      if(path==='/api/restore/preview'&&req.method==='POST'){backups.busy=true;try{send(200,await backups.stage(await binary(req,200_000_000)));}finally{backups.busy=false;}return;}
      if(path==='/api/restore/activate'&&req.method==='POST'){const b=await readBody(req);exact(b,['token','confirmed']);send(200,backups.activate(b.token,b.confirmed));return;}
      if (await intakeRoutes(req, res, url, intake, dist, readBody, send)) return;
      const evidenceMatch = /^\/api\/rides\/([^/]+)\/(evidence|resolve|duplicates|separate|attach)$/.exec(path);
      if(evidenceMatch){ const [,id,action]=evidenceMatch;requireId(id!);
        if(req.method==='GET'&&action==='evidence'){send(200,evidence.view(id!));return;}
        if(req.method==='POST'){const b=await readBody(req);
          if(action==='resolve')send(200,evidence.resolve(id!,b.field,b.value,b.observation_id,b.reason));
          else if(action==='duplicates')send(200,evidence.duplicateSignature(validateInput(b.input),id));
          else if(action==='separate')send(200,evidence.separate(id!,validateInput(b.input),b.reason));
          else if(action==='attach'){if(b.confirmed!==true)throw new ValidationError('Confirm source attachment.');send(200,evidence.attach(id!,b.target_id));}
          else throw new ValidationError('Invalid evidence action.');return;
        }
      }
      if (path === '/api/health' && req.method === 'GET') { send(200, { ok: true, schema_version: 3, data_directory: store.directory, timezone: JSON.parse(String(store.db.prepare("SELECT value FROM settings WHERE key='timezone'").get()!.value)) }); return; }
      if (path === '/api/rides' && req.method === 'GET') { const rides = store.list(parseFilters(url.searchParams)); send(200, { rides, summary: summarize(rides) }); return; }
      if (path === '/api/export' && req.method === 'GET') {
        const scope = url.searchParams.get('scope') ?? 'filtered';
        if (!['all', 'filtered'].includes(scope)) throw new ValidationError('Invalid export scope.');
        const f = scope === 'all' ? {} : parseFilters(url.searchParams);
        const include = url.searchParams.get('include_drafts') === 'true';
        const groups=intake.groups(); const csv = exportCsv(store.list(f).map(r=>({...r,attachment_references:groups.filter(g=>g.ride_id===r.id).flatMap(g=>g.items.map(i=>`originals/${i.attachment.storage_key}`))})), include);
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="uber-rides-${f.month ?? 'export'}.csv"` }); res.end(csv); return;
      }
      if (path === '/api/rides' && req.method === 'POST') {
        const b = await readBody(req); exact(b, ['input', 'status', 'session_id']); if (b.session_id !== null) requireId(b.session_id); send(201, store.save(b.input, b.status, undefined, undefined, b.session_id ?? undefined)); return;
      }
      const rideMatch = /^\/api\/rides\/([^/]+)(?:\/(history|trash|restore|purge))?$/.exec(path);
      if (rideMatch) {
        const [, id, action] = rideMatch; requireId(id!);
        if (req.method === 'GET' && !action) { send(200, store.get(id!)); return; }
        if (req.method === 'GET' && action === 'history') { send(200, store.history(id!)); return; }
        if (req.method === 'PUT' && !action) {
          const b = await readBody(req); exact(b, ['input', 'status', 'revision', 'session_id']); if (b.session_id !== null) requireId(b.session_id); send(200, store.save(b.input, b.status, id, b.revision, b.session_id ?? undefined)); return;
        }
        if (req.method === 'POST' && action && action !== 'history') {
          const b = await readBody(req); exact(b, ['revision', 'confirmed']);
          if (b.confirmed !== true) throw new ValidationError('Explicit confirmation is required.');
          const changed = store.change(id!, action as 'trash' | 'restore' | 'purge', b.revision); if (action === 'purge') intake.cleanup(); send(200, changed); return;
        }
      }
      if (path === '/api/sessions' && req.method === 'GET') { send(200, store.sessions()); return; }
      const sessionMatch = /^\/api\/sessions\/([^/]+)$/.exec(path);
      if (sessionMatch) {
        const id = sessionMatch[1]!; requireId(id);
        if (req.method === 'PUT') {
          const b = await readBody(req); exact(b, ['payload', 'ride_id', 'base_revision', 'revision']);
          send(200, store.saveSession(id, b.payload, b.ride_id, b.base_revision, b.revision)); return;
        }
        if (req.method === 'DELETE') { store.db.prepare('DELETE FROM sessions WHERE id=?').run(id); send(200, { ok: true }); return; }
      }
      if (path.startsWith('/api/')) { send(404, { error: 'API route not found.' }); return; }
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(405, { error: 'Method not allowed.' }); return; }
      const decoded = decodeURIComponent(path); const file = resolve(dist, `.${decoded}`);
      if (!file.startsWith(dist + sep) && file !== dist) { send(403, { error: 'Invalid path.' }); return; }
      const target = extname(file) ? file : resolve(dist, 'index.html');
      const content = await readFile(target);
      const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.gz': 'application/gzip', '.json': 'application/json' };
      res.writeHead(200, { 'Content-Type': types[extname(target)] ?? 'application/octet-stream' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      const status = error instanceof ConflictError ? 409 : error instanceof ValidationError ? 400 : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 404 : 500;
      if (status === 500) console.error(error);
      send(status, { error: status === 500 ? 'Storage or server failure. Your edits have not been saved. Retry after checking the data directory.' : error instanceof Error ? error.message : 'Request failed.' });
    }
  });
}
