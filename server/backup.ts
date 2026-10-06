import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,openSync,fsyncSync,closeSync } from 'node:fs';
import { join,basename } from 'node:path';
import { zipSync,unzipSync,strToU8,strFromU8 } from 'fflate';
import sharp from 'sharp';
import { Store,requireId } from './store.ts';
import { hash,Intake } from './intake.ts';
import { blankRide,reviewErrors,validateInput,ValidationError } from '../src/shared/domain.ts';
import {validateBatch,validateTransform} from '../src/shared/intake.ts';
export const BACKUP_TABLES=['rides','sessions','confirmations','history','settings','attachments','import_groups','import_items','ocr_runs','upload_batches','upload_slots','field_observations','field_decisions','duplicate_decisions','trip_identifiers','review_events'] as const;
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let i=0;i<8;i++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(data:Uint8Array){let crc=0xffffffff;for(const byte of data)crc=crcTable[(crc^byte)&255]!^(crc>>>8);return(crc^0xffffffff)>>>0;}
const MAX_ARCHIVE=200_000_000,MAX_EXPANDED=512_000_000,MAX_ENTRIES=10000;
export type BackupManifest={format:'uber-ride-tracker';backup_version:1;schema_version:3;created_at:string;tables:Record<string,Record<string,any>[]>;files:{path:string;bytes:number;sha256:string}[]};
function archiveEntries(buffer:Buffer){
 if(buffer.length>MAX_ARCHIVE||buffer.length<22)throw new ValidationError('Backup ZIP is empty, invalid or exceeds 200 MB.');
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw new ValidationError('Invalid ZIP directory.');
 const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
 if(count<1||count>MAX_ENTRIES||buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==count||offset+size!==end||end+22+buffer.readUInt16LE(end+20)!==buffer.length)throw new ValidationError('Unsupported multi-part, oversized or malformed ZIP.');
 let at=offset,total=0;const names=new Set<string>();const checksums=new Map<string,number>();
 for(let i=0;i<count;i++){
  if(at+46>end||buffer.readUInt32LE(at)!==0x02014b50)throw new ValidationError('Invalid ZIP entry.');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),expanded=buffer.readUInt32LE(at+24),length=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42);
  const name=buffer.subarray(at+46,at+46+length).toString('utf8');
  if(flags&1||![0,8].includes(method)||expanded===0xffffffff||local>=offset||!(/^(data\.json|originals\/[0-9a-f-]{36}\.(png|jpg|webp))$/.test(name))||names.has(name))throw new ValidationError('ZIP contains unsafe, duplicate or unsupported entries.');
  if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)throw new ValidationError('Invalid local ZIP header.');
  const localLength=buffer.readUInt16LE(local+26);if(buffer.subarray(local+30,local+30+localLength).toString('utf8')!==name)throw new ValidationError('ZIP entry names disagree.');
  names.add(name);checksums.set(name,buffer.readUInt32LE(at+16));total+=expanded;if(total>MAX_EXPANDED||expanded>(name==='data.json'?100_000_000:10_000_000))throw new ValidationError('Backup expands beyond allowed limits.');at+=46+length+extra+comment;
 }
 if(at!==end)throw new ValidationError('Malformed ZIP directory.');return{names,checksums};
}
function durableWrite(path:string,data:string){writeFileSync(path+'.tmp',data,{mode:0o600});const fd=openSync(path+'.tmp','r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(path+'.tmp',path);const dir=openSync(join(path,'..'),'r');try{fsyncSync(dir);}finally{closeSync(dir);}}
function timestamp(value:unknown){return typeof value==='string'&&/^\d{4}-\d\d-\d\dT/.test(value)&&Number.isFinite(Date.parse(value));}
export class Backups {
 pending=new Map<string,{directory:string;generation:string;counts:Record<string,number>;expires:number}>();
 busy=false;
 constructor(public store:Store){}
 snapshot():Buffer{
  const manifest=this.store.transaction(()=>{
   const tables=Object.fromEntries(BACKUP_TABLES.map(table=>[table,this.store.db.prepare(`SELECT * FROM ${table}`).all()]));
   const files=(tables.attachments??[]).map(a=>{const path=`originals/${a.storage_key}`;const data=readFileSync(join(this.store.directory,path));if(hash(data)!==a.hash)throw new ValidationError('Original image hash mismatch. Repair storage before backup.');return{path,bytes:data.length,sha256:hash(data)};});
   return{format:'uber-ride-tracker',backup_version:1,schema_version:3,created_at:new Date().toISOString(),tables,files} as BackupManifest;
  });
  const archive:Record<string,Uint8Array>={'data.json':strToU8(JSON.stringify(manifest))};
  for(const f of manifest.files)archive[f.path]=readFileSync(join(this.store.directory,f.path));
  const result=Buffer.from(zipSync(archive,{level:6}));if(result.length>MAX_ARCHIVE)throw new ValidationError('Backup exceeds the 200 MB restore limit.');archiveEntries(result);return result;
 }
 async stage(buffer:Buffer,fault?:(step:string)=>void){
  const {names,checksums}=archiveEntries(buffer);let archive:Record<string,Uint8Array>;let manifest:BackupManifest;
  try{archive=unzipSync(buffer);for(const[name,data]of Object.entries(archive))if(crc32(data)!==checksums.get(name))throw new Error('ZIP checksum mismatch');manifest=JSON.parse(strFromU8(archive['data.json']!));}catch{throw new ValidationError('Corrupt backup ZIP or JSON.');}
  if(!manifest||manifest.format!=='uber-ride-tracker'||manifest.backup_version!==1||manifest.schema_version!==3||!timestamp(manifest.created_at)||!manifest.tables||Object.keys(manifest.tables).sort().join(',')!==[...BACKUP_TABLES].sort().join(',')||!Array.isArray(manifest.files))throw new ValidationError('Unsupported backup format or schema.');
  const generation=randomUUID(),directory=join(this.store.rootDirectory,'generations',generation);mkdirSync(directory,{recursive:true,mode:0o700});let candidate:Store|null=null;
  try{
   candidate=new Store(directory);const columns=Object.fromEntries(BACKUP_TABLES.map(t=>[t,candidate!.db.prepare(`PRAGMA table_info(${t})`).all().map(c=>String(c.name))]));
   candidate.transaction(()=>{
    candidate!.db.exec('PRAGMA defer_foreign_keys=ON');for(const t of [...BACKUP_TABLES].reverse())candidate!.db.prepare(`DELETE FROM ${t}`).run();
    for(const table of BACKUP_TABLES){const rows=manifest.tables[table];if(!Array.isArray(rows)||rows.length>100000)throw new ValidationError('Invalid backup record count.');for(const row of rows){if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join(',')!==[...columns[table]!].sort().join(','))throw new ValidationError(`Invalid columns for ${table}.`);if('id'in row)requireId(row.id);candidate!.db.prepare(`INSERT INTO ${table} (${columns[table]!.join(',')}) VALUES (${columns[table]!.map(()=>'?').join(',')})`).run(...columns[table]!.map(c=>row[c]));}}
    if(candidate!.db.prepare('PRAGMA foreign_key_check').all().length)throw new ValidationError('Invalid backup relationships.');
    for(const r of candidate!.list({status:'reviewed'}))if(reviewErrors(validateInput(Object.fromEntries(Object.keys(blankRide()).map(k=>[k,r[k as keyof typeof r]])))).length)throw new ValidationError('Backup contains an invalid reviewed ride.');
    for(const row of manifest.tables.rides!){const input=validateInput(JSON.parse(row.data));if(!timestamp(row.created_at)||!timestamp(row.updated_at)||row.reviewed_at!==null&&!timestamp(row.reviewed_at)||row.deleted_at!==null&&!timestamp(row.deleted_at))throw new ValidationError('Invalid ride timestamps.');if(row.status==='deleted'&&!['draft','reviewed'].includes(row.previous_status))throw new ValidationError('Invalid prior trash status.');void input;}
    for(const s of manifest.tables.sessions!){const payload=JSON.parse(s.payload);const f=payload?.form;const keys=Object.keys(blankRide());if(!f||Object.keys(payload).some(k=>!['form','manual_fields'].includes(k))||(payload.manual_fields!==undefined&&(!Array.isArray(payload.manual_fields)||payload.manual_fields.length>keys.length||payload.manual_fields.some((k:unknown)=>typeof k!=='string'||!keys.includes(k))))||Object.keys(f).sort().join(',')!==keys.sort().join(',')||keys.some(k=>k==='financial_confirmed'?typeof f[k]!=='boolean':typeof f[k]!=='string'||f[k].length>10000))throw new ValidationError('Invalid unfinished session.');if(!timestamp(s.updated_at))throw new ValidationError('Invalid session timestamp.');}
    for(const item of manifest.tables.import_items!){validateTransform(JSON.parse(item.transform));if(item.token!==null)requireId(item.token);}
    for(const run of manifest.tables.ocr_runs!){const r=JSON.parse(run.result);validateTransform(JSON.parse(run.transform));if(typeof r.text!=='string'||r.text.length>500000||typeof r.tsv!=='string'||r.tsv.length>2000000||!Number.isFinite(r.confidence)||r.confidence<0||r.confidence>100)throw new ValidationError('Invalid OCR output in backup.');}
    for(const b of manifest.tables.upload_batches!)validateBatch(JSON.parse(b.descriptors));
    for(const o of manifest.tables.field_observations!){if(!(o.field in blankRide())&&o.field!=='trip_id')throw new ValidationError('Invalid evidence field.');const v=JSON.parse(o.value);if(!['string','number','boolean'].includes(typeof v)||typeof v==='number'&&!Number.isSafeInteger(v))throw new ValidationError('Invalid evidence candidate.');}
    for(const d of manifest.tables.field_decisions!){if(!(d.field in blankRide())&&d.field!=='trip_id')throw new ValidationError('Invalid field decision.');}
    const timezone=candidate!.db.prepare("SELECT value FROM settings WHERE key='timezone'").get();if(!timezone)throw new ValidationError('Missing timezone setting.');try{new Intl.DateTimeFormat('en',{timeZone:JSON.parse(String(timezone.value))});}catch{throw new ValidationError('Invalid timezone setting.');}
    candidate!.db.exec("UPDATE import_items SET status='interrupted',token=NULL WHERE status='running'");
   });
   const attachments=manifest.tables.attachments!;if(manifest.files.length!==attachments.length||names.size!==attachments.length+1)throw new ValidationError('Missing or extra backup files.');mkdirSync(join(directory,'originals'),{recursive:true});mkdirSync(join(directory,'previews'),{recursive:true});
   const fileNames=new Set<string>();
   for(const a of attachments){const expected=`originals/${a.id}.${a.mime==='image/jpeg'?'jpg':a.mime==='image/png'?'png':a.mime==='image/webp'?'webp':'invalid'}`;if(`originals/${a.storage_key}`!==expected)throw new ValidationError('Unsafe image storage key.');const f=manifest.files.find(x=>x.path===expected);const data=archive[expected];if(!f||!data||fileNames.has(f.path)||data.length!==a.bytes||data.length!==f.bytes||hash(data)!==a.hash||hash(data)!==f.sha256)throw new ValidationError('Missing or mismatched original image.');fileNames.add(f.path);
    let metadata;try{metadata=await sharp(data,{limitInputPixels:40000000}).metadata();await sharp(data,{limitInputPixels:40000000}).png().toBuffer();}catch{throw new ValidationError('Backup contains an invalid image.');}if(metadata.width!==a.width||metadata.height!==a.height||`image/${metadata.format}`!==a.mime)throw new ValidationError('Backup image metadata mismatch.');const path=join(directory,f.path);writeFileSync(path,data,{mode:0o600});const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}
   }
   for(const path of [join(directory,'originals'),directory]){const fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
   candidate.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');candidate.close();candidate=null;fault?.('staged');
   const counts=Object.fromEntries(BACKUP_TABLES.map(t=>[t,manifest.tables[t]!.length]));const token=randomUUID();this.pending.set(token,{directory,generation,counts,expires:Date.now()+30*60*1000});return{token,counts,expires_at:new Date(Date.now()+30*60*1000).toISOString()};
  }catch(error){candidate?.close();rmSync(directory,{recursive:true,force:true});if(error instanceof ValidationError)throw error;throw new ValidationError(`Backup validation failed: ${error instanceof Error?error.message:'invalid data'}`);}
 }
 activate(token:string,confirmed:boolean,fault?:(step:string)=>void){
  requireId(token);const staged=this.pending.get(token);if(!staged||staged.expires<Date.now())throw new ValidationError('Restore preview expired. Select the archive again.');if(confirmed!==true)throw new ValidationError('Confirm replacement of the active dataset.');
  const old=this.store.directory;const pointer=join(this.store.rootDirectory,'current.json');const oldPointer=existsSync(pointer)?readFileSync(pointer,'utf8'):JSON.stringify({generation:null});
  this.busy=true;
  try{fault?.('before-activation');durableWrite(pointer,JSON.stringify({generation:staged.generation}));fault?.('after-pointer');this.store.switchDirectory(staged.directory);new Intake(this.store);fault?.('after-open');this.pending.delete(token);return{ok:true,counts:staged.counts};}
  catch(error){durableWrite(pointer,oldPointer);if(this.store.directory!==old)this.store.switchDirectory(old);throw error;}
  finally{this.busy=false;}
 }
}
