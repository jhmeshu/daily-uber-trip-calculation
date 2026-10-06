import { randomUUID } from 'node:crypto';
import { Intake, hash } from './intake.ts';
import { Store, requireId } from './store.ts';
import { parseOcr, PARSER_VERSION, sourcePoint } from '../src/shared/parser.ts';
import { blankRide, ValidationError, type Ride, type RideInput } from '../src/shared/domain.ts';
type EvidenceObservation = Record<string,unknown> & {id:string;run_id:string;field:string;value:any;active:boolean};
type FieldDecision = Record<string,unknown> & {field:string;value:any;evidence_signature:string};
export class Evidence {
 constructor(public store:Store,public intake:Intake){}
 sync(rideId:string){
  const items=this.intake.groups().filter(g=>g.ride_id===rideId).flatMap(g=>g.items);
  for(const item of items)for(const run of item.runs){
   for(const o of parseOcr(run.result)){
    const position=o.position?{working:o.position,original:sourcePoint(o.position,run.transform,item.attachment.width,item.attachment.height)}:null;
    this.store.db.prepare('INSERT OR IGNORE INTO field_observations VALUES (?,?,?,?,?,?,?,?,?)').run(randomUUID(),run.id,o.field,JSON.stringify(o.value),o.exact_text,position?JSON.stringify(position):null,o.confidence,PARSER_VERSION,new Date().toISOString());
   }
  }
  return items;
 }
 view(id:string){
  this.store.get(id);const items=this.sync(id);
  const activeRuns=items.filter(i=>i.status==='complete').flatMap(i=>i.runs.slice(0,1).filter(r=>JSON.stringify(r.transform)===JSON.stringify(i.transform)).map(r=>r.id));
  const activeValues=new Set(items.flatMap(i=>i.runs.filter(r=>activeRuns.includes(r.id)).flatMap(r=>parseOcr(r.result).map(o=>JSON.stringify([r.id,o.field,o.value,o.exact_text])))));
  const all=this.store.db.prepare(`SELECT o.*,r.engine,i.attachment_id FROM field_observations o JOIN ocr_runs r ON r.id=o.run_id JOIN import_items i ON i.id=r.item_id JOIN import_groups g ON g.id=i.group_id WHERE g.ride_id=? ORDER BY o.field,o.created_at`).all(id).map(o=>({...o,value:JSON.parse(String(o.value)),position:o.position?JSON.parse(String(o.position)):null,active:activeRuns.includes(String(o.run_id))&&activeValues.has(JSON.stringify([o.run_id,o.field,JSON.parse(String(o.value)),o.exact_text]))} as unknown as EvidenceObservation));
  const current=all.filter(o=>o.active);const signature=hash(Buffer.from(JSON.stringify(current.map(o=>o.id).sort())));
  const decisions=this.store.db.prepare('SELECT * FROM field_decisions WHERE ride_id=?').all(id).map(d=>({...d,value:JSON.parse(String(d.value))} as FieldDecision));
  return{observations:all,current,signature,decisions,parser_version:PARSER_VERSION};
 }
 resolve(id:string,field:string,value:unknown,observationId:string|null,reason:string){
  const r=this.store.get(id);if(r.status==='deleted')throw new ValidationError('Restore the ride before review.');
  if(!(field in blankRide())&&field!=='trip_id')throw new ValidationError('Invalid evidence field.');
  if(typeof reason!=='string'||reason.length>10000||!reason.trim())throw new ValidationError('Explain the field decision.');
  const v=this.view(id);const chosen=observationId?v.current.find(o=>o.id===observationId):null;
  if(observationId&&!chosen||chosen&&(chosen.field!==field||JSON.stringify(chosen.value)!==JSON.stringify(value)))throw new ValidationError('Candidate does not match the current source value.');
  if(value!==null&&typeof value!=='string'&&typeof value!=='number'&&typeof value!=='boolean')throw new ValidationError('Invalid chosen value.');
  this.store.db.prepare('INSERT INTO field_decisions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ride_id,field) DO UPDATE SET value=excluded.value,observation_id=excluded.observation_id,origin=excluded.origin,explained=excluded.explained,evidence_signature=excluded.evidence_signature,updated_at=excluded.updated_at').run(id,field,JSON.stringify(value),observationId,chosen?'extracted':'corrected',reason,v.signature,new Date().toISOString());
  if(field==='trip_id'){
   if(typeof value!=='string'||value.length>255)throw new ValidationError('Invalid trip ID.');
   this.store.db.prepare('INSERT INTO trip_identifiers VALUES (?,?) ON CONFLICT(ride_id) DO UPDATE SET identifier=excluded.identifier').run(id,value);
  }
  this.store.db.prepare('INSERT INTO review_events VALUES (?,?,?,?,?)').run(randomUUID(),id,'field-decision',JSON.stringify({field,value,observation_id:observationId,reason,evidence_signature:v.signature}),new Date().toISOString());
  return this.view(id);
 }
 candidates(input:RideInput,id?:string){
  const identifier=id?this.store.db.prepare('SELECT identifier FROM trip_identifiers WHERE ride_id=?').get(id)?.identifier:undefined;
  return this.store.list().filter(r=>r.id!==id&&r.status==='reviewed').flatMap(r=>{
   const otherIdentifier=this.store.db.prepare('SELECT identifier FROM trip_identifiers WHERE ride_id=?').get(r.id)?.identifier;
   if(identifier&&identifier===otherIdentifier)return[{ride:r,reason:'Matching screenshot trip ID'}];
   if(!input.trip_date||!input.pickup_time||input.trip_date!==r.trip_date||input.pickup_time!==r.pickup_time)return[];
   const route=input.pickup_location&&input.drop_location&&input.pickup_location.toLowerCase()===r.pickup_location?.toLowerCase()&&input.drop_location.toLowerCase()===r.drop_location?.toLowerCase();
   const distance=input.distance_meters!==null&&input.distance_meters===r.distance_meters;
   const amount=input.cash_collected_paisa!==null&&input.cash_collected_paisa===r.cash_collected_paisa||input.reported_net_paisa!==null&&input.reported_net_paisa===r.reported_net_paisa;
   return route||distance||amount?[{ride:r,reason:'Matching date/time with route, distance or amount evidence'}]:[];
  });
 }
 duplicateSignature(input:RideInput,id?:string){const candidates=this.candidates(input,id);return{candidates,signature:hash(Buffer.from(JSON.stringify({date:input.trip_date,time:input.pickup_time,route:[input.pickup_location,input.drop_location],distance:input.distance_meters,amount:[input.cash_collected_paisa,input.uber_credit_paisa,input.reported_net_paisa],candidates:candidates.map(x=>[x.ride.id,x.ride.revision])})))};}
 separate(id:string,input:RideInput,reason:string){this.store.get(id);if(typeof reason!=='string'||!reason.trim()||reason.length>10000)throw new ValidationError('Explain why these are separate rides.');const d=this.duplicateSignature(input,id);this.store.db.prepare('INSERT INTO duplicate_decisions VALUES (?,?,?,?) ON CONFLICT(ride_id) DO UPDATE SET signature=excluded.signature,reason=excluded.reason,created_at=excluded.created_at').run(id,d.signature,reason,new Date().toISOString());this.store.db.prepare('INSERT INTO review_events VALUES (?,?,?,?,?)').run(randomUUID(),id,'save-separately',JSON.stringify({reason,signature:d.signature}),new Date().toISOString());return{ok:true};}
 check(input:RideInput,id?:string){
  if(id){const v=this.view(id);const grouped=new Map<string,Set<string>>();for(const o of v.current){const set=grouped.get(String(o.field))??new Set();set.add(JSON.stringify(o.value));grouped.set(String(o.field),set);}
   for(const[field,values]of grouped)if(values.size>1){const d=v.decisions.find(d=>d.field===field);const value=field==='trip_id'?this.store.db.prepare('SELECT identifier FROM trip_identifiers WHERE ride_id=?').get(id)?.identifier:input[field as keyof RideInput];if(!d||d.evidence_signature!==v.signature||JSON.stringify(d.value)!==JSON.stringify(value))throw new ValidationError(`Resolve conflicting ${field} observations for the current sources before review.`);}
  }
  const d=this.duplicateSignature(input,id);if(d.candidates.length){const decision=id?this.store.db.prepare('SELECT * FROM duplicate_decisions WHERE ride_id=?').get(id):null;if(!decision||decision.signature!==d.signature)throw new ValidationError('Possible duplicate trip. Save as draft, compare matching rides, then attach, skip or explain saving separately.');}
 }
 finalize(r:Ride){
  const v=this.view(r.id);for(const key of Object.keys(blankRide())){
   const value=r[key as keyof RideInput];if(value===null||value==='')continue;
   const old=v.decisions.find(x=>x.field===key);if(old&&JSON.stringify(old.value)===JSON.stringify(value))continue;
   const candidates=v.current.filter(o=>o.field===key);const exact=candidates.find(o=>JSON.stringify(o.value)===JSON.stringify(value));
   this.store.db.prepare('INSERT INTO field_decisions VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(ride_id,field) DO UPDATE SET value=excluded.value,observation_id=excluded.observation_id,origin=excluded.origin,explained=excluded.explained,evidence_signature=excluded.evidence_signature,updated_at=excluded.updated_at').run(r.id,key,JSON.stringify(value),exact?.id?String(exact.id):null,exact?'extracted':candidates.length?'corrected':'manual',old?'Corrected on save':'Reviewed on save',v.signature,new Date().toISOString());
  }
 }
 attach(source:string,target:string){
  const incoming=this.store.get(source),existing=this.store.get(target);if(source===target||incoming.status!=='draft'||existing.status==='deleted')throw new ValidationError('Attach from an incoming draft to an existing active ride.');
  this.store.transaction(()=>{
   const incomingDecisions=this.store.db.prepare('SELECT * FROM field_decisions WHERE ride_id=?').all(source);
   this.store.db.prepare('UPDATE import_groups SET ride_id=? WHERE ride_id=?').run(target,source);
   this.store.event(target,'attach-sources',existing,existing);
   this.store.db.prepare('INSERT INTO review_events VALUES (?,?,?,?,?)').run(randomUUID(),target,'attach-incoming-draft',JSON.stringify({source_ride:incoming,field_decisions:incomingDecisions}),new Date().toISOString());
   const trashed=this.store.change(source,'trash',incoming.revision);this.store.event(source,'attached-to-existing',incoming,trashed);
   this.store.db.prepare('DELETE FROM sessions WHERE ride_id=?').run(source);
  });return existing;
 }
}
