import {test,expect} from '@playwright/test';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import sharp from 'sharp';
import {Store} from '../server/store.ts';import {createApp} from '../server/app.ts';
let directory:string;let store:Store;let server:ReturnType<typeof createApp>;let base:string;
test.beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),'uber-ocr-browser-'));store=new Store(directory);server=createApp(store);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address() as {port:number}).port}`;});
test.afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(directory,{recursive:true,force:true});});
test('M2 real local OCR, cancellation/retry, duplicate warning, grouping, and source viewer',async({page})=>{
 test.setTimeout(120000);const outside:string[]=[];const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(!route.request().url().startsWith(base)){outside.push(route.request().url());return route.abort();}return route.continue();});
 const image=await sharp('tests/fixtures/synthetic-trip.svg').png().toBuffer();
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();
 await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles({name:'synthetic-trip.png',mimeType:'image/png',buffer:image});
 await expect(page.getByRole('heading',{name:/Trip group/})).toBeVisible();
 await page.getByRole('button',{name:'Recognize / retry'}).click();await page.getByRole('button',{name:'Cancel recognition'}).click();
 await expect(page.getByText('cancelled',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Recognize / retry'}).click();await expect(page.getByText('complete',{exact:true})).toBeVisible({timeout:90000});
 await page.getByText('Raw OCR text',{exact:true}).click();await expect(page.locator('pre')).toContainText('Cash collected');await expect(page.locator('pre')).toContainText('500.00');
 const groups=await (await page.request.get(base+'/api/import')).json();expect(groups[0].items[0].runs[0].result.blocks.length).toBeGreaterThan(0);
 await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles({name:'repeat.png',mimeType:'image/png',buffer:image});await expect(page.getByText(/Exact image duplicate/)).toBeVisible();await page.getByRole('button',{name:'Reuse for another group'}).click();
 await expect(page.getByRole('heading',{name:/Trip group/})).toHaveCount(2);
 await page.getByLabel('Move synthetic-trip.png').first().selectOption(groups[0].id);
 await expect.poll(async()=>{const g=await(await page.request.get(base+'/api/import')).json();return g.find((x:any)=>x.id===groups[0].id).items.length;}).toBe(2);
 await page.getByRole('button',{name:'Review this trip'}).last().click();
 await expect(page.getByRole('heading',{name:'Source screenshots'})).toBeVisible();await expect(page.getByLabel('Source image',{exact:true}).locator('option')).toHaveCount(2);
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('500.00'); // Unambiguous fields populate on opening review.
 await page.getByRole('button',{name:'Apply unambiguous candidates to blank fields'}).click();
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('500.00');await expect(page.getByLabel('Trip date',{exact:true})).toHaveValue('2026-10-06');await expect(page.getByLabel('Distance (km)',{exact:true})).toHaveValue('12.500');
 await page.getByLabel('Cash collected',{exact:true}).fill('600.00');await page.getByRole('button',{name:'Apply unambiguous candidates to blank fields'}).click();await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('600.00');
 expect(outside).toEqual([]);expect(errors).toEqual([]);
});

test('Opening review reads the screenshot automatically and retry preserves corrections',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const image=await sharp('tests/fixtures/synthetic-trip.svg').png().toBuffer();
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();
 // A distinct image avoids existing imports from the preceding test.
 const unique=await sharp(image).extend({bottom:2,background:'white'}).png().toBuffer();
 await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles({name:'review-auto.png',mimeType:'image/png',buffer:unique});
 await page.getByRole('button',{name:'Review this trip'}).last().click();
 await page.getByRole('button',{name:'Cancel reading'}).click();await expect(page.getByRole('alert').filter({hasText:'Reading cancelled'})).toBeVisible();await page.getByRole('button',{name:'Read screenshots / retry'}).click();
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('500.00',{timeout:90000});await expect(page.getByLabel('Net earnings',{exact:true})).toHaveValue('460.00');
 await expect(page.getByRole('combobox',{name:'Financial basis',exact:true})).toHaveValue('unresolved');
 await page.getByLabel('Cash collected',{exact:true}).fill('620.00');
 await page.getByLabel('Tips included in receipts',{exact:true}).fill('');
 await page.getByRole('button',{name:'Read screenshots / retry'}).click();
 await expect(page.getByRole('button',{name:'Read screenshots / retry'})).toBeEnabled({timeout:90000});
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('620.00');await expect(page.getByLabel('Net earnings',{exact:true})).toHaveValue('');await expect(page.getByLabel('Tips included in receipts',{exact:true})).toHaveValue('');
 await page.getByRole('combobox',{name:'Financial basis',exact:true}).selectOption('already_net');await page.getByRole('button',{name:'Keep unfinished & close'}).click();await page.reload();await page.getByRole('button',{name:/Resume ride edit/}).first().click();await expect(page.getByLabel('Tips included in receipts',{exact:true})).toHaveValue('');await expect(page.getByRole('combobox',{name:'Financial basis',exact:true})).toHaveValue('already_net');
 expect(errors).toEqual([]);
});

test('OCR initialization failure is visible and retry recovers',async({page})=>{
 test.setTimeout(120000);const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/ocr/eng.traineddata.gz',route=>route.fulfill({status:503,body:'unavailable'}));
 const image=await sharp('tests/fixtures/synthetic-trip.svg').extend({bottom:4,background:'white'}).png().toBuffer();
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles({name:'retry-failure.png',mimeType:'image/png',buffer:image});await page.getByRole('button',{name:'Review this trip'}).last().click();
 await expect(page.getByRole('alert').filter({hasText:'Cannot read screenshot'})).toBeVisible({timeout:30000});
 await expect(page.getByRole('button',{name:'Read screenshots / retry'})).toBeEnabled();
 await page.unroute('**/ocr/eng.traineddata.gz');await page.getByRole('button',{name:'Read screenshots / retry'}).click();
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('500.00',{timeout:90000});expect(errors).toEqual([]);
});

test('Real supplied Uber JPEG is readable directly from review',async({page})=>{
 test.skip(!process.env.UBER_OCR_SAMPLE,'Private screenshot is supplied locally through UBER_OCR_SAMPLE.');test.setTimeout(120000);
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles(process.env.UBER_OCR_SAMPLE!);await page.getByRole('button',{name:'Review this trip'}).last().click();
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('596.24',{timeout:90000});await expect(page.getByLabel('Pickup time',{exact:true})).toHaveValue('11:58:00');await expect(page.getByLabel('Distance (km)',{exact:true})).toHaveValue('12.550');await expect(page.getByLabel('Duration (hh:mm:ss)',{exact:true})).toHaveValue('00:53:34');await expect(page.getByRole('combobox',{name:'Payment method',exact:true})).toHaveValue('Cash');await expect(page.getByLabel('Pickup location',{exact:true})).not.toHaveValue(/^\?/);await expect(page.getByLabel('Trip date',{exact:true})).toHaveValue('');await expect(page.getByLabel('Tips included in receipts',{exact:true})).toHaveValue('');await expect(page.getByRole('combobox',{name:'Financial basis',exact:true})).toHaveValue('unresolved');
});

test('Grouped screenshots are all read before filling fields; conflicting amounts remain blank',async({page})=>{
 test.setTimeout(120000);
 const a=await sharp('tests/fixtures/synthetic-trip.svg').extend({bottom:7,background:'white'}).png().toBuffer();
 const b=await sharp(a).extend({bottom:8,background:'white'}).png().toBuffer();
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles([{name:'conflict-a.png',mimeType:'image/png',buffer:a},{name:'conflict-b.png',mimeType:'image/png',buffer:b}]);
 await expect(page.getByLabel('Move conflict-b.png')).toBeVisible();
 const groups=await(await page.request.get(base+'/api/import')).json();const first=groups.find((g:any)=>g.items.some((i:any)=>i.attachment.source_name==='conflict-a.png'));const second=groups.find((g:any)=>g.items.some((i:any)=>i.attachment.source_name==='conflict-b.png'));const item=first.items[0];
 // Retain a previously completed observation to catch premature filling before the second image finishes.
 const job=await(await page.request.post(base+`/api/items/${item.id}/job`,{data:{action:'start'}})).json();await page.request.post(base+`/api/items/${item.id}/job`,{data:{action:'complete',token:job.token,result:{text:'Cash collected: BDT 700.00',confidence:99,blocks:[],tsv:''}}});
 await page.getByLabel('Move conflict-b.png').selectOption(first.id);await expect.poll(async()=>{const g=await(await page.request.get(base+'/api/import')).json();return g.find((x:any)=>x.id===first.id).items.length;}).toBe(2);
 await page.locator('.trip-group').filter({hasText:'conflict-a.png'}).getByRole('button',{name:'Review this trip',exact:true}).click();await expect(page.getByRole('button',{name:'Read screenshots / retry'})).toBeEnabled({timeout:90000});
 await expect(page.locator('.evidence-review summary').filter({hasText:'conflicting observations'})).toBeVisible();await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('');await expect(page.getByLabel('Net earnings',{exact:true})).toHaveValue('');
});

test('Supplied tipped screenshot maps cash payment, duration and cash-minus-tip net earnings',async({page})=>{
 test.skip(!process.env.UBER_OCR_TIP_SAMPLE,'Private tipped screenshot is supplied through UBER_OCR_TIP_SAMPLE.');test.setTimeout(120000);
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();await page.getByLabel('Choose screenshots',{exact:true}).setInputFiles(process.env.UBER_OCR_TIP_SAMPLE!);await page.getByRole('button',{name:'Review this trip'}).last().click();
 await expect(page.getByLabel('Cash collected',{exact:true})).toHaveValue('407.38',{timeout:90000});await expect(page.getByLabel('Tips included in receipts',{exact:true})).toHaveValue('40.00');await expect(page.getByLabel('Net earnings',{exact:true})).toHaveValue('367.38');await expect(page.getByRole('combobox',{name:'Payment method',exact:true})).toHaveValue('Cash');await expect(page.getByLabel('Duration (hh:mm:ss)',{exact:true})).toHaveValue('00:39:10');await expect(page.getByLabel('Pickup location',{exact:true})).not.toHaveValue(/^\?/);
 await page.getByLabel('Cash collected',{exact:true}).fill('500.00');await expect(page.getByLabel('Net earnings',{exact:true})).toHaveValue('460.00');await page.getByLabel('Duration (hh:mm:ss)',{exact:true}).fill('01:02:03');await page.getByRole('button',{name:'Save draft',exact:true}).click();await expect(page.getByText('Draft saved. It is excluded from income totals.',{exact:true})).toBeVisible();await expect(page.locator('tbody tr').filter({hasText:'460.00'})).toContainText('01:02:03');
 const data=await(await page.request.get(base+'/api/rides')).json();expect(data.rides.find((r:any)=>r.cash_collected_paisa===50000&&r.duration_seconds===3723).reported_net_paisa).toBe(46000);
});
