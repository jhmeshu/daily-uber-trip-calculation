import { ValidationError } from './domain.ts';
export const MAX_FILE_BYTES = 10_000_000;
export const MAX_FILES = 20;
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
export type Descriptor = { name: string; size: number; type: string };
export type Transform = { rotation: 0 | 90 | 180 | 270; crop: null | { left: number; top: number; width: number; height: number } };
export const originalTransform = (): Transform => ({ rotation: 0, crop: null });
export function validateBatch(raw: unknown): Descriptor[] {
 if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_FILES) throw new ValidationError(`Select 1–${MAX_FILES} images per batch.`);
 for (const f of raw) {
  if (!f || typeof f.name !== 'string' || f.name.length < 1 || f.name.length > 255 || Object.keys(f).sort().join(',') !== 'name,size,type' || !imageTypes.includes(f.type)) throw new ValidationError('Use PNG, JPEG or WebP images with a valid filename.');
  if (!Number.isInteger(f.size) || f.size < 1 || f.size > MAX_FILE_BYTES) throw new ValidationError(`${f.name}: image must be between 1 and 10,000,000 bytes.`);
 }
 return raw;
}
export function validateTransform(raw: unknown): Transform {
 const t = raw as Transform;
 if (!t || Object.keys(t).sort().join(',') !== 'crop,rotation' || ![0,90,180,270].includes(t.rotation)) throw new ValidationError('Invalid image rotation.');
 if (t.crop !== null) {
  if (!t.crop || Object.keys(t.crop).sort().join(',') !== 'height,left,top,width' || Object.values(t.crop).some(x => !Number.isSafeInteger(x) || x < 0) || t.crop.width < 1 || t.crop.height < 1) throw new ValidationError('Use a positive crop rectangle in rotated-image pixels.');
 }
 return t;
}
export type Attachment = { id: string; hash: string; storage_key: string; source_name: string; mime: string; bytes: number; width: number; height: number; created_at: string };
export type ImportItem = { id: string; group_id: string; attachment_id: string; transform: Transform; status: string; token: string | null; error: string | null; updated_at: string; attachment: Attachment; runs: OcrRun[] };
export type OcrResult = { text: string; confidence: number; tsv: string; blocks: unknown };
export type OcrRun = { id: string; engine: string; result: OcrResult; transform: Transform; created_at: string };
export type ImportGroup = { id: string; ride_id: string | null; created_at: string; items: ImportItem[] };
