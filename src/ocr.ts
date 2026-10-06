import { createWorker } from 'tesseract.js';
import type { OcrResult } from './shared/intake.ts';
export interface OcrAdapter { recognize(image: Blob, signal: AbortSignal, progress: (value: number, status: string) => void): Promise<OcrResult> }
export class TesseractAdapter implements OcrAdapter {
 async recognize(image: Blob, signal: AbortSignal, progress: (value: number, status: string) => void) {
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new DOMException('Recognition cancelled', 'AbortError')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); });
  let fail!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => { fail = reject; });
  let finished = false;
  const timeout = setTimeout(() => fail(new Error('Recognition timed out. Please retry.')), 120000);
  const origin = window.location.origin;
  const creation = createWorker('eng', 1, { workerPath: `${origin}/ocr/worker.min.js`, corePath: `${origin}/ocr/core`, langPath: `${origin}/ocr`, workerBlobURL: false, cacheMethod: 'none', errorHandler: error => fail(new Error(String(error))), logger: m => progress(m.progress ?? 0, m.status) });
  // A worker finishing initialization after cancellation must still be terminated.
  creation.then(w => { if (signal.aborted || finished) void w.terminate(); }).catch(() => undefined);
  let worker: Awaited<typeof creation> | undefined;
  try {
   worker = await Promise.race([creation, cancelled, failed]);
   const output = await Promise.race([worker.recognize(image, {}, { text: true, blocks: true, tsv: true }), cancelled, failed]);
   return { text: output.data.text, confidence: output.data.confidence, blocks: output.data.blocks, tsv: output.data.tsv ?? '' };
  } finally { finished = true; clearTimeout(timeout); signal.removeEventListener('abort', abort); if (worker) await worker.terminate(); }
 }
}
