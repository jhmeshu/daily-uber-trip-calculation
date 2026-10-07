import{test}from'node:test';import assert from'node:assert/strict';import{existsSync,readFileSync}from'node:fs';import{zipSync,unzipSync,strToU8,strFromU8}from'fflate';import{ValidationError}from'../src/shared/domain.ts';import{inspectContainer,readSheets,sharedFormulaGroups,classifyFormulaGroups,typedLiterals,formulaAddresses,plainFormulas,MAX_WORKBOOK_BYTES}from'../server/workbook-container.ts';

const enc=strToU8;
function workbookXml(sheets:{name:string;rid:string}[],date1904=false){return `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${date1904?'<workbookPr date1904="1"/>':'<workbookPr/>'}<sheets>${sheets.map(s=>`<sheet name="${s.name}" sheetId="1" r:id="${s.rid}"/>`).join('')}</sheets></workbook>`;}
function relsXml(pairs:[string,string][]){return `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${pairs.map(([id,target])=>`<Relationship Id="${id}" Type="t" Target="${target}"/>`).join('')}</Relationships>`;}
// Released workbook files are personal data; the fixture is fully synthetic (A23 fixture rule).
function syntheticWorkbook(sheetXml:Record<string,string>,date1904=false){
  const names=Object.keys(sheetXml);
  const files:Record<string,Uint8Array>={'[Content_Types].xml':enc('<Types/>'),'_rels/.rels':enc('<Relationships/>'),'xl/workbook.xml':enc(workbookXml(names.map((n,i)=>({name:n,rid:`rId${i+1}`})),date1904)),'xl/_rels/workbook.xml.rels':enc(relsXml(names.map((n,i)=>[`rId${i+1}`,`worksheets/sheet${i+2}.xml`]))),'xl/sharedStrings.xml':enc('<sst><si><t>Hello &amp; welcome</t></si></sst>')};
  names.forEach((n,i)=>{files[`xl/worksheets/sheet${i+2}.xml`]=enc(sheetXml[n]!);});
  return Buffer.from(zipSync(files));
}
function sheetXmlFor(body:string){return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;}
const miniSheet=sheetXmlFor('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="N1"><v>5</v></c></row>');
const patchCentral=(buffer:Buffer,patch:(central:number)=>void)=>{let central=-1;for(let i=0;i<buffer.length-4;i++)if(buffer.readUInt32LE(i)===0x02014b50){central=i;break;}assert.notEqual(central,-1);patch(central);return buffer;};

test('A41: a workbook over 25 MB compressed is rejected before parsing',()=>{assert.throws(()=>inspectContainer(Buffer.alloc(MAX_WORKBOOK_BYTES+1)),ValidationError);});
test('A41: a workbook over 512 MB expanded is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});patchCentral(dangerous,c=>dangerous.writeUInt32LE(600000000,c+24));assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: more than 10 000 entries is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});const end=dangerous.length-22;dangerous.writeUInt16LE(20000,end+8);dangerous.writeUInt16LE(20000,end+10);assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: an encrypted entry is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});patchCentral(dangerous,c=>dangerous.writeUInt16LE(1,c+8));assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: a ZIP64-expanded entry is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});patchCentral(dangerous,c=>dangerous.writeUInt32LE(0xffffffff,c+24));assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: an unsupported compression method is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});patchCentral(dangerous,c=>dangerous.writeUInt16LE(99,c+10));assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: an absolute-path entry is rejected',()=>{const zip=Buffer.from(zipSync({'/evil.xml':enc('<x/>')}));assert.throws(()=>inspectContainer(zip),ValidationError);});
test('A41: a parent-directory segment is rejected',()=>{const zip=Buffer.from(zipSync({'../evil.xml':enc('<x/>')}));assert.throws(()=>inspectContainer(zip),ValidationError);});
test('A41: a directory entry is rejected',()=>{const zip=Buffer.from(zipSync({'xl/':enc('')}));assert.throws(()=>inspectContainer(zip),ValidationError);});
test('A41: a symlink entry is rejected',()=>{const dangerous=syntheticWorkbook({Tab:miniSheet});patchCentral(dangerous,c=>dangerous.writeUInt32LE(0xa0000000,c+38));assert.throws(()=>inspectContainer(dangerous),ValidationError);});
test('A41: more than 200 worksheets is rejected',()=>{const body=`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets>${Array.from({length:201},(_,i)=>`<sheet name="S${i}" sheetId="${i}"/>`).join('')}</sheets></workbook>`;const zip=Buffer.from(zipSync({'[Content_Types].xml':enc('<Types/>'),'xl/workbook.xml':enc(body)}));assert.throws(()=>inspectContainer(zip),ValidationError);});
test('A41: more than 200 000 non-empty cells is rejected',()=>{const body=`<row r="1">${Array.from({length:200001},()=>`<c r="A1"><v>1</v></c>`).join('')}</row>`;const zip=syntheticWorkbook({Tab:sheetXmlFor(body)});assert.throws(()=>inspectContainer(zip),ValidationError);});
test('A42: rejections are ValidationError with hand-written messages, never interpolating paths',()=>{
 for(const bad of[Buffer.from(zipSync({'/evil.xml':enc('<x/>')})),Buffer.from(zipSync({'../evil.xml':enc('<x/>')})),Buffer.from(zipSync({'xl/':enc('')}))]){
  try{inspectContainer(bad);assert.fail('should throw');}catch(error){assert.ok(error instanceof ValidationError);assert.ok(!(error as Error).message.includes('evil')&&!(error as Error).message.includes('/'));}}
});
test('a well-formed workbook passes the container inspection and reads sheets, models shared strings, and maps sheet order through rels',()=>{
 const zip=syntheticWorkbook({October:miniSheet,March:miniSheet});
 inspectContainer(zip);
 const data=readSheets(zip);
 assert.deepEqual(data.sheets.map(s=>s.name),['October','March']);
 assert.deepEqual(data.sharedStrings,['Hello & welcome']);
 assert.match(data.sheets[0]!.xml,/<row r="1">/);
});
test('A33: sharedFormulaGroups recovers the si/ref/master grouping and classifyFormulaGroups flags the row-mismatch master while leaving a self-row-correct group unflagged',()=>{
 const xml=sheetXmlFor(`<row r="3"><c r="K3"><f t="shared" ref="K3:K7" si="0">I2-J2</f><v>1</v></c></row><row r="2"><c r="D2"><f t="shared" ref="D2:D4" si="1">B2+C2</f><v>3</v></c><c r="D3"><f t="shared" si="1"/><v>4</v></c></row>`);
 const groups=sharedFormulaGroups(xml);
 assert.deepEqual(groups.map(g=>[g.masterAddress,g.si,g.ref,g.masterText]),[['K3','0','K3:K7','I2-J2'],['D2','1','D2:D4','B2+C2']]);
 const rows=classifyFormulaGroups(groups,'October-2026');
 assert.equal(rows.length,1);assert.equal(rows[0]!.kind,'row-mismatch');assert.equal(rows[0]!.sheet,'October-2026');assert.equal(rows[0]!.range,'K3:K7');assert.ok(rows[0]!.detail.includes('I2-J2'));
});
test('A34: a plain cross-tab carry-forward formula is classified (October P78 is plain, not shared)',()=>{
 const xml=sheetXmlFor(`<row r="78"><c r="P78"><f>'August-2026'!Q81</f><v>1</v></c></row>`);
 const plain=plainFormulas(xml);
 assert.deepEqual(plain,[{address:'P78',text:`'August-2026'!Q81`}]);
 const rows=classifyFormulaGroups([],'October-2026',{plainFormulas:plain});
 assert.equal(rows.length,1);assert.equal(rows[0]!.kind,'cross-tab-carry-forward');assert.ok(rows[0]!.detail.includes(`'August-2026'!Q81`));
});
test('A35: a plain embedded numeric literal and a typed literal where a sibling tab holds a formula are each classified',()=>{
 const plain=plainFormulas(sheetXmlFor(`<row r="55"><c r="O55"><f>734.81-654.82</f><v>79.99</v></c></row>`));
 const embedded=classifyFormulaGroups([],'August-2026',{plainFormulas:plain});
 assert.equal(embedded.length,1);assert.equal(embedded[0]!.kind,'embedded-numeric-literal');assert.equal(embedded[0]!.cell,'O55');
 const literals=typedLiterals(sheetXmlFor('<row r="80"><c r="Q80"><v>0</v></c></row>'));
 const siblings=new Map<string,Set<string>>([['Q80',new Set(['August-2026','October-2026'])]]);
 const typed=classifyFormulaGroups([],'August-2026',{typedLiterals:literals,siblingFormulas:siblings});
 assert.equal(typed.length,1);assert.equal(typed[0]!.kind,'typed-literal-where-sibling-has-formula');assert.equal(typed[0]!.cell,'Q80');
});
test('a 1904-date-system workbook is refused',()=>{const zip=syntheticWorkbook({Tab:miniSheet},true);assert.throws(()=>readSheets(zip),ValidationError);});
// Skip-guarded: runs against the owner's real workbook when present, passes silently otherwise. A33/A34/A35 verified against real data locally, not reproducible from repo alone.
test('A33/A34/A35 real-workbook walk: shared masters, plain cross-tab, embedded literal, typed literal',t=>{
 const path='.context/pm-cycles/pm-cycle-2026-10-08-00-52-03/sample-data/Uber Calculation 2026.xlsx';
 if(!existsSync(path)){t.skip('real workbook absent');return;}
 const zip=unzipSync(new Uint8Array(readFileSync(path)));
 const rels=strFromU8(zip['xl/_rels/workbook.xml.rels']!);
 const relMap=new Map([...rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m=>[m[1],m[2]]));
 const wbx=strFromU8(zip['xl/workbook.xml']!);
 const sheets=[...wbx.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(m=>({name:m[1],target:relMap.get(m[2])!}));
 const xmlOf=(s:{target:string})=>strFromU8(zip[`xl/${s.target}`]!);
 const siblingFormulas=new Map<string,Set<string>>();
 for(const s of sheets)for(const addr of formulaAddresses(xmlOf(s))){if(!siblingFormulas.has(addr))siblingFormulas.set(addr,new Set());siblingFormulas.get(addr)!.add(s.name);}
 const classify=(s:{name:string;target:string})=>classifyFormulaGroups(sharedFormulaGroups(xmlOf(s)),s.name,{typedLiterals:typedLiterals(xmlOf(s)),siblingFormulas,plainFormulas:plainFormulas(xmlOf(s))});
 const october=classify(sheets.find(s=>s.name==='October-2026')!);
 assert.deepEqual(october.filter(r=>r.kind==='row-mismatch').map(r=>r.range).sort(),['K3:K7','K9:K77']);
 assert.ok(october.some(r=>r.kind==='cross-tab-carry-forward'&&r.cell==='P78'&&r.detail.includes(`'August-2026'!Q81`)));
 const september=classify(sheets.find(s=>s.name==='September-2026')!);
 assert.equal(september.filter(r=>r.kind==='row-mismatch').length,0);
 assert.ok(september.some(r=>r.kind==='cross-tab-carry-forward'&&r.cell==='P78'));
 const august=classify(sheets.find(s=>s.name==='August-2026')!);
 assert.ok(august.some(r=>r.kind==='cross-tab-carry-forward'&&r.cell==='P77'));
 for(const cell of['O55','L60','L68'])assert.ok(august.some(r=>r.kind==='embedded-numeric-literal'&&r.cell===cell),cell);
 assert.ok(august.some(r=>r.kind==='typed-literal-where-sibling-has-formula'&&r.cell==='Q80'));
 const july=classify(sheets.find(s=>s.name==='July-2026')!);
 assert.ok(july.some(r=>r.kind==='cross-tab-carry-forward'&&r.cell==='O46'));
 const march=classify(sheets.find(s=>s.name==='March-2026')!);
 assert.equal(march.filter(r=>r.kind==='cross-tab-carry-forward'||r.kind==='embedded-numeric-literal').length,0);
 for(const s of sheets)for(const r of classify(s))assert.ok(!(r.kind==='row-mismatch'&&r.detail.includes('!')),'cross-tab never row-mismatch');
});
