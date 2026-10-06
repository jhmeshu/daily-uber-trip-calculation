import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const destination = 'public/ocr'; mkdirSync(destination + '/core', { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', destination + '/worker.min.js');
for (const file of readdirSync('node_modules/tesseract.js-core')) if (/\.wasm(\.js)?$/.test(file)) cpSync('node_modules/tesseract.js-core/' + file, destination + '/core/' + file);
cpSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', destination + '/eng.traineddata.gz');
const paths = ['worker.min.js','eng.traineddata.gz', ...readdirSync(destination + '/core').map(x => 'core/' + x)];
writeFileSync(destination + '/manifest.json', JSON.stringify({ engine: 'tesseract.js@7.0.0', language: 'eng@1.0.0/best_int', core: JSON.parse(readFileSync('node_modules/tesseract.js-core/package.json')).version, files: paths.map(path => { const buffer = readFileSync(destination + '/' + path); return { path, bytes: buffer.length, sha256: createHash('sha256').update(buffer).digest('hex') }; }) }, null, 2));
console.log('Local English OCR assets ready.');
