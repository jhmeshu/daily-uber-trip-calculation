import type { IncomingMessage, ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Intake } from './intake.ts';
import { ValidationError } from '../src/shared/domain.ts';
import { MAX_FILE_BYTES } from '../src/shared/intake.ts';
export async function binary(req: IncomingMessage, limit: number) {
 const chunks: Buffer[] = []; let size = 0;
 for await (const chunk of req) { size += chunk.length; if (size > limit) throw new ValidationError(`Request exceeds ${limit} bytes.`); chunks.push(chunk); }
 return Buffer.concat(chunks);
}
export function ocrDiagnostics(dist: string) {
 const manifestPath = join(dist,'ocr','manifest.json');
 if (!existsSync(manifestPath)) return { available: false, missing: ['OCR assets. Run npm run setup:ocr and npm run build.'] };
 const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
 const missing = manifest.files.filter((f: { path: string }) => !existsSync(join(dist,'ocr',f.path))).map((f: { path: string }) => f.path);
 return { available: missing.length === 0, missing, manifest };
}
export async function intakeRoutes(req: IncomingMessage, res: ServerResponse, url: URL, intake: Intake, dist: string, body: (r: IncomingMessage) => Promise<any>, send: (status: number, data: unknown) => void): Promise<boolean> {
 const p = url.pathname;
 if (p === '/api/ocr' && req.method === 'GET') { send(200, ocrDiagnostics(dist)); return true; }
 if (p === '/api/import' && req.method === 'GET') { send(200, intake.groups()); return true; }
 if (p === '/api/import/batch' && req.method === 'POST') { const b = await body(req); send(201, intake.batches(b.files)); return true; }
 const upload = /^\/api\/import\/upload\/([^/]+)\/(\d+)$/.exec(p);
 if (upload && req.method === 'PUT') { const buffer = await binary(req, MAX_FILE_BYTES); send(201, await intake.upload(upload[1]!, Number(upload[2]), buffer)); return true; }
 if (p === '/api/import/groups' && req.method === 'POST') { const b = await body(req); send(201, intake.store.transaction(() => intake.createGroup(b.attachments))); return true; }
 const item = /^\/api\/items\/([^/]+)\/(transform|job|move|remove|image)$/.exec(p);
 if (item) {
  const [, id, action] = item;
  if (req.method === 'GET' && action === 'image') { res.writeHead(200, { 'Content-Type': 'image/png' }); res.end(await intake.working(id!)); return true; }
  if (req.method === 'POST') {
   const b = await body(req);
   if (action === 'transform') send(200, await intake.transform(id!, b.transform));
   else if (action === 'job') send(200, intake.job(id!, b.action, b.token, b.result));
   else if (action === 'move') send(200, intake.move(id!, b.group_id));
   else if (action === 'remove') { intake.unlink(id!); send(200, { ok: true }); }
   else return false;
   return true;
  }
 }
 const draft = /^\/api\/import\/groups\/([^/]+)\/draft$/.exec(p);
 if (draft && req.method === 'POST') { send(200, intake.draft(draft[1]!)); return true; }
 const media = /^\/api\/attachments\/([^/]+)\/(original|preview)$/.exec(p);
 if (media && req.method === 'GET') { const a = intake.attachment(media[1]!); res.writeHead(200, { 'Content-Type': media[2] === 'preview' ? 'image/png' : a.mime }); res.end(media[2] === 'preview' ? intake.preview(a.id) : intake.bytes(a.id)); return true; }
 const sources = /^\/api\/rides\/([^/]+)\/sources$/.exec(p);
 if (sources && req.method === 'GET') { intake.store.get(sources[1]!); send(200, intake.groups().filter(g => g.ride_id === sources[1]).flatMap(g => g.items)); return true; }
 return false;
}
