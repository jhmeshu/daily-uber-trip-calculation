import { parseDecimal, parseMoney, validDate, cleanPickup, type RideInput } from './domain.ts';
import type { OcrResult, Transform } from './intake.ts';
export const PARSER_VERSION = '1.1.0-experimental';
export type Position = { left:number;top:number;width:number;height:number };
export type Observation = { field:keyof RideInput|'trip_id';value:string|number;exact_text:string;position:Position|null;confidence:number };
export function normalize(text:string) { return text.replace(/[০-৯]/g,c=>String(c.charCodeAt(0)-'০'.charCodeAt(0))).replace(/\u00a0/g,' ').replace(/[৳]/g,'BDT ').replace(/[\t ]+/g,' ').trim(); }
export function parseOcr(result:OcrResult):Observation[] {
 const out:Observation[]=[];const lines=result.text.split(/\r?\n/).filter(x=>x.trim());
 const positions=new Map<string,Position>();
 // TSV is retained verbatim; positions for lines aggregate their exact source word boxes.
 const tsvLines=new Map<string,{text:string[];left:number;top:number;right:number;bottom:number;confidence:number[]}>();
 for(const row of result.tsv.split('\n').slice(1)){const c=row.split('\t');if(c[0]!=='5'||!c[11]?.trim())continue;const key=c.slice(1,5).join(':');const left=Number(c[6]),top=Number(c[7]),right=left+Number(c[8]),bottom=top+Number(c[9]);const old=tsvLines.get(key)??{text:[],left,top,right,bottom,confidence:[]};old.text.push(c.slice(11).join('\t'));old.left=Math.min(old.left,left);old.top=Math.min(old.top,top);old.right=Math.max(old.right,right);old.bottom=Math.max(old.bottom,bottom);old.confidence.push(Number(c[10]));tsvLines.set(key,old);}
 for(const v of tsvLines.values())positions.set(normalize(v.text.join(' ')),{left:v.left,top:v.top,width:v.right-v.left,height:v.bottom-v.top});
 const add=(field:Observation['field'],value:Observation['value'],text:string)=>{out.push({field,value,exact_text:text,position:positions.get(normalize(text))??null,confidence:result.confidence});};
 for(const exact of lines){const line=normalize(exact);let m:RegExpMatchArray|null;
  const labelRules:[RegExp,keyof RideInput][]=[[/\bCash collected\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'cash_collected_paisa'],[/\bUber credit\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'uber_credit_paisa'],[/\b(?:Uber )?commission\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'commission_paisa'],[/\b(?:Tips?|Gratuity)\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'tips_paisa'],[/\bPer[- ]ride pass(?: charge)?\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'pass_charge_paisa'],[/\b(?:Net earnings|Net payout|Earnings)\s*:?\s*(?:BDT\s*)?(-?\d+(?:\.\d{1,2})?)(?![\d.,])/i,'reported_net_paisa']];
  for(const [regex,field]of labelRules){m=line.match(regex);if(m){add(field,parseMoney(m[1]!)!,exact);if(field==='reported_net_paisa')add('financial_basis','already_net',exact);}}
  // Driver trip-summary layouts put amounts before the explicit financial label.
  const reverse=/BDT\s*(-?\d+(?:\.\d{1,2})?)\s+(Cash collected|Tips?\b)/gi;for(const match of line.matchAll(reverse))add(/cash/i.test(match[2]!)?'cash_collected_paisa':'tips_paisa',parseMoney(match[1]!)!,exact);
  if((m=line.match(/\b(?:Trip date|Date)\s*:\s*(\d{4}-\d{2}-\d{2})\b/i))&&validDate(m[1]!))add('trip_date',m[1]!,exact);
  if((m=line.match(/\b(?:Pickup time|Time)\s*:\s*((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?)\b/i)))add('pickup_time',m[1]!.length===5?m[1]+':00':m[1]!,exact);
  if((m=line.match(/(?<![\d.,])\b(?:Distance\s*:\s*)?(\d+(?:\.\d{1,3})?)\s*km\b/i)))add('distance_meters',parseDecimal(m[1]!,3)!,exact);
  if((m=line.match(/(\d+)\s*min(?:\(s\)|s)?\s*(\d+)\s*sec(?:\(s\)|s)?/i))&&Number(m[2])<60)add('duration_seconds',Number(m[1])*60+Number(m[2]),exact);
  for(const [regex,field]of [[/^Pickup\s*:\s*(.+)$/i,'pickup_location'],[/^Drop(?:off)?\s*:\s*(.+)$/i,'drop_location'],[/^Trip ID\s*:\s*(\S+)$/i,'trip_id']] as const)if((m=line.match(regex)))add(field,field==='pickup_location'?cleanPickup(m[1]!):m[1]!,exact);
  if((m=line.match(/^Payment(?: method)?\s*:\s*(Cash|bKash|Other)$/i)))add('payment_method',m[1]!.toLowerCase()==='bkash'?'bKash':m[1]!.toLowerCase()==='cash'?'Cash':'Other',exact);
  if(/\bUber\s?X\b/i.test(line))add('service_type','Uber X',exact);else if(/\bUber Premium\b/i.test(line))add('service_type','Uber Premium',exact);else if(/\bUber Premier\b/i.test(line))add('service_type','Other',exact);
 }
 // Time is positional in the supplied driver-summary layout. Never infer a year from map copyright.
 const summary=lines.some(x=>/Cash collected/i.test(x))&&lines.some(x=>/Uber\s?(?:X|Premier|Premium)/i.test(x));
 if(summary){for(const exact of lines){const m=normalize(exact).match(/(?:^|\s)((?:[01]\d|2[0-3]):[0-5]\d)(?:\s|$)/);if(m&&!out.some(x=>x.field==='pickup_time'))add('pickup_time',m[1]+':00',exact);}
  const mapEnd=lines.findIndex(x=>/Map data.*20\d{2}/i.test(x));
  if(mapEnd>=0){const route=lines.slice(mapEnd+1);const boundaries:number[]=[];route.forEach((x,i)=>{if(/Dhaka|Bangladesh/i.test(x)&&!/^Bangladesh\s*$/i.test(x.trim())&&(i===0||/Bangladesh\s*$/i.test(route[i-1]!.trim())))boundaries.push(i);});if(boundaries.length===2){const pickup=route.slice(boundaries[0],boundaries[1]).join(' ').trim();const drop=route.slice(boundaries[1]).join(' ').trim();add('pickup_location',cleanPickup(pickup),route[boundaries[0]!]!);add('drop_location',drop,route[boundaries[1]!]!);}}
 }
 const cash=out.filter(o=>o.field==='cash_collected_paisa');
 const tips=out.filter(o=>o.field==='tips_paisa');
 for(const o of cash)add('payment_method','Cash',o.exact_text);
 if(new Set(cash.map(o=>o.value)).size===1&&new Set(tips.map(o=>o.value)).size===1&&!out.some(o=>o.field==='reported_net_paisa')){
  add('reported_net_paisa',Number(cash[0]!.value)-Number(tips[0]!.value),`${cash[0]!.exact_text}\n${tips[0]!.exact_text}`);
 }
 return out.filter((o,i)=>out.findIndex(x=>x.field===o.field&&x.value===o.value&&x.exact_text===o.exact_text)===i);
}
export function sourcePoint(position:Position,transform:Transform,width:number,height:number):Position {
 const x=position.left+(transform.crop?.left??0),y=position.top+(transform.crop?.top??0),w=position.width,h=position.height;
 switch(transform.rotation){case 90:return{left:y,top:height-x-w,width:h,height:w};case 180:return{left:width-x-w,top:height-y-h,width:w,height:h};case 270:return{left:width-y-h,top:x,width:h,height:w};default:return{left:x,top:y,width:w,height:h};}
}
