import{test}from'node:test';import assert from'node:assert/strict';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import sharp from'sharp';import{Store}from'../server/store.ts';import{Intake}from'../server/intake.ts';import{Evidence}from'../server/evidence.ts';import{blankRide}from'../src/shared/domain.ts';
const complete=()=>({...blankRide(),pickup_location:'Airport',drop_location:'Office',trip_date:'2026-10-06',pickup_time:'09:30:00',financial_basis:'worksheet_cash_plus_credit' as const,cash_collected_paisa:50000,uber_credit_paisa:0,tips_paisa:4000,commission_paisa:5000,pass_charge_paisa:0,financial_confirmed:true});
test('M3 conflicts, preserved observations, correction history and duplicate resolution rechecked on save',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'uber-evidence-'));const store=new Store(directory);const intake=new Intake(store);const evidence=new Evidence(store,intake);store.reviewGuard=(input,id)=>evidence.check(input,id);store.afterSave=r=>evidence.finalize(r);
 try{
  const first=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();const second=await sharp({create:{width:30,height:30,channels:3,background:'red'}}).png().toBuffer();
  const batch=intake.batches([{name:'first.png',size:first.length,type:'image/png'},{name:'second.png',size:second.length,type:'image/png'}]);const a=await intake.upload(batch.id,0,first),b=await intake.upload(batch.id,1,second);intake.move(b.group!.items[0]!.id,a.group!.id);
  for(const [saved,cash]of [[a,'500.00'],[b,'600.00']]as const){const item=saved.group!.items[0]!;const job=intake.job(item.id,'start')as{token:string};intake.job(item.id,'complete',job.token,{text:`Cash collected: BDT ${cash}`,confidence:95,tsv:'',blocks:[]});}
  const draft=intake.draft(a.group!.id);const v=evidence.view(draft.id);assert.equal(v.current.filter(o=>o.field==='cash_collected_paisa').length,2);assert.ok(v.current.some(o=>o.field==='payment_method'&&o.value==='Cash'));
  assert.throws(()=>store.save(complete(),'reviewed',draft.id,1));const chosen=v.current.find(o=>o.value===50000)!;evidence.resolve(draft.id,'cash_collected_paisa',50000,chosen.id,'Compared both screenshots and selected first');
  const reviewed=store.save(complete(),'reviewed',draft.id,1);assert.equal(reviewed.status,'reviewed');assert.equal(evidence.view(draft.id).observations.length,4);
  const manual=store.save(complete(),'draft');assert.throws(()=>store.save(complete(),'reviewed',manual.id,1));evidence.separate(manual.id,complete(),'Different legitimate ride with same time and cash');
  const separate=store.save(complete(),'reviewed',manual.id,1);assert.equal(separate.status,'reviewed');
  assert.throws(()=>store.save({...complete(),cash_collected_paisa:60000},'reviewed',manual.id,2));
  const incoming=store.save(complete(),'draft');const before=store.get(reviewed.id);evidence.attach(incoming.id,reviewed.id);assert.equal(store.get(reviewed.id).cash_collected_paisa,before.cash_collected_paisa);assert.equal(store.get(incoming.id).status,'deleted');assert.ok(store.history(incoming.id).some(h=>h.action==='attached-to-existing'));
  assert.ok(store.db.prepare('SELECT count(*) AS count FROM review_events').get()!.count as number>0);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});

test('Updated route parser excludes old icon-prefixed observations while preserving their history',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'uber-parser-upgrade-'));const store=new Store(directory);const intake=new Intake(store);const evidence=new Evidence(store,intake);
 try{
  const image=await sharp({create:{width:30,height:30,channels:3,background:'white'}}).png().toBuffer();const batch=intake.batches([{name:'route.png',size:image.length,type:'image/png'}]);const upload=await intake.upload(batch.id,0,image);const item=upload.group!.items[0]!;const job=intake.job(item.id,'start')as{token:string};intake.job(item.id,'complete',job.token,{text:'UberX 39 min(s) 10 sec(s) 13:04\nBDT 407.38 Cash collected\nBDT 40 Tip\nMap data ©2026\n? Tejgaon, Dhaka\nBangladesh\nDIT Rd, Dhaka\nBangladesh',confidence:80,tsv:'',blocks:[]});const draft=intake.draft(upload.group!.id);
  const pickup=evidence.view(draft.id).current.find(o=>o.field==='pickup_location')!;const original=store.db.prepare('SELECT * FROM field_observations WHERE id=?').get(pickup.id)!;const legacy={...original,id:crypto.randomUUID(),value:JSON.stringify('? '+pickup.value),parser_version:'1.0.0-experimental'};const columns=Object.keys(legacy);store.db.prepare(`INSERT INTO field_observations (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(legacy));
  const view=evidence.view(draft.id);assert.equal(view.current.filter(o=>o.field==='pickup_location').length,1);assert.equal(view.current.find(o=>o.field==='pickup_location')!.value,'Tejgaon, Dhaka Bangladesh');assert.equal(view.observations.find(o=>o.id===legacy.id)!.active,false);
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
