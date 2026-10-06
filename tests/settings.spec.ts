import{test,expect}from'@playwright/test';import{mkdtempSync,rmSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{Store}from'../server/store.ts';import{createApp}from'../server/app.ts';import{blankRide}from'../src/shared/domain.ts';
let directory:string;let store:Store;let server:ReturnType<typeof createApp>;let base:string;
test.beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),'uber-settings-browser-'));store=new Store(directory);store.save({...blankRide(),trip_date:'2026-10-06',pickup_time:'09:30:00',financial_basis:'worksheet_cash_plus_credit',cash_collected_paisa:50000,uber_credit_paisa:0,tips_paisa:4000,commission_paisa:5000,pass_charge_paisa:0,financial_confirmed:true},'reviewed');server=createApp(store);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${(server.address()as{port:number}).port}`;});
test.afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(directory,{recursive:true,force:true});});
test('M4 dashboard, timezone stability and confirmed complete backup restoration',async({page})=>{
 await page.goto(base);await page.getByRole('button',{name:'Dashboard',exact:true}).click();await page.getByLabel('Dashboard month').fill('2026-10');await expect(page.getByText('BDT 410.00',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Settings & backup',exact:true}).click();await page.getByLabel('Default timezone for new rides').fill('Europe/London');await page.getByRole('button',{name:'Save timezone'}).click();await expect(page.getByText('Default timezone saved. Existing local trip dates are unchanged.')).toBeVisible();
 const response=await page.request.get(base+'/api/backup');const archive=await response.body();expect(response.headers()['content-type']).toBe('application/zip');
 await page.request.post(base+'/api/rides',{data:{input:blankRide(),status:'draft',session_id:null}});
 await page.getByLabel('Backup ZIP',{exact:true}).setInputFiles({name:'backup.zip',mimeType:'application/zip',buffer:archive});await expect(page.getByRole('heading',{name:'Validated restore preview'})).toBeVisible();
 page.on('dialog',d=>d.accept());await page.getByRole('button',{name:'Confirm replacement & restore'}).click();await expect(page.getByRole('heading',{name:'Ride ledger'})).toBeVisible();
 expect((await(await page.request.get(base+'/api/rides')).json()).rides.length).toBe(1);expect((await(await page.request.get(base+'/api/settings')).json()).timezone).toBe('Europe/London');
 await page.getByRole('button',{name:'+ Add ride'}).click();await expect(page.getByLabel('Trip timezone',{exact:true})).toHaveValue('Europe/London');
});
