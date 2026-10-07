import{test,expect}from'@playwright/test';import{mkdtempSync,rmSync,readFileSync,readdirSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{zipSync,strToU8}from'fflate';import{randomUUID}from'node:crypto';import{Store}from'../server/store.ts';import{createApp}from'../server/app.ts';import{csvHeaders}from'../src/shared/csv.ts';
let directory:string;let store:Store;let server:ReturnType<typeof createApp>;let base:string;let port:number;
type V=string|number|boolean|null|undefined;const L=['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
const row=(cells:Record<string,V>):V[]=>{const out:V[]=Array(20).fill(null);for(const [c,v] of Object.entries(cells))out[L.indexOf(c)]=v;return out;};
const enc=strToU8;
const HEAD_A=row({B:'SL',C:'Trip Date',D:'Pick time',E:'Duration',F:'Pick from',G:'Drop at',H:'Distance',I:'Cash Collect',J:'Tips',K:'Fare(-tip)',L:'User promo or uber credit (Uber Pay us)',M:'Uber Mode',N:'Payment Method',O:'Uber Comission / Pass (We pay uber)',P:'Net income per ride',Q:'Net income in October',R:'Screenshot',S:'Commeent'});
const HEAD_B=row({B:'SL',C:'Trip Date',D:'Pick time',E:'Duration',F:'Pick from',G:'Drop at',H:'Distance',I:'Cash Collect',J:'Tips',K:'Fare(-tip)',L:'Uber Mode',M:'Payment Method',N:'Uber Comission',O:'Net income',P:'Total',Q:'Screenshot',R:'Commeent'});
const HEAD_C=row({B:'SL',C:'Trip Date',D:'Pick time',E:'Duration',F:'Pick from',G:'Drop at',H:'Distance',I:'Fare',J:'Payment Method',K:'Uber Comission',L:'Net income',M:'Total Income in March'});
function sheetXml(rows:V[][]):string{const body=rows.map((cells,i)=>`<row r="${i+1}">${cells.map((v,j)=>{const ref=`${L[j]}${i+1}`;if(v===null||v===undefined)return '';if(typeof v==='number')return `<c r="${ref}"><v>${v}</v></c>`;if(typeof v==='boolean')return `<c r="${ref}" t="b"><v>${v?1:0}</v></c>`;return `<c r="${ref}" t="inlineStr"><is><t>${String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;')}</t></is></c>`;}).join('')}</row>`).join('');return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;}
function workbook(sheets:Record<string,string>):Buffer{const names=Object.keys(sheets);const files:Record<string,Uint8Array>={'[Content_Types].xml':enc('<Types/>'),'_rels/.rels':enc('<Relationships/>'),'xl/workbook.xml':enc(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>${names.map((n,i)=>`<sheet name="${n}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`),'xl/_rels/workbook.xml.rels':enc(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n,i)=>`<Relationship Id="rId${i+1}" Type="t" Target="worksheets/sheet${i+2}.xml"/>`).join('')}</Relationships>`)};names.forEach((n,i)=>{files[`xl/worksheets/sheet${i+2}.xml`]=enc(sheets[n]!);});return Buffer.from(zipSync(files));}
function fixture():Buffer{
 const first=row({B:1,C:46325,D:0.5,E:3214/86400,F:'Tejgaon, Dhaka',G:'DIT Rd, Dhaka',H:'12.68km',I:1000,J:0,K:1000,L:0,M:'Uber X',N:'bKash',O:0,P:1000,S:'gate'});
 const second=row({B:2,C:46326,D:0.6,E:1800/86400,F:'Sector 10, Uttara',G:'Banani, Dhaka',H:'5.5km',I:500,J:1,K:499,L:0,M:'Uber X',N:'Cash',O:0,P:499.01});
 const july=row({B:4,C:46204,D:0.75,E:2350/86400,F:'Mirpur 10',G:'Farmgate',H:'5.5km',I:596.24,J:40,K:556.24,L:'Uber X',M:'Cash',N:0,O:556.24,R:'ok'});
 const march=row({B:1,C:46084,D:0.25,E:1800/86400,F:'Dhaka 1215',G:'Dhaka 1000',H:'9.10km',I:320.5,J:'Cash',K:12.5,L:308});
 const oct=sheetXml([HEAD_A,first,second])
  .replace('<c r="K3"><v>499</v></c>','<c r="K3"><f t="shared" ref="K3:K7" si="0">I2-J2</f><v>499</v></c>')
  .replace('</sheetData>',`<row r="9"><c r="K9"><f t="shared" ref="K9:K77" si="1">I9-J9</f><v>1</v></c></row><row r="55"><c r="O55"><f>734.81-654.82</f><v>79.99</v></c></row><row r="78"><c r="P78"><f>'July-2026'!R81</f><v>1</v></c></row><row r="80"><c r="Q80"><f>I80-J80</f><v>1</v></c></row></sheetData>`);
 const jul=sheetXml([HEAD_B,july]).replace('</sheetData>','<row r="80"><c r="Q80"><v>0</v></c></row></sheetData>');
 return workbook({'October-2026':oct,'July-2026':jul,'March-2026':sheetXml([row({A:'March-2026'}),HEAD_C,march])});
}
test.beforeAll(async()=>{directory=mkdtempSync(join(tmpdir(),'uber-workbook-'));store=new Store(directory);server=createApp(store);await new Promise<void>(r=>server.listen(port??0,'127.0.0.1',r));port=(server.address()as{port:number}).port;base=`http://127.0.0.1:${port}`;});
test.afterAll(async()=>{await new Promise<void>(r=>server.close(()=>r()));store.close();rmSync(directory,{recursive:true,force:true});});
test('M-A23 historical workbook import preview → review → CSVs → backup/restore offline',async({page,context})=>{
 test.setTimeout(120000);const external:string[]=[],requested:string[]=[],errors:string[]=[];
 await context.route('**/*',route=>{const url=route.request().url();requested.push(url);if(!url.startsWith(base)){external.push(url);return route.abort();}return route.continue();});page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base);await page.getByRole('button',{name:'Import',exact:true}).click();
 const buffer=fixture();await page.getByLabel('Choose historical workbook',{exact:true}).setInputFiles({name:'synthetic-2026.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer});
 await expect(page.getByRole('table',{name:'Workbook import preview'})).toBeVisible();await expect(page.getByText('Preview ready. Nothing has been written yet.',{exact:true})).toBeVisible();
 await expect(page.getByText('Layout A').first()).toBeVisible();await expect(page.getByText('Layout B').first()).toBeVisible();await expect(page.getByText('Layout C').first()).toBeVisible();
 await expect(page.getByText('Amounts differ')).toBeVisible();await expect(page.getByText('Amounts match')).toBeVisible();await expect(page.getByText('Not comparable')).toBeVisible();
 await expect(page.locator('.badge').getByText('variance',{exact:true}).first()).toBeVisible();await expect(page.locator('.badge').getByText('match',{exact:true}).first()).toBeVisible();await expect(page.locator('.badge').getByText('not_comparable',{exact:true}).first()).toBeVisible();
 await expect(page.getByText('Formula points at the wrong row').first()).toBeVisible();await expect(page.getByText('Formula carries a value from another tab').first()).toBeVisible();await expect(page.getByText('Formula contains a typed number').first()).toBeVisible();await expect(page.getByText('A typed value where a sibling tab carries a formula').first()).toBeVisible();
 await expect(page.locator('.badge').getByText('imported',{exact:true}).first()).toBeVisible();await expect(page.locator('.badge').getByText('needs field',{exact:true}).first()).toBeVisible();
 await page.getByLabel('Choose historical workbook',{exact:true}).focus();expect(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label'))).toBe('Choose historical workbook');
 await page.getByRole('button',{name:'Import workbook as drafts'}).focus();await page.keyboard.press('Enter');
 await expect(page.getByText('Imported 4 draft rides.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Rides',exact:true}).click();
 await page.getByLabel('Search locations or comments').fill('Mirpur');await expect(page.getByRole('button',{name:'Edit',exact:true})).toHaveCount(1);await page.getByRole('button',{name:'Edit',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Edit ride'})).toBeVisible();await expect(page.getByText('Missing financial fields',{exact:true})).toBeVisible();await expect(page.getByRole('listitem').filter({hasText:'Uber credit'})).toBeVisible();await expect(page.getByLabel('Uber credit',{exact:true})).toHaveValue('');await expect(page.getByRole('button',{name:'Save reviewed'})).toBeDisabled();
 await page.getByRole('button',{name:'Discard edits'}).click();
 await page.getByLabel('Search locations or comments').fill('Sector 10');await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByLabel('Per-ride pass charge',{exact:true}).fill('0');
 await page.getByLabel('Financial basis').selectOption('worksheet_cash_plus_credit');await page.getByRole('checkbox',{name:/I reviewed all five/}).check();await page.getByRole('button',{name:'Save reviewed'}).click();await expect(page.getByText('Reviewed ride saved.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Dashboard',exact:true}).click();await expect(page.getByRole('heading',{name:'Monthly dashboard'})).toBeVisible();
 const exportText=await(await page.request.get(base+'/api/export?scope=all&include_drafts=true')).text();expect(exportText.startsWith('\uFEFF'+csvHeaders.join(',')+'\r\n')).toBe(true);
 const report=await(await page.request.get(base+'/api/import/workbook/report')).json();const sourceId=report.source.id as string;
 store.db.prepare('INSERT INTO import_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),sourceId,'October-2026','K9','net_income','=I2-J2','=I2-J2',1268,0,'variance','carried across rows',new Date().toISOString());
 const variance=await(await page.request.get(base+`/api/import/workbook/variance.csv?source_id=${sourceId}`)).body();
 expect([...variance.subarray(0,3)]).toEqual([0xEF,0xBB,0xBF]);const varianceText=variance.subarray(3).toString('utf8');
 expect(varianceText.split('\r\n')[0]).toBe('source_sha256,sheet_name,location,metric,workbook_reported,workbook_formula,app_value_bdt,difference_bdt,verdict,note');expect(varianceText).toContain("'=I2-J2");
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.setViewportSize({width:1440,height:1000});
 const archive=await(await page.request.get(base+'/api/backup')).body();
 await page.getByRole('button',{name:'Settings & backup',exact:true}).click();await page.getByLabel('Backup ZIP',{exact:true}).setInputFiles({name:'workbook-backup.zip',mimeType:'application/zip',buffer:archive});
 await expect(page.getByRole('heading',{name:'Validated restore preview'})).toBeVisible();await page.getByRole('button',{name:'Confirm replacement & restore'}).click();await expect(page.getByRole('heading',{name:'Ride ledger'})).toBeVisible();
 expect((await(await page.request.get(base+'/api/rides')).json()).rides.length).toBe(4);
 const assetsDir=join(process.cwd(),'dist','assets');for(const file of readdirSync(assetsDir))if(file.endsWith('.js'))expect(readFileSync(join(assetsDir,file),'utf8')).not.toContain('exceljs');
 expect(requested.some(url=>url.includes('exceljs'))).toBe(false);expect(external).toEqual([]);expect(errors).toEqual([]);
});
