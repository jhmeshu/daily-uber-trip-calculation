import { unzipSync, strFromU8 } from 'fflate';
import { ValidationError } from '../src/shared/domain.ts';
import { assertDateSystem } from '../src/shared/workbook.ts';
// Probe of exceljs@4.4.0 against the real workbook (2026-10-08, throwaway scripts):
// exceljs EXPANDS shared formulas in follower cells — October-2026!K10.formula reports "I9-J9"
// (master K9 = "I8-J8") and K77.formula reports "I76-J76" — and ws.model carries no sharedFormulas
// map, so the si/ref/master grouping needed for A33 is invisible through exceljs. The shared-formula
// reads below therefore use the raw xl/worksheets/sheetN.xml path via fflate, which recovers
// t="shared", si, ref and the master <f> text directly. Task 4 may still use exceljs for cell values.

// Only the compressed cap is enforced pre-buffering (binary() streams it at intake-routes.ts:7-11).
// Entry count, expanded bytes, worksheet count and non-empty-cell count live in the central
// directory and worksheet XML, so they are enforced post-buffer, pre-parse — the same ordering
// backup.ts uses. exceljs is never handed a buffer that can detonate.
export const MAX_WORKBOOK_BYTES=25_000_000,MAX_EXPANDED=512_000_000,MAX_ENTRIES=10_000,MAX_SHEETS=200,MAX_CELLS=200_000;

export function inspectContainer(buffer:Buffer):void{
  if(buffer.length>MAX_WORKBOOK_BYTES||buffer.length<22)throw new ValidationError('Workbook ZIP is empty, invalid or exceeds 25 MB.');
  let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
  if(end<0)throw new ValidationError('Invalid ZIP directory.');
  const count=buffer.readUInt16LE(end+10),offset=buffer.readUInt32LE(end+16),size=buffer.readUInt32LE(end+12);
  if(count<1||count>MAX_ENTRIES||buffer.readUInt16LE(end+4)!==0||buffer.readUInt16LE(end+6)!==0||buffer.readUInt16LE(end+8)!==count||offset+size!==end||end+22+buffer.readUInt16LE(end+20)!==buffer.length)throw new ValidationError('Unsupported multi-part, oversized or malformed ZIP.');
  let at=offset,total=0;const names=new Set<string>();
  for(let i=0;i<count;i++){
    if(at+46>end||buffer.readUInt32LE(at)!==0x02014b50)throw new ValidationError('Invalid ZIP entry.');
    const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),expanded=buffer.readUInt32LE(at+24),compressed=buffer.readUInt32LE(at+20),length=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42),externalAttrs=buffer.readUInt32LE(at+38);
    const name=buffer.subarray(at+46,at+46+length).toString('utf8');
    if(flags&1||![0,8].includes(method)||expanded===0xffffffff||compressed===0xffffffff||local>=offset||names.has(name))throw new ValidationError('ZIP contains unsafe, duplicate or unsupported entries.');
    // These four have no explicit check in backup.ts; its name allowlist blocks them only implicitly.
    // An XLSX allowlist would silently re-open all of them, so they are spelled out here.
    if(name.startsWith('/')||name.split('/').includes('..')||name.endsWith('/')||((externalAttrs>>>16)&0xf000)===0xa000)throw new ValidationError('ZIP contains unsafe, duplicate or unsupported entries.');
    if(local+30>offset||buffer.readUInt32LE(local)!==0x04034b50)throw new ValidationError('Invalid local ZIP header.');
    const localLength=buffer.readUInt16LE(local+26);if(buffer.subarray(local+30,local+30+localLength).toString('utf8')!==name)throw new ValidationError('ZIP entry names disagree.');
    names.add(name);total+=expanded;if(total>MAX_EXPANDED)throw new ValidationError('Workbook expands beyond allowed limits.');at+=46+length+extra+comment;
  }
  if(at!==end)throw new ValidationError('Malformed ZIP directory.');
  // Worksheet and cell counts are only knowable from the XML, so this is a pre-parse cap: the buffer
  // is decompressed and counted, never parsed into a model. Over-count cannot occur: a ZIP bomb
  // already fails the expanded-bytes check above.
  const parts=unzipSync(buffer,{filter:f=>/^xl\/(?:workbook\.xml|worksheets\/.*\.xml)$/.test(f.name)});
  const workbookXml=parts['xl/workbook.xml'];if(!workbookXml)throw new ValidationError('Invalid workbook archive.');
  const sheets=(strFromU8(workbookXml).match(/<sheet\b/g)||[]).length;
  if(sheets===0||sheets>MAX_SHEETS)throw new ValidationError('Workbook has too many worksheets.');
  let cells=0;for(const[name,data]of Object.entries(parts)){if(!name.startsWith('xl/worksheets/'))continue;const xml=strFromU8(data);const opened=xml.match(/<c\s/g)||[];const closed=xml.match(/<c\s[^>]*\/>/g)||[];cells+=opened.length-closed.length;if(cells>MAX_CELLS)throw new ValidationError('Workbook has too many cells.');}
}

const XML_ENTITIES:Record<string,string>={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};
const decodeXml=(value:string)=>value.replace(/&(?:amp|lt|gt|quot|apos);/g,m=>XML_ENTITIES[m]!);
function relsTargets(relsXml:string):Map<string,string>{
  const map=new Map<string,string>();
  for(const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)){
    const id=/Id="([^"]+)"/.exec(match[0])?.[1],target=/Target="([^"]+)"/.exec(match[0])?.[1];
    if(id&&target)map.set(id,target);
  }
  return map;
}

export type SheetData={name:string;xml:string};
export type WorkbookData={workbookXml:string;sheets:SheetData[];sharedStrings:string[]};
export function readSheets(buffer:Buffer):WorkbookData{
  inspectContainer(buffer);
  const zip=unzipSync(buffer);
  const workbookXml=zip['xl/workbook.xml'];if(!workbookXml)throw new ValidationError('Invalid workbook archive.');
  const workbookText=strFromU8(workbookXml);
  assertDateSystem(workbookText);
  const relsText=zip['xl/_rels/workbook.xml.rels'];if(!relsText)throw new ValidationError('Invalid workbook archive.');
  const targets=relsTargets(strFromU8(relsText));
  const sheets:SheetData[]=[];
  for(const match of workbookText.matchAll(/<sheet\b[^>]*>/g)){
    const name=/name="([^"]*)"/.exec(match[0])?.[1],rid=/r:id="([^"]+)"/.exec(match[0])?.[1];
    if(!name||!rid)throw new ValidationError('Invalid workbook archive.');
    const target=targets.get(rid);if(!target)throw new ValidationError('Invalid workbook archive.');
    const path=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:`xl/${target}`;
    const data=zip[path];if(!data)throw new ValidationError('Invalid workbook archive.');
    sheets.push({name:decodeXml(name),xml:strFromU8(data)});
  }
  if(sheets.length===0)throw new ValidationError('Invalid workbook archive.');
  const shared:string[]=[];
  const sharedXml=zip['xl/sharedStrings.xml'];
  if(sharedXml)for(const si of strFromU8(sharedXml).matchAll(/<si>([\s\S]*?)<\/si>/g)){shared.push([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(t=>decodeXml(t[1])).join(''));}
  return{workbookXml:workbookText,sheets,sharedStrings:shared};
}

export type SharedFormulaGroup={masterAddress:string;si:string;ref:string|null;masterText:string};
export function sharedFormulaGroups(sheetXml:string):SharedFormulaGroup[]{
  // Masters carry t="shared" with si + a <f> body; followers are self-closing <f t="shared" si="n"/>.
  const groups:SharedFormulaGroup[]=[];
  for(const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const inner=match[2]??'';const f=/<f t="shared"([^>]*)>([^<]*)<\/f>/.exec(inner);if(!f)continue;
    const si=/si="(\d+)"/.exec(f[1])?.[1];if(si===undefined)continue;
    groups.push({masterAddress:match[1],si,ref:/ref="([^"]+)"/.exec(f[1])?.[1]??null,masterText:f[2]});
  }
  return groups;
}

const cellRefRow=(address:string)=>Number(/(\d+)$/.exec(address)?.[1]);
export type FormulaKind='row-mismatch'|'cross-tab-carry-forward'|'embedded-numeric-literal'|'typed-literal-where-sibling-has-formula';
export type FormulaClassification={sheet:string;cell:string;range:string|null;kind:FormulaKind;detail:string};
// typedLiterals: this sheet's address → raw literal for cells with no <f>. siblingFormulas: address →
// sheet names carrying ANY formula (plain, shared follower, or array) at that address, built across ALL
// sheets — this is what lets August!Q80 surface as a typed literal next to October/September's formula.
// plainFormulas: this sheet's non-shared <f> cells — the A34/A35 carriers the probe found are plain,
// not shared masters, so the shared-group scan alone never classifies them.
export type PlainFormula={address:string;text:string};
export type FormulaContext={typedLiterals?:ReadonlyMap<string,string>;siblingFormulas?:ReadonlyMap<string,ReadonlySet<string>>;plainFormulas?:ReadonlyArray<PlainFormula>};
export function classifyFormulaGroups(groups:SharedFormulaGroup[],sheetName:string,context?:FormulaContext):FormulaClassification[]{
  const rows:FormulaClassification[]=[];
  for(const group of groups){
    const ownRow=cellRefRow(group.masterAddress);
    const crossTab=/(?:^|[^A-Za-z0-9_])'?[^'!"]+'?!/.test(group.masterText);
    const referenced=[...group.masterText.matchAll(/\$?[A-Z]{1,3}\$?(\d+)/g)].map(m=>Number(m[1]));
    // A cross-tab carry-forward references another tab's row by design, so its row difference is A34, not a defect.
    if(!crossTab&&referenced.length>0&&referenced.some(row=>row!==ownRow))rows.push({sheet:sheetName,cell:group.masterAddress,range:group.ref,kind:'row-mismatch',detail:`Master ${group.masterAddress} references row ${referenced.join(',')} but sits on row ${ownRow}: "${group.masterText}"`});
    if(crossTab)rows.push({sheet:sheetName,cell:group.masterAddress,range:group.ref,kind:'cross-tab-carry-forward',detail:`"${group.masterText}"`});
    if(/\d/.test(group.masterText.replace(/'[^']*'!/g,'').replace(/\b[A-Za-z_][A-Za-z0-9_.]*\s*\(/g,'').replace(/\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+/g,'').replace(/\$?[A-Z]{1,3}\$?\d+/g,'').replace(/[+\-*/^():\s]/g,'')))rows.push({sheet:sheetName,cell:group.masterAddress,range:group.ref,kind:'embedded-numeric-literal',detail:`"${group.masterText}"`});
  }
  if(context?.typedLiterals&&context?.siblingFormulas)for(const[address,literal]of context.typedLiterals){const carriers=context.siblingFormulas.get(address);if(carriers&&carriers.size>0)rows.push({sheet:sheetName,cell:address,range:null,kind:'typed-literal-where-sibling-has-formula',detail:`"${literal}" typed where ${[...carriers].join(', ')} carries a formula`});}
  for(const plain of context?.plainFormulas??[]){
    if(/(?:^|[^A-Za-z0-9_])'?[^'!"]+'?!/.test(plain.text))rows.push({sheet:sheetName,cell:plain.address,range:null,kind:'cross-tab-carry-forward',detail:`"${plain.text}"`});
    if(/\d/.test(plain.text.replace(/'[^']*'!/g,'').replace(/\b[A-Za-z_][A-Za-z0-9_.]*\s*\(/g,'').replace(/\$?[A-Z]{1,3}\$?\d+:\$?[A-Z]{1,3}\$?\d+/g,'').replace(/\$?[A-Z]{1,3}\$?\d+/g,'').replace(/[+\-*/^():\s]/g,'')))rows.push({sheet:sheetName,cell:plain.address,range:null,kind:'embedded-numeric-literal',detail:`"${plain.text}"`});
  }
  return rows;
}

// A34/A35's real-workbook carriers are plain <f> cells (no t="shared"), which sharedFormulaGroups()
// never yields. Every non-shared formula cell is returned; the classifier decides which kind it is.
export function plainFormulas(sheetXml:string):PlainFormula[]{
  const plain:PlainFormula[]=[];
  for(const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const inner=match[2]??'';if(!/<f[\s>]/.test(inner)||/<f t="shared"/.test(inner))continue;
    const f=/<f[^>]*>([\s\S]*?)<\/f>/.exec(inner);if(!f)continue;
    plain.push({address:match[1],text:f[1]});
  }
  return plain;
}

// Helpers for the A35 typed-literal context: raw literal per address (cells with <v> and no <f>),
// and formula addresses per sheet, both read as text — never evaluated (invariant 7).
export function typedLiterals(sheetXml:string):Map<string,string>{
  const literals=new Map<string,string>();
  for(const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g)){
    const inner=match[2]??'';if(/<f[\s>]/.test(inner))continue;
    const value=/<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];if(value!==undefined)literals.set(match[1],value);
  }
  return literals;
}
export function formulaAddresses(sheetXml:string):Set<string>{
  const addresses=new Set<string>();
  for(const match of sheetXml.matchAll(/<c r="([A-Z]+\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/c>)/g))if(/<f[\s>]/.test(match[2]??''))addresses.add(match[1]);
  return addresses;
}
