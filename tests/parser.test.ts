import {test}from'node:test';import assert from'node:assert/strict';import{parseOcr,sourcePoint}from'../src/shared/parser.ts';
const parse=(text:string)=>parseOcr({text,confidence:80,tsv:'',blocks:[]});
test('M3 synthetic labels, Bangla digits, net meaning, missing fees and ambiguous date',()=>{
 const observations=parse('Date: 2026-10-06\nPickup time: 09:30\nCash collected: ৳ ৫০০.০০\nUber credit: BDT 0\nTips: 40\nCommission: 50\nPer-ride pass: 0\nDistance: 12.50 km\nNet earnings: BDT 410\nMon, 5 Oct\nMonthly pass: BDT 500');
 assert.equal(observations.find(o=>o.field==='cash_collected_paisa')!.value,50000);assert.equal(observations.find(o=>o.field==='pickup_time')!.value,'09:30:00');assert.equal(observations.find(o=>o.field==='distance_meters')!.value,12500);assert.equal(observations.find(o=>o.field==='financial_basis')!.value,'already_net');assert.equal(observations.filter(o=>o.field==='pass_charge_paisa').length,1);
 assert.equal(parse('Cash collected: BDT 1.234').length,0);assert.equal(parse('Distance: 1.2345 km').length,0);
 assert.deepEqual(parse('BDT 500\nUnknown payout layout\nMon, 5 Oct\nMap data ©2026'),[]);
 const net=parse('Net payout: 280.10');assert.ok(!net.some(o=>o.field==='cash_collected_paisa'||o.field==='commission_paisa'));
 assert.ok(!parse('BDT 500 Cash collected').some(o=>o.field==='tips_paisa'||o.field==='commission_paisa'));
});
test('M3 positional transforms map cropped/rotated coordinates to originals',()=>{assert.deepEqual(sourcePoint({left:10,top:20,width:30,height:40},{rotation:90,crop:{left:5,top:6,width:80,height:90}},100,200),{left:26,top:155,width:40,height:30});});

test('Driver cash payment, pickup icon cleanup and cash-minus-tip earnings',()=>{
 const text='BDT 407.38\nUberX 39 min(s) 10 sec(s) 13:04\nBDT 407.38 Cash collected\nBDT 40.00 Tip\nMap data ©2026\n? Tejgaon, Dhaka\nBangladesh\nDIT Rd, Dhaka\nBangladesh';
 const result=parse(text);
 assert.equal(result.find(o=>o.field==='payment_method')!.value,'Cash');
 assert.equal(result.find(o=>o.field==='pickup_location')!.value,'Tejgaon, Dhaka Bangladesh');
 assert.equal(result.find(o=>o.field==='reported_net_paisa')!.value,36738);
 assert.equal(result.find(o=>o.field==='duration_seconds')!.value,2350);
 assert.ok(result.find(o=>o.field==='pickup_location')!.exact_text.startsWith('?'));
 assert.ok(!parse('BDT 596.24 Cash collected').some(o=>o.field==='reported_net_paisa'));
 assert.equal(parse('Cash collected: 407.38\nTips: 0').find(o=>o.field==='reported_net_paisa')!.value,40738);
 assert.ok(!parse('Cash collected: 400\nCash collected: 500\nTips: 40').some(o=>o.field==='reported_net_paisa'));
});
