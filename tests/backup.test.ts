import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync,readFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{zipSync,unzipSync,strToU8,strFromU8}from'fflate';import sharp from'sharp';import{Store}from'../server/store.ts';import{Intake,hash}from'../server/intake.ts';import{Evidence}from'../server/evidence.ts';import{Backups,BACKUP_TABLES}from'../server/backup.ts';import{blankRide,summarize}from'../src/shared/domain.ts';
const complete=()=>({...blankRide(),trip_date:'2026-10-06',pickup_time:'09:30:00',financial_basis:'worksheet_cash_plus_credit' as const,cash_collected_paisa:50000,uber_credit_paisa:0,tips_paisa:4000,commission_paisa:5000,pass_charge_paisa:0,financial_confirmed:true});
const IMPORT_TABLES:readonly string[]=['import_sources','import_rows','import_variance'];
const NOW='2026-10-06T09:30:00.000Z';
function seedImport(store:Store,rideId:string,suffix:string){
  const source=crypto.randomUUID(),now=NOW;
  store.db.prepare('INSERT INTO import_sources VALUES (?,?,?,?,?,?,?)').run(source,`ledger-${suffix}.xlsx`,'a'.repeat(64),4096,JSON.stringify(['July-2026']),now,`${suffix} import`);
  store.db.prepare('INSERT INTO import_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),source,'July-2026',9,'LAYOUT_B',JSON.stringify({C:'2026-07-09'}),JSON.stringify({trip_date:'2026-07-09'}),'imported',JSON.stringify(['uber_credit_paisa']),rideId,'',now);
  for(const verdict of ['match','defect'])store.db.prepare('INSERT INTO import_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),source,'July-2026','N10','commission_paisa','12.68','=K9',verdict==='match'?1268:1200,verdict==='match'?0:-68,verdict,'',now);
  return source;
}
const importSnapshot=(s:Store)=>Object.fromEntries(IMPORT_TABLES.map(t=>[t,s.db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()]));
const manifestOf=(buffer:Buffer)=>JSON.parse(strFromU8(unzipSync(buffer)['data.json']!)) as {schema_version:number;tables:Record<string,Record<string,unknown>[]>};
const legacyTables=[...BACKUP_TABLES].filter(t=>!IMPORT_TABLES.includes(t));
function altered(archive:Buffer,mutate:(data:any,files:Record<string,Uint8Array>)=>void){const files=unzipSync(archive);const data=JSON.parse(strFromU8(files['data.json']!));mutate(data,files);files['data.json']=strToU8(JSON.stringify(data));return Buffer.from(zipSync(files));}
test('M4 complete snapshot/restore round trip, staged validation and activation failure recovery',async()=>{
 const root=mkdtempSync(join(tmpdir(),'uber-backup-')),fresh=mkdtempSync(join(tmpdir(),'uber-fresh-'));let store=new Store(root);let destination=new Store(fresh);
 try{
  const intake=new Intake(store),evidence=new Evidence(store,intake);store.afterSave=r=>evidence.finalize(r);
  const image=await sharp({create:{width:70,height:50,channels:3,background:'white'}}).png().toBuffer();const batch=intake.batches([{name:'private-source.png',size:image.length,type:'image/png'}]);const uploaded=await intake.upload(batch.id,0,image);const item=uploaded.group!.items[0]!;const job=intake.job(item.id,'start')as{token:string};intake.job(item.id,'complete',job.token,{text:'Cash collected: BDT 500.00',confidence:95,blocks:[],tsv:''});
  const draft=intake.draft(uploaded.group!.id);const reviewed=store.save(complete(),'reviewed',draft.id,1);store.save(blankRide(),'draft');const trash=store.save(blankRide(),'draft');store.change(trash.id,'trash',1);
  const sid=crypto.randomUUID();store.saveSession(sid,{form:Object.fromEntries(Object.entries(blankRide()).map(([k,v])=>[k,typeof v==='boolean'?v:v===null?'':String(v)])),manual_fields:['tips_paisa','financial_basis']},null,null,0);store.db.prepare("UPDATE settings SET value='\"Europe/London\"' WHERE key='timezone'").run();
  assert.throws(()=>store.saveSession(crypto.randomUUID(),{form:Object.fromEntries(Object.entries(blankRide()).map(([k,v])=>[k,typeof v==='boolean'?v:v===null?'':String(v)])),manual_fields:['unknown_field']},null,null,0));
const archive=new Backups(store).snapshot();const backups=new Backups(destination);destination.save({...complete(),cash_collected_paisa:10000},'reviewed');const oldId=destination.list()[0]!.id;seedImport(destination,oldId,'destination');const own=importSnapshot(destination);
   await assert.rejects(()=>backups.stage(altered(archive,m=>m.backup_version=99)));await assert.rejects(()=>backups.stage(altered(archive,m=>{const p=JSON.parse(m.tables.sessions[0].payload);p.manual_fields=['unknown_field'];m.tables.sessions[0].payload=JSON.stringify(p);}))); await assert.rejects(()=>backups.stage(altered(archive,(_,files)=>{delete files[`originals/${(uploaded.attachment as any).storage_key}`];})));await assert.rejects(()=>backups.stage(altered(archive,m=>m.tables.attachments[0].hash='0'.repeat(64))));await assert.rejects(()=>backups.stage(altered(archive,m=>m.tables.import_items[0].attachment_id=crypto.randomUUID())));await assert.rejects(()=>backups.stage(Buffer.from(zipSync({'../escape':strToU8('bad')}))));await assert.rejects(()=>backups.stage(archive,step=>{if(step==='staged')throw new Error('injected staging failure');}));assert.equal(destination.get(oldId).status,'reviewed');assert.deepEqual(importSnapshot(destination),own);
   const preview=await backups.stage(archive);assert.equal(preview.counts.rides,3);assert.throws(()=>backups.activate(preview.token,false));
   for(const step of ['before-activation','after-pointer','after-open']){assert.throws(()=>backups.activate(preview.token,true,actual=>{if(actual===step)throw new Error('injected activation failure');}));assert.equal(destination.get(oldId).status,'reviewed');assert.deepEqual(importSnapshot(destination),own);}
   backups.activate(preview.token,true);assert.equal(destination.get(reviewed.id).cash_collected_paisa,50000);assert.throws(()=>destination.get(oldId));assert.equal(hash(new Intake(destination).bytes(item.attachment_id)),hash(image));
   for(const table of BACKUP_TABLES)assert.deepEqual(destination.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),table);
   assert.deepEqual(importSnapshot(destination),importSnapshot(store));assert.notDeepEqual(importSnapshot(destination),own);
  assert.equal(summarize(destination.list()).excluding,41000);assert.equal(summarize(destination.list()).count,1);
  destination.close();destination=new Store(fresh);assert.equal(destination.get(reviewed.id).status,'reviewed');assert.equal(hash(new Intake(destination).bytes(item.attachment_id)),hash(image));
store.close();store=new Store(root);assert.equal(store.get(reviewed.id).status,'reviewed'); // original generation remains intact.
  }finally{store.close();destination.close();rmSync(root,{recursive:true,force:true});rmSync(fresh,{recursive:true,force:true});}
 });
test('schema 4 backup contract: nineteen tables ordered for the reverse-delete wipe',()=>{
  const directory=mkdtempSync(join(tmpdir(),'uber-schema4-backup-'));const store=new Store(directory);
  try{
   assert.equal(BACKUP_TABLES.length,19);assert.equal(BACKUP_TABLES[0],'rides');
   assert.deepEqual(BACKUP_TABLES.slice(16),['import_sources','import_rows','import_variance']);
   assert.deepEqual([...BACKUP_TABLES].reverse().slice(0,3),['import_variance','import_rows','import_sources']); // children deleted before parents.
   assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version,4);
   assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
   seedImport(store,store.save(complete(),'reviewed').id,'contract');assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
   const manifest=manifestOf(new Backups(store).snapshot());
   assert.equal(manifest.schema_version,4);assert.deepEqual(Object.keys(manifest.tables),[...BACKUP_TABLES]);
   assert.deepEqual(Object.keys(manifest.tables).slice(0,16),legacyTables);
   assert.equal(manifest.tables.import_rows!.length,1);assert.equal(manifest.tables.import_variance!.length,2);
  }finally{store.close();rmSync(directory,{recursive:true,force:true});}
 });
test('A39: a pre-upgrade v3 manifest restores into schema 4 with the three import tables empty',async()=>{
  const root=mkdtempSync(join(tmpdir(),'uber-v3-src-')),destinationRoot=mkdtempSync(join(tmpdir(),'uber-v3-dst-'));let store=new Store(root),destination=new Store(destinationRoot);
  try{
   const reviewed=store.save(complete(),'reviewed');const trash=store.save(blankRide(),'draft');store.change(trash.id,'trash',1);
   const v4=new Backups(store).snapshot();
   const v3=altered(v4,m=>{m.schema_version=3;for(const table of IMPORT_TABLES)delete m.tables[table];}); // the shape a pre-upgrade archive has.
   const legacy=manifestOf(v3);assert.equal(legacy.schema_version,3);assert.equal(legacy.tables.import_rows,undefined);assert.deepEqual(Object.keys(legacy.tables),legacyTables);
   const previous=destination.save({...complete(),cash_collected_paisa:10000},'reviewed');seedImport(destination,previous.id,'destination');const own=importSnapshot(destination);
   const backups=new Backups(destination);
   await assert.rejects(()=>backups.stage(v3,()=>{throw new Error('injected staging failure');}));
   assert.equal(destination.get(previous.id).status,'reviewed');assert.deepEqual(importSnapshot(destination),own);
   for(const step of ['before-activation','after-pointer','after-open']){
    const staged=await backups.stage(v3);
    assert.throws(()=>backups.activate(staged.token,true,actual=>{if(actual===step)throw new Error('injected activation failure');}));
    assert.equal(destination.get(previous.id).status,'reviewed');assert.deepEqual(importSnapshot(destination),own);
   }
   const preview=await backups.stage(v3);assert.equal(preview.counts.rides,2);
   for(const table of IMPORT_TABLES)assert.equal(preview.counts[table],0);
   backups.activate(preview.token,true);assert.throws(()=>destination.get(previous.id));
   assert.equal(destination.get(reviewed.id).cash_collected_paisa,50000);assert.equal(destination.list().length,1);
   for(const table of IMPORT_TABLES)assert.equal(destination.db.prepare(`SELECT count(*) AS count FROM ${table}`).get()!.count,0,table);
   for(const table of legacyTables)assert.deepEqual(destination.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),store.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all(),table);
   await assert.rejects(()=>backups.stage(altered(v4,m=>m.schema_version=5)));await assert.rejects(()=>backups.stage(altered(v4,m=>m.schema_version=2)));await assert.rejects(()=>backups.stage(altered(v4,m=>m.schema_version='4')));await assert.rejects(()=>backups.stage(altered(v4,m=>{m.tables.unknown_table=[];})));await assert.rejects(()=>backups.stage(altered(v4,m=>{m.tables.rides[0].surprise=1;})));
   await assert.rejects(()=>backups.stage(altered(v3,m=>{m.tables.import_rows=[];}))); // a v3 archive may not carry the v4 import tables.
   assert.equal(destination.get(reviewed.id).status,'reviewed');assert.deepEqual(destination.db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{store.close();destination.close();rmSync(root,{recursive:true,force:true});rmSync(destinationRoot,{recursive:true,force:true});}
 });
