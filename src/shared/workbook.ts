import { blankRide, cleanLocation, decimal, financialFields, parseDecimal, parseDuration, paymentMethods, serviceTypes, ValidationError, validDate, type MoneyField, type RideInput } from './domain.ts';
import { normalize } from './parser.ts';
import { cell } from './csv.ts';
// A workbook row is not an OCR observation, so it carries its own version stamp. Reusing PARSER_VERSION would
// mislabel workbook-derived rows as OCR evidence in field_observations.
export const WORKBOOK_PARSER_VERSION='1.0.0-workbook';
export type CellValue=string|number|boolean|null|undefined;
export type SheetRow=readonly CellValue[];
export const layoutNames=['A','B','C','unrecognised'] as const;
export type LayoutName=typeof layoutNames[number];
export const mappedFields=['trip_date','pickup_time','duration_seconds','pickup_location','drop_location','distance_meters','cash_collected_paisa','uber_credit_paisa','tips_paisa','commission_paisa','pass_charge_paisa','payment_method','service_type','reported_net_paisa','comments'] as const;
export type MappedField=typeof mappedFields[number];
export type WorkbookLayout={headerRow:number}&{[K in MappedField]:string|null};
// A null column letter means the tab has no such column at all. The value stays unknown; it is never read as zero (invariant 1).
export const LAYOUT_A={headerRow:1,trip_date:'C',pickup_time:'D',duration_seconds:'E',pickup_location:'F',drop_location:'G',distance_meters:'H',cash_collected_paisa:'I',tips_paisa:'J',uber_credit_paisa:'L',service_type:'M',payment_method:'N',commission_paisa:'O',reported_net_paisa:'P',comments:'S',pass_charge_paisa:null} as const;
export const LAYOUT_B={headerRow:1,trip_date:'C',pickup_time:'D',duration_seconds:'E',pickup_location:'F',drop_location:'G',distance_meters:'H',cash_collected_paisa:'I',tips_paisa:'J',uber_credit_paisa:null,service_type:'L',payment_method:'M',commission_paisa:'N',reported_net_paisa:'O',comments:'R',pass_charge_paisa:null} as const;
// March carries a single Fare column that cannot be split into cash and credit, and no service column at all.
export const LAYOUT_C={headerRow:2,trip_date:'C',pickup_time:'D',duration_seconds:'E',pickup_location:'F',drop_location:'G',distance_meters:'H',cash_collected_paisa:null,tips_paisa:null,uber_credit_paisa:null,service_type:null,payment_method:'J',commission_paisa:'K',reported_net_paisa:'L',comments:null,pass_charge_paisa:null} as const;
export const layouts:Record<'A'|'B'|'C',WorkbookLayout>={A:LAYOUT_A,B:LAYOUT_B,C:LAYOUT_C};

export function columnIndex(column:string):number{
  let index=0;for(const character of column.toUpperCase())index=index*26+(character.charCodeAt(0)-64);return index-1;
}
export const cellAt=(cells:SheetRow,column:string|null):CellValue=>column===null?null:(cells[columnIndex(column)]??null);

// 25569 days separate 1899-12-30 from 1970-01-01. Serials below 61 count from 1899-12-31 because of the phantom
// 1900-02-29 Excel invented, so the epoch steps once at serial 61.
const EXCEL_EPOCH=25569;
const pad=(value:number,width=2)=>String(value).padStart(width,'0');
// Hinnant's civil-from-days: pure integer arithmetic, no Date and no timezone, so a serial can never shift a day.
function civilFromDays(days:number):[number,number,number]{
  const shifted=days+719468;const era=Math.floor(shifted/146097);const dayOfEra=shifted-era*146097;
  const yearOfEra=Math.floor((dayOfEra-Math.floor(dayOfEra/1460)+Math.floor(dayOfEra/36524)-Math.floor(dayOfEra/146096))/365);
  const dayOfYear=dayOfEra-(365*yearOfEra+Math.floor(yearOfEra/4)-Math.floor(yearOfEra/100));const monthPrime=Math.floor((5*dayOfYear+2)/153);
  return [yearOfEra+era*400+(monthPrime<10?0:1),monthPrime+(monthPrime<10?3:-9),dayOfYear-Math.floor((153*monthPrime+2)/5)+1];
}
export function serialToLocalDate(serial:number):string|null{
  if(!Number.isFinite(serial)||serial<1)return null;
  const whole=Math.floor(serial);
  if(whole===60)return null;
  const [year,month,day]=civilFromDays(whole-(whole>=61?EXCEL_EPOCH:EXCEL_EPOCH-1));
  if(year<1900||year>9999)return null;
  return `${pad(year,4)}-${pad(month)}-${pad(day)}`;
}
export function serialToLocalTime(serial:number):string|null{
  if(!Number.isFinite(serial)||serial<0)return null;
  const seconds=Math.min(Math.round((serial-Math.floor(serial))*86400),86399);
  return `${pad(Math.floor(seconds/3600))}:${pad(Math.floor(seconds%3600/60))}:${pad(seconds%60)}`;
}
export function serialToDurationSeconds(serial:number):number|null{
  if(!Number.isFinite(serial)||serial<0)return null;
  const days=Math.floor(serial);const seconds=days*86400+Math.round((serial-days)*86400);
  return Number.isSafeInteger(seconds)&&seconds<=1_000_000_000_000?seconds:null;
}

export function usesDate1904(workbookXml:string):boolean{
  return /<workbookPr\b[^>]*\bdate1904\s*=\s*"(?:1|true)"/i.test(workbookXml);
}
export function assertDateSystem(workbookXml:string):void{
  if(usesDate1904(workbookXml))throw new ValidationError('This workbook uses the 1904 date system, which this import does not read. Re-save it using the 1900 date system.');
}

export const cellKinds=['distance','money','seconds','text','payment','service'] as const;
export type CellKind=typeof cellKinds[number];
// Placeholders the workbook actually uses, plus the usual spreadsheet stand-ins. A negative amount is not a placeholder.
const placeholders=/^(?:-+|—+|–+|a\/a|n\/?a|#n\/a|na|nil|null|none|undefined|tbd|\?+)$/i;
const isPlaceholder=(value:string)=>placeholders.test(value);
export function mapCell(raw:CellValue,kind:'distance'|'money'|'seconds'):number|null;
export function mapCell(raw:CellValue,kind:'text'):string|null;
export function mapCell(raw:CellValue,kind:'payment'):typeof paymentMethods[number]|null;
export function mapCell(raw:CellValue,kind:'service'):typeof serviceTypes[number]|null;
// A caller that dispatches on a CellKind held in a variable gets the union back.
export function mapCell(raw:CellValue,kind:CellKind):number|string|null;
export function mapCell(raw:CellValue,kind:CellKind):number|string|null{
  // A blank or non-scalar cell is unknown. It is never 0: validateInput accepts 0 as readily as null, so a 0 here is undetectable downstream.
  if(raw===null||raw===undefined||typeof raw==='boolean')return null;
  if(kind==='seconds')return typeof raw==='number'?serialToDurationSeconds(raw):secondsFromText(raw);
  if(kind==='text'||kind==='payment'||kind==='service')return textCell(raw,kind);
  // Amounts in this workbook are plain numbers with no group separator, so none is invented here.
  const value=(typeof raw==='number'?String(raw):raw).trim();
  if(isPlaceholder(value))return null;
  const stripped=kind==='distance'?value.replace(/\s*km\s*$/i,''):value;
  try {
    const parsed=parseDecimal(stripped,kind==='distance'?3:2);
    // distance_meters and duration_seconds may never be negative, so such a cell is unknown rather than a rejected value.
    return kind!=='money'&&parsed!==null&&parsed<0?null:parsed;
  } catch { return null; }
}
function textCell(raw:CellValue,kind:'text'|'payment'|'service'):string|null{
  const value=normalize(typeof raw==='string'||typeof raw==='number'?String(raw):'').trim();
  if(!value||isPlaceholder(value))return null;
  if(kind==='payment'){const word=value.replace(/[^\p{L}]/gu,'').toLowerCase();if(word==='cash')return 'Cash';if(word==='bkash')return 'bKash';if(word==='other')return 'Other';return null;}
  if(kind==='service'){if(/\buber\s*x\b/i.test(value))return 'Uber X';if(/\buber\s*premium\b/i.test(value))return 'Uber Premium';if(/\buber\s*premier\b/i.test(value))return 'Other';return null;}
  return value;
}
function secondsFromText(raw:string):number|null{
  const value=raw.trim();
  if(isPlaceholder(value))return null;
  // '99:99.99' and prose never match, so a bad duration stays unknown rather than being clamped.
  const match=value.match(/^(\d+):([0-5]\d)(?::([0-5]\d))?$/);
  if(!match)return null;
  try { return parseDuration(`${pad(Number(match[1]))}:${match[2]}:${match[3]??'00'}`); } catch { return null; }
}
const locationCell=(raw:CellValue):string|null=>{const text=mapCell(raw,'text');return text===null?null:cleanLocation(text);};
function tripDateCell(raw:CellValue):string|null{
  if(typeof raw==='number')return serialToLocalDate(raw);
  if(typeof raw!=='string')return null;
  // Text dates are accepted only in the app's own form; a note or a locale date stays unknown rather than being read at.
  const value=normalize(raw).trim();
  return validDate(value)?value:null;
}
function timeCell(raw:CellValue):string|null{
  if(typeof raw==='number')return serialToLocalTime(raw);
  if(typeof raw!=='string')return null;
  const value=normalize(raw).trim();
  if(isPlaceholder(value))return null;
  const match=value.match(/^(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*([ap]\.?m\.?)?$/i);
  if(!match)return null;
  // An explicit meridiem is arithmetic rather than a guess, and the missing seconds group is padded like parser.ts does.
  const hour=match[4]?Number(match[1])%12+(/^p/i.test(match[4])?12:0):Number(match[1]);
  if(hour>23)return null;
  return `${pad(hour)}:${match[2]}:${match[3]??'00'}`;
}

const headerText=(cell:CellValue)=>normalize(typeof cell==='string'?cell:'').toLowerCase().replace(/\s+/g,' ').trim();
const headerHas=(cells:SheetRow,pattern:RegExp)=>cells.some(cell=>pattern.test(headerText(cell)));
const ledgerHeader=(cells:SheetRow)=>headerHas(cells,/\btrip date\b/)&&(headerHas(cells,/\bpick from\b/)||headerHas(cells,/\bdrop at\b/)||headerHas(cells,/\bdistance\b/));
function classifyHeader(cells:SheetRow):LayoutName{
  if(!ledgerHeader(cells))return 'unrecognised';
  // A bare Fare column with no cash, tips or credit column cannot be split, so it marks Layout C.
  if(headerHas(cells,/^fare$/)&&!headerHas(cells,/cash|tip|promo|credit/))return 'C';
  if(headerHas(cells,/promo|uber credit|uber pay us/))return 'A';
  if(headerHas(cells,/uber mode/))return 'B';
  return 'unrecognised';
}
export type DetectedLayout={layout:LayoutName;headerRow:number};
export function detectLayout(rows:readonly SheetRow[]):DetectedLayout{
  for(const excelRow of [1,2] as const){
    const layout=classifyHeader(rows[excelRow-1]??[]);
    if(layout!=='unrecognised')return {layout,headerRow:excelRow};
  }
  return {layout:'unrecognised',headerRow:0};
}

export function isRideRow(cells:SheetRow,layout:WorkbookLayout):boolean{
  if(tripDateCell(cellAt(cells,layout.trip_date))===null)return false;
  // SL is populated to row 77 on every tab and is never a signal, and a placeholder or note cell is not a value either.
  const route=(layout.pickup_location!==null&&locationCell(cellAt(cells,layout.pickup_location))!==null)||(layout.drop_location!==null&&locationCell(cellAt(cells,layout.drop_location))!==null);
  const distance=layout.distance_meters!==null&&mapCell(cellAt(cells,layout.distance_meters),'distance')!==null;
  const amount=[layout.cash_collected_paisa,layout.uber_credit_paisa,layout.tips_paisa,layout.commission_paisa].some(column=>column!==null&&mapCell(cellAt(cells,column),'money')!==null);
  return route||distance||amount;
}
export type RideRow={row:number;cells:SheetRow};
export function rideRows(rows:readonly SheetRow[],layout:WorkbookLayout,headerRow=layout.headerRow):RideRow[]{
  // The ledger ends at the last candidate row, so the driver work log and the close-out block below it, which reuse
  // columns B/C/D and P/Q/R, are never read as rides. Gaps inside the ledger (July rows 51-77) do not end the range.
  const found:RideRow[]=[];
  for(let index=headerRow;index<rows.length;index++){const cells=rows[index]!;if(isRideRow(cells,layout))found.push({row:index+1,cells});}
  return found;
}

export type MappedRow={input:RideInput;missingFields:string[]};
export function mapRow(cells:SheetRow,layout:WorkbookLayout,timezone:string):MappedRow{
  // R10: the workbook's receipts-minus-tips reading is an inference the owner has not confirmed, so no row may land confirmed.
  const input:RideInput={...blankRide(),timezone,financial_basis:'unresolved',financial_confirmed:false,comments:''};
  input.trip_date=tripDateCell(cellAt(cells,layout.trip_date));
  input.pickup_time=timeCell(cellAt(cells,layout.pickup_time));
  input.duration_seconds=mapCell(cellAt(cells,layout.duration_seconds),'seconds');
  input.pickup_location=locationCell(cellAt(cells,layout.pickup_location));
  input.drop_location=locationCell(cellAt(cells,layout.drop_location));
  input.distance_meters=mapCell(cellAt(cells,layout.distance_meters),'distance');
  input.cash_collected_paisa=mapCell(cellAt(cells,layout.cash_collected_paisa),'money');
  input.uber_credit_paisa=mapCell(cellAt(cells,layout.uber_credit_paisa),'money');
  input.tips_paisa=mapCell(cellAt(cells,layout.tips_paisa),'money');
  // Layout A's combined "Uber Comission / Pass" cell lands here whole; its pass share is unknown and is never split by inference.
  input.commission_paisa=mapCell(cellAt(cells,layout.commission_paisa),'money');
  input.pass_charge_paisa=mapCell(cellAt(cells,layout.pass_charge_paisa),'money');
  // The workbook net is evidence only (A32): calculate() never reads reported_net_paisa, so it cannot become a receipt or a total.
  input.reported_net_paisa=mapCell(cellAt(cells,layout.reported_net_paisa),'money');
  input.payment_method=mapCell(cellAt(cells,layout.payment_method),'payment')??'Unknown';
  input.service_type=mapCell(cellAt(cells,layout.service_type),'service')??'Unknown';
  input.comments=mapCell(cellAt(cells,layout.comments),'text')??'';
  // pass_charge_paisa is null on every row by design (A31), so it is not a missing field; every other mapped money column is.
  return {input,missingFields:financialFields.filter(field=>field!=='pass_charge_paisa'&&input[field]===null)};
}

export type WorksheetTotal={totalPaisa:number;comparable:boolean;rowsCounted:number;rowsExcluded:number;excludedFields:Partial<Record<MoneyField,number>>;reason:string};
const worksheetSigns:Record<MoneyField,1|-1>={cash_collected_paisa:1,uber_credit_paisa:1,tips_paisa:-1,commission_paisa:-1,pass_charge_paisa:-1};
// calculate() cannot serve this: every imported row is forced to 'unresolved' and pass_charge_paisa is always null,
// so it yields a total for no tab at all. The same formula is applied here while absent amounts are excluded rather than zeroed.
export function worksheetTotal(rows:readonly RideInput[]):WorksheetTotal{
  let total=0n,rowsCounted=0,rowsExcluded=0,receiptRows=0;
  const excludedFields:Partial<Record<MoneyField,number>>={};
  for(const row of rows){
    let contribution=0n,known=false,hasReceipt=false;
    for(const field of financialFields){
      const value=row[field];
      if(value===null){excludedFields[field]=(excludedFields[field]??0)+1;continue;}
      known=true;
      contribution+=BigInt(value)*BigInt(worksheetSigns[field]);
      if(field==='cash_collected_paisa'||field==='uber_credit_paisa')hasReceipt=true;
    }
    if(!known){rowsExcluded++;continue;}
    rowsCounted++;
    if(hasReceipt)receiptRows++;
    total+=contribution;
  }
  if(total>BigInt(Number.MAX_SAFE_INTEGER)||total<BigInt(Number.MIN_SAFE_INTEGER))throw new ValidationError('Workbook total exceeds the supported numeric range.');
  // A tab without a single known receipt cannot be totalled as income, which is why Layout C is the not_comparable case.
  const comparable=rowsCounted>0&&receiptRows>0;
  const absent=Object.values(excludedFields).reduce((sum,count)=>sum+(count??0),0);
  const reason=rowsCounted===0?'No row carries a known amount, so there is nothing to total.'
    :receiptRows===0?'No row carries a known cash or Uber credit amount, so the known deductions and tips cannot be totalled as receipts.'
    :`${receiptRows} of ${rowsCounted} counted rows carry a known cash or Uber credit amount; ${absent} absent amount${absent===1?'':'s'} across the tab were excluded rather than counted as zero.`;
  return {totalPaisa:Number(total),comparable,rowsCounted,rowsExcluded,excludedFields,reason};
}
export type VarianceRow={sheet_name:string;location:string;metric:string;workbook_reported:string|null;workbook_formula:string|null;app_value_paisa:number|null;difference_paisa:number|null;verdict:string;note:string};
// Own frozen ten-column header — distinct from the rides CSV contract. Byte shape mirrors exportCsv: BOM, CRLF, trailing CRLF, cell() quoting with positional text flags.
export function varianceCsv(rows:readonly VarianceRow[],sourceSha256:string):string{
  const header='source_sha256,sheet_name,location,metric,workbook_reported,workbook_formula,app_value_bdt,difference_bdt,verdict,note';
  const lines=rows.map(r=>[cell(sourceSha256),cell(r.sheet_name),cell(r.location),cell(r.metric),cell(r.workbook_reported),cell(r.workbook_formula),cell(decimal(r.app_value_paisa),false),cell(decimal(r.difference_paisa),false),cell(r.verdict),cell(r.note)].join(','));
  return '\uFEFF'+[header,...lines].join('\r\n')+'\r\n';
}
