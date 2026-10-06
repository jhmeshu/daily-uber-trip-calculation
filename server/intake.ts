import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type Metadata } from 'sharp';
import { Store, ConflictError, requireId } from './store.ts';
import { blankRide, ValidationError } from '../src/shared/domain.ts';
import { originalTransform, validateBatch, validateTransform, type Attachment, type Descriptor, type ImportGroup, type ImportItem, type OcrResult } from '../src/shared/intake.ts';
export const hash = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');
export class Intake {
 constructor(public store: Store) { mkdirSync(join(store.directory, 'originals'), { recursive: true }); mkdirSync(join(store.directory, 'previews'), { recursive: true }); this.cleanup(); }
 batches(files: unknown) { const descriptors = validateBatch(files); const id = randomUUID(); this.store.db.prepare('INSERT INTO upload_batches VALUES (?,?,?)').run(id, JSON.stringify(descriptors), new Date().toISOString()); return { id }; }
 attachment(id: string): Attachment { requireId(id); const a = this.store.db.prepare('SELECT * FROM attachments WHERE id=?').get(id); if (!a) throw new ValidationError('Image not found.'); return a as unknown as Attachment; }
 bytes(id: string) { return readFileSync(join(this.store.directory, 'originals', this.attachment(id).storage_key)); }
 async upload(batchId: string, slot: number, buffer: Buffer) {
  const generation=this.store.directory;
  requireId(batchId); const batch = this.store.db.prepare('SELECT * FROM upload_batches WHERE id=?').get(batchId);
  if (!batch) throw new ValidationError('Upload batch not found.');
  const descriptors: Descriptor[] = JSON.parse(String(batch.descriptors)); const descriptor = descriptors[slot];
  if (!Number.isInteger(slot) || !descriptor || buffer.length !== descriptor.size) throw new ValidationError('File does not match its batch slot or declared size.');
  const digest = hash(buffer); const old = this.store.db.prepare('SELECT * FROM attachments WHERE hash=?').get(digest);
  if (old && old.mime !== descriptor.type) throw new ValidationError('Image content does not match its declared type.');
  if (old) return { attachment: old, duplicate: true, groups: this.groups().filter(g => g.items.some(i => i.attachment_id === old.id)).map(g => ({ id: g.id, ride_id: g.ride_id })), group: null };
  if (this.store.db.prepare('SELECT * FROM upload_slots WHERE batch_id=? AND slot=?').get(batchId, slot)) throw new ConflictError('This batch slot was already uploaded.');
  let metadata: Metadata; let preview: Buffer;
  try {
   const image = sharp(buffer, { limitInputPixels: 40_000_000, animated: false }); metadata = await image.metadata();
   if (!['png','jpeg','webp'].includes(metadata.format ?? '') || metadata.pages && metadata.pages > 1) throw new Error();
   preview = await image.resize({ width: 1000, height: 1000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  } catch { throw new ValidationError('Image cannot be decoded, is animated, or exceeds 40 million pixels.'); }
  if(this.store.directory!==generation)throw new ConflictError('Dataset changed during upload. Select your files again.');
  const mime = `image/${metadata.format}`; if (mime !== descriptor.type) throw new ValidationError('Image content does not match its declared type.');
  const id = randomUUID(); const storageKey = `${id}.${metadata.format === 'jpeg' ? 'jpg' : metadata.format}`; const now = new Date().toISOString();
  const originalPath = join(this.store.directory, 'originals', storageKey); const previewPath = join(this.store.directory, 'previews', `${id}.png`);
  writeFileSync(originalPath + '.tmp', buffer, { flag: 'wx', mode: 0o600 }); renameSync(originalPath + '.tmp', originalPath);
  writeFileSync(previewPath + '.tmp', preview, { flag: 'wx', mode: 0o600 }); renameSync(previewPath + '.tmp', previewPath);
  try {
   const group = this.store.transaction(() => {
    this.store.db.prepare('INSERT INTO attachments VALUES (?,?,?,?,?,?,?,?,?)').run(id, digest, storageKey, descriptor.name, mime, buffer.length, metadata.width!, metadata.height!, now);
    this.store.db.prepare('INSERT INTO upload_slots VALUES (?,?,?)').run(batchId, slot, id);
    return this.createGroup([id]);
   });
   return { attachment: this.attachment(id), duplicate: false, groups: [], group };
  } catch (error) { rmSync(originalPath, { force: true }); rmSync(previewPath, { force: true }); throw error; }
 }
 createGroup(ids: string[]) {
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length) throw new ValidationError('Choose 1–20 distinct images for a trip.');
  ids.forEach(id => this.attachment(id));
  const groupId = randomUUID(); const now = new Date().toISOString();
  this.store.db.prepare('INSERT INTO import_groups VALUES (?,?,?)').run(groupId, null, now);
  for (const id of ids) {
   const itemId = randomUUID(); const transform = JSON.stringify(originalTransform());
   const existing = this.store.db.prepare('SELECT r.* FROM ocr_runs r JOIN import_items i ON i.id=r.item_id WHERE i.attachment_id=? AND r.transform=? ORDER BY r.created_at DESC LIMIT 1').get(id, transform);
   this.store.db.prepare('INSERT INTO import_items VALUES (?,?,?,?,?,?,?,?)').run(itemId, groupId, id, transform, existing ? 'complete' : 'ready', null, null, now);
   if (existing) this.store.db.prepare('INSERT INTO ocr_runs VALUES (?,?,?,?,?,?,?)').run(randomUUID(), itemId, randomUUID(), String(existing.engine), String(existing.result), transform, now);
  }
  return this.groups().find(g => g.id === groupId)!;
 }
 groups(): ImportGroup[] {
  return this.store.db.prepare('SELECT * FROM import_groups ORDER BY created_at DESC').all().map(g => ({ ...g, items: this.store.db.prepare('SELECT * FROM import_items WHERE group_id=? ORDER BY rowid').all(String(g.id)).map(row => this.decodeItem(row)) }) as ImportGroup);
 }
 decodeItem(row: Record<string, unknown>): ImportItem {
  const runs = this.store.db.prepare('SELECT * FROM ocr_runs WHERE item_id=? ORDER BY created_at DESC, rowid DESC').all(String(row.id)).map(r => ({ ...r, result: JSON.parse(String(r.result)), transform: JSON.parse(String(r.transform)) }));
  return { ...row, transform: JSON.parse(String(row.transform)), attachment: this.attachment(String(row.attachment_id)), runs } as ImportItem;
 }
 item(id: string) { requireId(id); const row = this.store.db.prepare('SELECT * FROM import_items WHERE id=?').get(id); if (!row) throw new ValidationError('Queue item not found.'); return this.decodeItem(row); }
 async working(id: string) {
  const item = this.item(id); const t = item.transform;
  let image = sharp(this.bytes(item.attachment_id), { limitInputPixels: 40_000_000 }).rotate(t.rotation);
  // Materialize rotation before extracting so crop coordinates refer to the rotated image.
  if (t.crop) image = sharp(await image.png().toBuffer()).extract(t.crop);
  return image.png().toBuffer();
 }
 async transform(id: string, raw: unknown) {
  const t = validateTransform(raw); const item = this.item(id);
  const w = t.rotation % 180 ? item.attachment.height : item.attachment.width; const h = t.rotation % 180 ? item.attachment.width : item.attachment.height;
  if (t.crop && (t.crop.left + t.crop.width > w || t.crop.top + t.crop.height > h)) throw new ValidationError('Crop is outside the rotated image.');
  this.store.db.prepare("UPDATE import_items SET transform=?,status='ready',token=NULL,error=NULL,updated_at=? WHERE id=?").run(JSON.stringify(t), new Date().toISOString(), id);
  return this.item(id);
 }
 job(id: string, action: string, token?: string, result?: unknown) {
  this.item(id); const now = new Date().toISOString();
  if (action === 'start') { const fresh = randomUUID(); this.store.db.prepare("UPDATE import_items SET status='running',token=?,error=NULL,updated_at=? WHERE id=?").run(fresh, now, id); return { token: fresh }; }
  requireId(token!);
  const current = this.item(id); if (current.token !== token || current.status !== 'running') throw new ConflictError('OCR job was cancelled or replaced; late output discarded.');
  if (action === 'complete') {
   const r = result as OcrResult;
   if (!r || typeof r.text !== 'string' || r.text.length > 500_000 || typeof r.tsv !== 'string' || r.tsv.length > 2_000_000 || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 100 || JSON.stringify(r).length > 4_000_000) throw new ValidationError('Invalid OCR output.');
   this.store.transaction(() => {
    this.store.db.prepare('INSERT INTO ocr_runs VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, token!, 'tesseract.js@7.0.0/eng@1.0.0', JSON.stringify(r), JSON.stringify(current.transform), now);
    this.store.db.prepare("UPDATE import_items SET status='complete',updated_at=? WHERE id=?").run(now, id);
   });
  } else if (action === 'cancel' || action === 'fail') {
   this.store.db.prepare('UPDATE import_items SET status=?,error=?,token=NULL,updated_at=? WHERE id=?').run(action === 'cancel' ? 'cancelled' : 'failed', action === 'fail' ? String(result ?? 'Recognition failed').slice(0,1000) : null, now, id);
  } else throw new ValidationError('Invalid OCR action.');
  return this.item(id);
 }
 move(id: string, groupId: string) {
  const item = this.item(id); requireId(groupId); const target = this.groups().find(g => g.id === groupId);
  if (!target || target.ride_id) throw new ValidationError('Choose an unsaved trip group.');
  if (this.groups().find(g => g.id === item.group_id)?.ride_id) throw new ValidationError('Saved attachments cannot be regrouped here.');
  if (target.items.length >= 20) throw new ValidationError('Trip group already contains 20 images.');
  this.store.db.prepare('UPDATE import_items SET group_id=? WHERE id=?').run(groupId, id); this.cleanup(); return this.groups();
 }
 unlink(id: string) { const item = this.item(id); if (this.groups().find(g => g.id === item.group_id)?.ride_id) throw new ValidationError('Cannot remove a saved source image here.'); this.store.db.prepare('DELETE FROM import_items WHERE id=?').run(id); this.cleanup(); }
 draft(groupId: string) {
  requireId(groupId); const g = this.groups().find(x => x.id === groupId); if (!g || !g.items.length) throw new ValidationError('Empty trip group.');
  if (g.ride_id) return this.store.get(g.ride_id);
  return this.store.transaction(() => { const input = blankRide(); input.timezone = JSON.parse(String(this.store.db.prepare("SELECT value FROM settings WHERE key='timezone'").get()!.value)); const ride = this.store.save(input, 'draft'); this.store.db.prepare('UPDATE import_groups SET ride_id=? WHERE id=?').run(ride.id, groupId); return ride; });
 }
 cleanup() {
  // Batch slots are upload receipts, not owners. Only active item references retain originals.
  const unused = this.store.db.prepare('SELECT * FROM attachments WHERE id NOT IN (SELECT attachment_id FROM import_items)').all();
  for (const row of unused) {
   this.store.transaction(() => { this.store.db.prepare('DELETE FROM upload_slots WHERE attachment_id=?').run(String(row.id)); this.store.db.prepare('DELETE FROM attachments WHERE id=?').run(String(row.id)); });
   rmSync(join(this.store.directory, 'originals', String(row.storage_key)), { force: true }); rmSync(join(this.store.directory, 'previews', `${row.id}.png`), { force: true });
  }
  this.store.db.prepare('DELETE FROM import_groups WHERE ride_id IS NULL AND id NOT IN (SELECT group_id FROM import_items)').run();
  const retained = this.store.db.prepare('SELECT id,storage_key FROM attachments').all();
  for (const folder of ['originals','previews']) {
   const expected = new Set(retained.map(a => folder === 'originals' ? String(a.storage_key) : `${a.id}.png`));
   for (const name of readdirSync(join(this.store.directory, folder))) if (!expected.has(name)) rmSync(join(this.store.directory, folder, name), { force: true });
  }
 }
 preview(id: string) { const a = this.attachment(id); const path = join(this.store.directory, 'previews', `${a.id}.png`); return existsSync(path) ? readFileSync(path) : this.bytes(id); }
}
