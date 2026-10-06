import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blankRide, financialSignature, matches, reviewErrors, validateInput, ValidationError, type Filters, type Ride, type RideInput } from '../src/shared/domain.ts';
export class ConflictError extends Error {}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function requireId(id: string) { if (typeof id !== 'string' || !uuidPattern.test(id)) throw new ValidationError('Invalid ID.'); }
export function migrate(db: DatabaseSync, migrations: string[]) {
  const version = Number((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  if (version > migrations.length) throw new Error('Database is newer than this app; use the matching app version.');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let i = version; i < migrations.length; i++) { db.exec(migrations[i]!); db.exec(`PRAGMA user_version = ${i + 1}`); }
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
export type Session = { id: string; ride_id: string | null; base_revision: number | null; revision: number; payload: unknown; updated_at: string };
export class Store {
  db: DatabaseSync;
  rootDirectory:string;
  reviewGuard?: (input:RideInput,id?:string)=>void;
  afterSave?: (ride:Ride)=>void;
  constructor(public directory: string) {
    this.rootDirectory=directory;
    const pointer=join(directory,'current.json');
    if(existsSync(pointer)){const p=JSON.parse(readFileSync(pointer,'utf8'));if(p.generation!==null){requireId(p.generation);this.directory=directory=join(directory,'generations',p.generation);if(!existsSync(join(directory,'rides.sqlite')))throw new Error('Active dataset is missing; recover the retained data generation.');}}
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'rides.sqlite'), { timeout: 5000 });
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;');
    try { migrate(this.db, ['001-initial.sql', '002-intake.sql', '003-evidence.sql'].map(name => readFileSync(fileURLToPath(new URL(`./migrations/${name}`, import.meta.url)), 'utf8'))); }
    catch (err) { this.db.close(); throw err; }
    this.db.exec("UPDATE import_items SET status='interrupted',token=NULL WHERE status='running'");
  }
  close() { this.db.close(); }
  switchDirectory(directory:string){const next=new DatabaseSync(join(directory,'rides.sqlite'),{timeout:5000});next.exec('PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;');this.db.close();this.db=next;this.directory=directory;}
  transaction<T>(fn: () => T): T {
    if (this.db.isTransaction) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (err) { this.db.exec('ROLLBACK'); throw err; }
  }
  decode(row: Record<string, unknown>): Ride {
    const { data, ...meta } = row; return { ...JSON.parse(String(data)), ...meta } as Ride;
  }
  get(id: string): Ride {
    requireId(id); const row = this.db.prepare('SELECT * FROM rides WHERE id = ?').get(id);
    if (!row) throw new ValidationError('Ride does not exist.'); return this.decode(row);
  }
  list(f: Filters = {}) {
    return this.db.prepare('SELECT * FROM rides ORDER BY updated_at DESC, id').all().map(row => this.decode(row)).filter(r => matches(r, f));
  }
  save(raw: unknown, status: 'draft' | 'reviewed', id?: string, revision?: number, sessionId?: string): Ride {
    const input = validateInput(raw);
    if (!['draft', 'reviewed'].includes(status)) throw new ValidationError('Invalid save status.');
    if (sessionId) requireId(sessionId);
    return this.transaction(() => {
      const before = id ? this.get(id) : null;
      if (before?.status === 'deleted') throw new ValidationError('Restore the ride before editing.');
      if (before && before.revision !== revision) throw new ConflictError('This ride changed in another window. Reload before saving. Your unfinished edits remain available.');
      if (status === 'reviewed') {
        this.reviewGuard?.(input,id);
        const errors = reviewErrors(input); if (errors.length) throw new ValidationError(errors.join(' '));
      }
      const now = new Date().toISOString(); const rideId = before?.id ?? randomUUID(); const rev = (before?.revision ?? 0) + 1;
      const r: Ride = { ...input, id: rideId, status, revision: rev, created_at: before?.created_at ?? now, updated_at: now,
        reviewed_at: status === 'reviewed' ? now : null, deleted_at: null, previous_status: null };
      this.db.prepare(`INSERT INTO rides(id,status,revision,data,created_at,updated_at,reviewed_at) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, revision=excluded.revision, data=excluded.data, updated_at=excluded.updated_at, reviewed_at=excluded.reviewed_at`).run(rideId, status, rev, JSON.stringify(input), r.created_at, now, r.reviewed_at);
      if (status === 'reviewed') this.db.prepare('INSERT INTO confirmations VALUES (?,?,?,?,?)').run(randomUUID(), rideId, rev, financialSignature(input), now);
      this.event(rideId, before ? 'edit' : 'create', before, r);
      this.afterSave?.(r);
      if (sessionId) {
        const session = this.getSession(sessionId);
        if (session && session.ride_id !== (id ?? null)) throw new ValidationError('Session belongs to a different ride.');
        this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
      }
      return r;
    });
  }
  event(id: string, action: string, before: Ride | null, after: Ride | null) {
    this.db.prepare('INSERT INTO history VALUES (?,?,?,?,?,?)').run(randomUUID(), id, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, new Date().toISOString());
  }
  change(id: string, action: 'trash' | 'restore' | 'purge', revision: number) {
    return this.transaction(() => {
      const before = this.get(id);
      if (before.revision !== revision) throw new ConflictError('Ride changed. Reload before continuing.');
      if (action === 'purge') {
        if (before.status !== 'deleted') throw new ValidationError('Only trashed rides can be permanently removed.');
        this.db.prepare('DELETE FROM rides WHERE id = ?').run(id); return null;
      }
      const now = new Date().toISOString(); let r: Ride;
      if (action === 'trash') {
        if (before.status === 'deleted') throw new ValidationError('Ride is already in trash.');
        r = { ...before, previous_status: before.status, status: 'deleted', deleted_at: now, updated_at: now, revision: before.revision + 1 };
      } else {
        if (before.status !== 'deleted') throw new ValidationError('Ride is not in trash.');
        const status = before.previous_status === 'reviewed' && reviewErrors(before).length === 0 ? 'reviewed' : 'draft';
        r = { ...before, status, previous_status: null, deleted_at: null, updated_at: now, revision: before.revision + 1 };
      }
      this.db.prepare('UPDATE rides SET status=?,revision=?,updated_at=?,deleted_at=?,previous_status=? WHERE id=?').run(r.status, r.revision, now, r.deleted_at, r.previous_status, id);
      this.event(id, action, before, r); return r;
    });
  }
  history(id: string) {
    this.get(id);
    return this.db.prepare('SELECT * FROM history WHERE ride_id=? ORDER BY created_at DESC, rowid DESC').all(id).map(row => ({ ...row, before_data: row.before_data ? JSON.parse(String(row.before_data)) : null, after_data: row.after_data ? JSON.parse(String(row.after_data)) : null } as Record<string,unknown> & {action:string;before_data:any;after_data:any}));
  }
  sessions(): Session[] { return this.db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all().map(row => ({ ...row, payload: JSON.parse(String(row.payload)) }) as Session); }
  getSession(id: string) { requireId(id); return this.sessions().find(s => s.id === id); }
  saveSession(id: string, payload: unknown, rideId: string | null, baseRevision: number | null, revision: number): Session {
    requireId(id);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || JSON.stringify(payload).length > 100_000) throw new ValidationError('Invalid editing session.');
    const obj = payload as Record<string, unknown>; const form = obj.form as Record<string, unknown>;
    const keys = Object.keys(blankRide());
    if (Object.keys(obj).some(k=>!['form','manual_fields'].includes(k)) || (obj.manual_fields!==undefined&&(!Array.isArray(obj.manual_fields)||obj.manual_fields.length>keys.length||obj.manual_fields.some(k=>typeof k!=='string'||!keys.includes(k)))) || !form || typeof form !== 'object' || Array.isArray(form) || Object.keys(form).length !== keys.length || keys.some(k => k === 'financial_confirmed' ? typeof form[k] !== 'boolean' : typeof form[k] !== 'string' || String(form[k]).length > 10_000)) throw new ValidationError('Invalid unfinished form fields.');
    if (rideId !== null) { requireId(rideId); if (!Number.isSafeInteger(baseRevision) || baseRevision! < 1) throw new ValidationError('Invalid ride revision.'); }
    if (!Number.isSafeInteger(revision) || revision < 0) throw new ValidationError('Invalid session revision.');
    return this.transaction(() => {
      const old = this.getSession(id);
      if ((old?.revision ?? 0) !== revision) throw new ConflictError('Editing session changed in another window. Reload before editing.');
      if (rideId) {
        const r = this.get(rideId);
        if (r.status === 'deleted' || r.revision !== baseRevision) throw new ConflictError('Saved ride changed. Reload before editing.');
      } else if (baseRevision !== null) throw new ValidationError('New session cannot have a ride revision.');
      if (old && (old.ride_id !== rideId || old.base_revision !== baseRevision)) throw new ValidationError('Session target cannot change.');
      const now = new Date().toISOString();
      this.db.prepare(`INSERT INTO sessions VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload,updated_at=excluded.updated_at`).run(id, rideId, baseRevision, revision + 1, JSON.stringify(payload), now);
      return this.getSession(id)!;
    });
  }
}
