import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import sharp from 'sharp';
import {Store} from '../server/store.ts';import {Intake,hash} from '../server/intake.ts';import {validateBatch} from '../src/shared/intake.ts';
const result={text:'Synthetic OCR output',confidence:90,blocks:[],tsv:''};
test('M2 validates batches and actual images; preserves original, groups and shared references across restart',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'uber-intake-'));let store=new Store(directory);let intake=new Intake(store);
 try {
  assert.throws(()=>validateBatch(Array(21).fill({name:'x.png',size:1,type:'image/png'})));assert.throws(()=>validateBatch([{name:'x.png',size:10000001,type:'image/png'}]));assert.throws(()=>validateBatch([{name:'x.gif',size:1,type:'image/gif'}]));
  const image=await sharp({create:{width:100,height:80,channels:3,background:'white'}}).png().toBuffer();
  const batch=intake.batches([{name:'../../photo.png',size:image.length,type:'image/png'}]);const saved=await intake.upload(batch.id,0,image);const attachment=saved.attachment as any;const item=saved.group!.items[0]!;
  assert.equal(hash(intake.bytes(attachment.id)),hash(image));assert.ok(!attachment.storage_key.includes('..'));assert.equal(attachment.width,100);
  const repeated=await intake.upload(batch.id,0,image);assert.equal(repeated.duplicate,true);assert.equal(intake.groups().length,1);
  const second=store.transaction(()=>intake.createGroup([attachment.id]));const duplicateItem=second.items[0]!;
  await intake.transform(item.id,{rotation:90,crop:{left:0,top:0,width:60,height:70}});const working=await sharp(await intake.working(item.id)).metadata();assert.equal(working.width,60);assert.equal(working.height,70);assert.equal(hash(intake.bytes(attachment.id)),hash(image));
  await assert.rejects(()=>intake.transform(item.id,{rotation:90,crop:{left:0,top:0,width:1000,height:1}}));
  const first=intake.job(item.id,'start') as {token:string};intake.job(item.id,'cancel',first.token);assert.throws(()=>intake.job(item.id,'complete',first.token,result));
  const retry=intake.job(item.id,'start') as {token:string};intake.job(item.id,'complete',retry.token,result);assert.equal(intake.item(item.id).runs[0]!.result.text,result.text);
  intake.job(duplicateItem.id,'start');store.close();store=new Store(directory);intake=new Intake(store);assert.equal(intake.item(duplicateItem.id).status,'interrupted');assert.equal(intake.item(item.id).runs.length,1);
  const ride=intake.draft(saved.group!.id);store.change(ride.id,'trash',1);store.change(ride.id,'purge',2);intake.cleanup();assert.equal(hash(intake.bytes(attachment.id)),hash(image));
  intake.unlink(duplicateItem.id);assert.equal(store.db.prepare('SELECT count(*) AS count FROM attachments').get()!.count,0);
  const invalid=Buffer.from('invalid image');const b=intake.batches([{name:'x.png',size:invalid.length,type:'image/png'}]);await assert.rejects(()=>intake.upload(b.id,0,invalid));
 }finally{store.close();rmSync(directory,{recursive:true,force:true});}
});
