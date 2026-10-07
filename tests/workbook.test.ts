import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { columnIndex, mapCell, mapRow, detectLayout, isRideRow, rideRows, serialToLocalDate, serialToLocalTime, serialToDurationSeconds, assertDateSystem, usesDate1904, worksheetTotal, WORKBOOK_PARSER_VERSION, LAYOUT_A, LAYOUT_B, LAYOUT_C, layouts, type CellValue, type SheetRow, type WorkbookLayout } from '../src/shared/workbook.ts';
import { PARSER_VERSION } from '../src/shared/parser.ts';
import { decimal, financialFields, validateInput } from '../src/shared/domain.ts';

const row = (cells: Record<string, CellValue>): SheetRow => { const out: CellValue[] = Array(20).fill(null); for (const [column, value] of Object.entries(cells)) out[columnIndex(column)] = value; return out; };
const HEAD_A = row({ B: 'SL', C: 'Trip Date', D: 'Pick time', E: 'Duration', F: 'Pick from', G: 'Drop at', H: 'Distance', I: 'Cash Collect', J: 'Tips', K: 'Fare(-tip)', L: 'User promo or uber credit (Uber Pay us)', M: 'Uber Mode', N: 'Payment Method', O: 'Uber Comission / Pass (We pay uber)', P: 'Net income per ride', Q: 'Net income in October', R: 'Screenshot', S: 'Commeent' });
const HEAD_B = row({ B: 'SL', C: 'Trip Date', D: 'Pick time', E: 'Duration', F: 'Pick from', G: 'Drop at', H: 'Distance', I: 'Cash Collect', J: 'Tips', K: 'Fare(-tip)', L: 'Uber Mode', M: 'Payment Method', N: 'Uber Comission', O: 'Net income', P: 'Total', Q: 'Screenshot', R: 'Commeent' });
const HEAD_C = row({ B: 'SL', C: 'Trip Date', D: 'Pick time', E: 'Duration', F: 'Pick from', G: 'Drop at', H: 'Distance', I: 'Fare', J: 'Payment Method', K: 'Uber Comission', L: 'Net income', M: 'Total Income in March' });
const HEAD_COST = row({ B: 'SL', C: 'Vehicle', D: 'Fuel', E: 'Odometer', F: 'Cost per km' });
const RIDE_A = row({ B: 1, C: 46326, D: 0.5, E: 3214 / 86400, F: 'Tejgaon, Dhaka', G: 'DIT Rd, Dhaka', H: '12.68km', I: 1234.56, J: 50, K: 1184.56, L: 0, M: 'Uber X', N: 'bKash', O: 25.5, P: 1159.06, S: 'gate' });
const RIDE_B = row({ B: 4, C: 46204, D: 0.75, E: 2350 / 86400, F: 'Mirpur 10', G: 'Farmgate', H: '5.5km', I: 596.24, J: 40, K: 556.24, L: 'Uber X', M: 'Cash', N: 0, O: 556.24, R: 'ok' });
const RIDE_C = row({ B: 1, C: 46084, D: 0.25, E: 1800 / 86400, F: 'Dhaka 1215', G: 'Dhaka 1000', H: '9.10km', I: 320.5, J: 'Cash', K: 12.5, L: 308 });
const SL_ONLY = row({ B: 2, C: 46326 });
const PLACEHOLDERS = row({ B: 3, C: 46326, H: '-', I: 'A/A', J: 'N/A', E: '99:99.99', O: '--' });
// The driver work log and close-out block below the ledger reuse columns B/C/D and P/Q/R.
const WORK_LOG = [row({ B: 95, C: 46326, D: 0.6, P: 'closing' }), row({ B: 96, C: 46327, D: 0.7, Q: 'shift note' })];
const SHIFT_ROW = row({ B: 97, C: 46328, F: 'Duty', I: 120 });
// Date.UTC is an exact calendar construction and never a reinterpretation of a serial, so it is an independent oracle here.
const oracle = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10);
const serialOf = (year: number, month: number, day: number) => Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);

test('A26: serials convert by integer arithmetic and a last day of month never shifts', () => {
  const anchors: [number, string][] = [[1, '1900-01-01'], [2, '1900-01-02'], [59, '1900-02-28'], [61, '1900-03-01'], [25569, '1970-01-01'], [46023, '2026-01-01'], [46084, '2026-03-03'], [46204, '2026-07-01'], [46267, '2026-09-02'], [46325, '2026-10-30'], [46326, '2026-10-31'], [46327, '2026-11-01'], [46387, '2026-12-31'], [46388, '2027-01-01']];
  for (const [serial, expected] of anchors) assert.equal(serialToLocalDate(serial), expected, `serial ${serial}`);
  const calendar: [number, number, number][] = [[1900, 3, 1], [1900, 12, 31], [2024, 2, 29], [2026, 1, 31], [2026, 2, 28], [2026, 3, 1], [2026, 3, 31], [2026, 6, 30], [2026, 7, 1], [2026, 8, 31], [2026, 9, 30], [2026, 10, 30], [2026, 10, 31], [2026, 11, 1], [2026, 12, 31], [2027, 1, 1]];
  for (const [year, month, day] of calendar) assert.equal(serialToLocalDate(serialOf(year, month, day)), oracle(year, month, day), `${year}-${month}-${day}`);
  assert.equal(serialToLocalDate(60), null);
  for (const serial of [0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(serialToLocalDate(serial), null);
});

test('A26: time and duration serials round to whole seconds and never wrap past midnight', () => {
  assert.equal(serialToLocalTime(0.5), '12:00:00'); assert.equal(serialToLocalTime(0.5838541666666667), '14:00:45'); assert.equal(serialToLocalTime(0.75), '18:00:00');
  assert.equal(serialToLocalTime(0), '00:00:00'); assert.equal(serialToLocalTime(0.9999999999), '23:59:59');
  for (const serial of [-1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(serialToLocalTime(serial), null);
  assert.equal(serialToDurationSeconds(0.03719907407407407), 3214); assert.equal(serialToDurationSeconds(0.5), 43200); assert.equal(serialToDurationSeconds(1.5), 129600);
  assert.equal(serialToDurationSeconds(0.000011574074074074), 1); assert.equal(serialToDurationSeconds(0), 0); assert.equal(serialToDurationSeconds(0.06990729166666666), 6040);
  for (const serial of [-0.5, Number.NaN]) assert.equal(serialToDurationSeconds(serial), null);
});

test('A26: the shared workbook module uses no Date path and no node import', () => {
  const source = readFileSync(new URL('../src/shared/workbook.ts', import.meta.url), 'utf8');
  assert.ok(!/new Date\(/.test(source)); assert.ok(!/\bDate\s*[.(]/.test(source)); assert.ok(!/from 'node:/.test(source));
  assert.notEqual(WORKBOOK_PARSER_VERSION, PARSER_VERSION);
});

test('a 1904 date system is refused and a 1900 workbook is accepted', () => {
  assert.throws(() => assertDateSystem('<workbook><workbookPr date1904="1"/></workbook>'));
  assert.throws(() => assertDateSystem('<workbook><workbookPr dateCompatibility="false" date1904="true"/></workbook>'));
  assert.throws(() => assertDateSystem('<workbookPr date1904="1" />'));
  assert.doesNotThrow(() => assertDateSystem('<workbook><workbookPr/></workbook>'));
  assert.doesNotThrow(() => assertDateSystem('<workbook><workbookPr date1904="0"/></workbook>'));
  assert.equal(usesDate1904('<workbookPr date1904="1"/>'), true); assert.equal(usesDate1904('<workbookPr/>'), false);
});

test('A27: distance text converts to metres and every placeholder stays null rather than zero', () => {
  assert.equal(mapCell('12.68km', 'distance'), 12680); assert.equal(mapCell('12.68 KM', 'distance'), 12680); assert.equal(mapCell('12.68', 'distance'), 12680);
  assert.equal(mapCell(12.68, 'distance'), 12680); assert.equal(mapCell(0.5, 'distance'), 500);
  // Every placeholder, blank and boolean cell is unknown in every kind of column, and never an explicit zero.
  for (const placeholder of ['', ' ', '-', '--', 'A/A', 'N/A', 'n/a', '#N/A', 'na', 'nil', 'null', 'tbd', '?', null, undefined, true]) {
    for (const kind of ['distance', 'money', 'seconds', 'text', 'payment', 'service'] as const) {
      const mapped = mapCell(placeholder, kind);
      assert.equal(mapped, null, `${JSON.stringify(placeholder)} as ${kind}`); assert.notEqual(mapped, 0, `${JSON.stringify(placeholder)} as ${kind}`);
    }
  }
  for (const kind of ['distance', 'money', 'seconds'] as const) { assert.equal(mapCell('note about the ride', kind), null); assert.notEqual(mapCell('note about the ride', kind), 0); }
  assert.equal(mapCell('note about the ride', 'text'), 'note about the ride'); assert.equal(mapCell('wallet', 'payment'), null); assert.equal(mapCell('nothing', 'service'), null);
  assert.equal(mapCell('99:99.99', 'seconds'), null); assert.equal(mapCell('00:53:34', 'seconds'), 3214); assert.equal(mapCell('0:15:31', 'seconds'), 931);
  assert.equal(mapCell(-5, 'distance'), null); assert.equal(mapCell(-5, 'seconds'), null); assert.equal(mapCell(-5, 'text'), '-5');
});

test('A27: money converts to integer paisa, an explicit zero stays zero and an over-precise value stays unknown', () => {
  assert.equal(mapCell('1234.56', 'money'), 123456); assert.equal(mapCell(1234.5, 'money'), 123450); assert.equal(mapCell(' 42 ', 'money'), 4200);
  assert.equal(mapCell('0', 'money'), 0); assert.equal(mapCell('-0.01', 'money'), -1); assert.equal(mapCell('৳42.50', 'money'), null);
  assert.equal(mapCell('1234.567', 'money'), null); assert.equal(mapCell('90071992547409.92', 'money'), null); assert.equal(mapCell('BDT 12.50', 'money'), null);
});

test('A24: layouts A, B and C are detected by header text and March header is found at row 2', () => {
  assert.deepEqual(detectLayout([HEAD_A, RIDE_A]), { layout: 'A', headerRow: 1 });
  assert.deepEqual(detectLayout([HEAD_B, RIDE_B]), { layout: 'B', headerRow: 1 });
  assert.deepEqual(detectLayout([row({ A: 'March-2026' }), HEAD_C, RIDE_C]), { layout: 'C', headerRow: 2 });
  assert.deepEqual(detectLayout([HEAD_A, HEAD_C]), { layout: 'A', headerRow: 1 });
  assert.equal(LAYOUT_A.headerRow, 1); assert.equal(LAYOUT_B.headerRow, 1); assert.equal(LAYOUT_C.headerRow, 2);
  assert.equal(LAYOUT_C.comments, null); assert.equal(LAYOUT_C.service_type, null);
});

test('A23: an unrecognised tab is reported as unrecognised with zero rows and is never guessed at', () => {
  const detectedRows = (cells: SheetRow[]) => { const detected = detectLayout(cells); return detected.layout === 'unrecognised' ? [] : rideRows(cells, layouts[detected.layout], detected.headerRow); };
  assert.deepEqual(detectLayout([HEAD_COST, RIDE_A]), { layout: 'unrecognised', headerRow: 0 });
  assert.deepEqual(detectLayout([]), { layout: 'unrecognised', headerRow: 0 });
  assert.deepEqual(detectedRows([HEAD_COST, RIDE_A]), []);
  assert.deepEqual(detectedRows([HEAD_A, RIDE_A]).map(r => r.row), [2]);
  assert.deepEqual(detectedRows([row({ A: 'March-2026' }), HEAD_C, RIDE_C]).map(r => r.row), [3]);
});

test('A24: an absent column is reported absent rather than as zero', () => {
  assert.equal(LAYOUT_B.uber_credit_paisa, null); assert.equal(LAYOUT_C.cash_collected_paisa, null); assert.equal(LAYOUT_C.uber_credit_paisa, null); assert.equal(LAYOUT_C.tips_paisa, null);
  for (const layout of [LAYOUT_A, LAYOUT_B, LAYOUT_C] as const) assert.equal(layout.pass_charge_paisa, null);
  const b = mapRow(RIDE_B, LAYOUT_B, 'Asia/Dhaka').input;
  assert.equal(b.uber_credit_paisa, null); assert.notEqual(b.uber_credit_paisa, 0);
  const c = mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').input;
  assert.equal(c.cash_collected_paisa, null); assert.equal(c.tips_paisa, null); assert.notEqual(c.reported_net_paisa, 0);
  assert.deepEqual(financialFields.filter(field => c[field] === null), ['cash_collected_paisa', 'uber_credit_paisa', 'tips_paisa', 'pass_charge_paisa']);
});

test('A25: a ride row needs a parseable date plus one corroborating signal and SL alone never qualifies', () => {
  assert.equal(isRideRow(RIDE_A, LAYOUT_A), true); assert.equal(isRideRow(RIDE_B, LAYOUT_B), true); assert.equal(isRideRow(RIDE_C, LAYOUT_C), true);
  assert.equal(isRideRow(SL_ONLY, LAYOUT_A), false);
  assert.equal(isRideRow(row({ B: 1, H: '12.68km', I: 100 }), LAYOUT_A), false);
  assert.equal(isRideRow(row({ B: 1, C: 'not a date', H: '12.68km' }), LAYOUT_A), false);
  assert.equal(isRideRow(row({ B: 1, C: 46326 }), LAYOUT_A), false);
  assert.equal(isRideRow(PLACEHOLDERS, LAYOUT_A), false);
  assert.equal(isRideRow(row({ B: 1, C: 46326, F: 'Tejgaon' }), LAYOUT_A), true);
  assert.equal(isRideRow(row({ B: 1, C: 46326, J: 50 }), LAYOUT_A), true);
  assert.equal(isRideRow(row({ B: 1, C: 46326, I: '-', J: 'A/A' }), LAYOUT_A), false);
  assert.equal(isRideRow(row({ B: 1, C: '2026-10-31', H: '1km' }), LAYOUT_A), true);
});

test('A25: the ledger ends at the last candidate so work log and close-out rows never become rides', () => {
  assert.deepEqual(rideRows([HEAD_A, RIDE_A, SL_ONLY, RIDE_B, PLACEHOLDERS, ...WORK_LOG], LAYOUT_A).map(r => r.row), [2, 4]);
  assert.deepEqual(rideRows([HEAD_C, row({ A: 'March-2026' }), RIDE_C], LAYOUT_C, 2).map(r => r.row), [3]);
});

test('A31: a combined commission and pass cell is never split and the pass charge stays null', () => {
  const a = mapRow(RIDE_A, LAYOUT_A, 'Asia/Dhaka').input;
  assert.equal(a.commission_paisa, 2550); assert.equal(a.pass_charge_paisa, null); assert.notEqual(a.pass_charge_paisa, 0);
  assert.equal(mapRow(PLACEHOLDERS, LAYOUT_A, 'Asia/Dhaka').input.commission_paisa, null);
  assert.equal(mapRow(row({ B: 1, C: 46326, F: 'Tejgaon', O: 0 }), LAYOUT_A, 'Asia/Dhaka').input.commission_paisa, 0);
});

test('A31/A32: every mapped row is an unconfirmed unresolved draft carrying the workbook net as evidence only', () => {
  const a = mapRow(RIDE_A, LAYOUT_A, 'Asia/Dhaka').input;
  assert.equal(a.financial_basis, 'unresolved'); assert.equal(a.financial_confirmed, false); assert.equal(a.adjustment_reason, '');
  assert.equal(a.reported_net_paisa, 115906);
  assert.equal(a.trip_date, '2026-10-31'); assert.equal(a.pickup_time, '12:00:00'); assert.equal(a.duration_seconds, 3214); assert.equal(a.distance_meters, 12680);
  assert.equal(a.cash_collected_paisa, 123456); assert.equal(a.uber_credit_paisa, 0); assert.equal(a.tips_paisa, 5000);
  assert.equal(a.pickup_location, 'Tejgaon, Dhaka'); assert.equal(a.payment_method, 'bKash'); assert.equal(a.service_type, 'Uber X'); assert.equal(a.comments, 'gate');
  assert.equal(mapRow(row({ B: 1, C: 46326, F: 'Tejgaon', M: 'Other', N: 'Cash' }), LAYOUT_A, 'Asia/Dhaka').input.payment_method, 'Cash');
  assert.equal(mapRow(RIDE_B, LAYOUT_B, 'Asia/Dhaka').input.service_type, 'Uber X');
  assert.equal(mapRow(row({ B: 1, C: 46326, F: 'Tejgaon', M: 'nothing', N: 'wallet' }), LAYOUT_A, 'Asia/Dhaka').input.service_type, 'Unknown');
  assert.equal(mapRow(row({ B: 1, C: 46326, F: 'Tejgaon', M: 'Uber X', N: 'wallet' }), LAYOUT_A, 'Asia/Dhaka').input.payment_method, 'Unknown');
});

test('A32: the workbook net is never used as a receipt, a deduction or an income total', () => {
  const a = mapRow(RIDE_A, LAYOUT_A, 'Asia/Dhaka').input;
  const recalculated = worksheetTotal([{ ...a, pass_charge_paisa: 0 }]).totalPaisa;
  assert.equal(recalculated, 123456 + 0 - 2550 - 5000);
  // The net carries no weight in the total, so dropping it changes nothing and nothing else reads it.
  assert.equal(worksheetTotal([{ ...a, pass_charge_paisa: 0, reported_net_paisa: null }]).totalPaisa, recalculated);
  assert.equal(worksheetTotal([{ ...a, pass_charge_paisa: 0, reported_net_paisa: 0 }]).totalPaisa, recalculated);
});

test('A30: missingFields names exactly the absent money columns for layouts B and C', () => {
  assert.deepEqual(mapRow(RIDE_A, LAYOUT_A, 'Asia/Dhaka').missingFields, []);
  assert.deepEqual(mapRow(RIDE_B, LAYOUT_B, 'Asia/Dhaka').missingFields, ['uber_credit_paisa']);
  assert.deepEqual(mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').missingFields, ['cash_collected_paisa', 'uber_credit_paisa', 'tips_paisa']);
  assert.deepEqual(mapRow(PLACEHOLDERS, LAYOUT_A, 'Asia/Dhaka').missingFields, ['cash_collected_paisa', 'uber_credit_paisa', 'tips_paisa', 'commission_paisa']);
  assert.ok(!mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').missingFields.includes('pass_charge_paisa'));
});

test('A47: the timezone comes from the passed app setting and not from the blank ride default', () => {
  assert.equal(mapRow(RIDE_A, LAYOUT_A, 'Asia/Colombo').input.timezone, 'Asia/Colombo');
  assert.equal(mapRow(RIDE_B, LAYOUT_B, 'Asia/Kolkata').input.timezone, 'Asia/Kolkata');
  assert.equal(mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').input.timezone, 'Asia/Dhaka');
});

test('every mapRow output for every layout is accepted by validateInput', () => {
  const tab: [SheetRow, WorkbookLayout][] = [[RIDE_A, LAYOUT_A], [SL_ONLY, LAYOUT_A], [PLACEHOLDERS, LAYOUT_A], [SHIFT_ROW, LAYOUT_A], [RIDE_B, LAYOUT_B], [RIDE_C, LAYOUT_C], [row({ C: 46326, D: '9:05 PM', E: '00:53:34', H: '12.68km' }), LAYOUT_A]];
  for (const [cells, layout] of tab) {
    const mapped = mapRow(cells, layout, 'Asia/Dhaka');
    validateInput(mapped.input);
    for (const field of [...financialFields, 'reported_net_paisa', 'distance_meters', 'duration_seconds'] as const) {
      const value = mapped.input[field];
      if (value !== null) assert.ok(Number.isSafeInteger(value), `${field} is an integer or null`);
    }
  }
  assert.equal(mapRow(row({ C: 46326, D: '9:05 PM' }), LAYOUT_A, 'Asia/Dhaka').input.pickup_time, '21:05:00');
  assert.equal(mapRow(row({ C: 46326, D: '12:30 AM' }), LAYOUT_A, 'Asia/Dhaka').input.pickup_time, '00:30:00');
  assert.equal(mapRow(row({ C: 46326, D: '10:11' }), LAYOUT_A, 'Asia/Dhaka').input.pickup_time, '10:11:00');
  assert.equal(mapRow(row({ C: 46326, D: 'a note about the ride' }), LAYOUT_A, 'Asia/Dhaka').input.pickup_time, null);
  assert.equal(mapRow(row({ C: 46326, D: '25:00:00' }), LAYOUT_A, 'Asia/Dhaka').input.pickup_time, null);
  assert.equal(mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').input.comments, '');
});

test('A36: worksheetTotal excludes absent amounts instead of zeroing them and returns an exact integer paisa total', () => {
  const first = mapRow(row({ C: 46325, F: 'Tejgaon', I: 1000, J: 0, K: 1000, L: 0, N: 'Cash', O: 0, P: 1000 }), LAYOUT_A, 'Asia/Dhaka').input;
  const second = mapRow(row({ C: 46326, F: 'Tejgaon', I: 500, J: 1, K: 499, L: 0, N: 'Cash', O: 0, P: 499.01 }), LAYOUT_A, 'Asia/Dhaka').input;
  const third = mapRow(row({ C: 46326, H: '3.2km', I: '-', J: 25 }), LAYOUT_A, 'Asia/Dhaka').input;
  const total = worksheetTotal([first, second, third]);
  assert.equal(total.totalPaisa, 100000 + 49900 - 2500); assert.equal(decimal(total.totalPaisa), '1474.00'); assert.ok(Number.isSafeInteger(total.totalPaisa));
  assert.equal(total.comparable, true); assert.equal(total.rowsCounted, 3); assert.equal(total.rowsExcluded, 0);
  // The absent cash on the third row is excluded from that row's contribution rather than counted as zero.
  assert.equal(total.excludedFields.cash_collected_paisa, 1); assert.equal(total.excludedFields.pass_charge_paisa, 3);
  assert.ok(total.reason.includes('excluded rather than counted as zero'));
  // The workbook's own stated nets differ from the recalculated total by exactly one paisa: no tolerance and no rounding.
  const twoRows = worksheetTotal([first, second]);
  assert.equal(twoRows.totalPaisa, 149900);
  assert.equal(first.reported_net_paisa! + second.reported_net_paisa! - twoRows.totalPaisa, 1);
  const nothing = worksheetTotal([mapRow(SL_ONLY, LAYOUT_A, 'Asia/Dhaka').input, mapRow(PLACEHOLDERS, LAYOUT_A, 'Asia/Dhaka').input]);
  assert.equal(nothing.totalPaisa, 0); assert.equal(nothing.comparable, false); assert.equal(nothing.rowsCounted, 0); assert.equal(nothing.rowsExcluded, 2);
  assert.deepEqual(nothing.excludedFields, { cash_collected_paisa: 2, uber_credit_paisa: 2, tips_paisa: 2, commission_paisa: 2, pass_charge_paisa: 2 });
  const tipsOnly = worksheetTotal([mapRow(SL_ONLY, LAYOUT_A, 'Asia/Dhaka').input, third]);
  assert.equal(tipsOnly.rowsCounted, 1); assert.equal(tipsOnly.rowsExcluded, 1); assert.equal(tipsOnly.totalPaisa, -2500); assert.equal(tipsOnly.comparable, false);
  assert.equal(worksheetTotal(Array.from({ length: 2000 }, () => ({ ...first, cash_collected_paisa: 1_000_000_000_000 }))).totalPaisa, 2_000_000_000_000_000);
  assert.throws(() => worksheetTotal([{ ...first, cash_collected_paisa: Number.MAX_SAFE_INTEGER }, { ...first, cash_collected_paisa: Number.MAX_SAFE_INTEGER }]));
});

test('A36: a tab with no known receipts is not comparable and says why', () => {
  const march = mapRow(RIDE_C, LAYOUT_C, 'Asia/Dhaka').input;
  const total = worksheetTotal([march, mapRow(row({ C: 46085, F: 'Dhaka', H: '4km', I: 210, J: 'Cash', K: 10, L: 200 }), LAYOUT_C, 'Asia/Dhaka').input]);
  assert.equal(total.comparable, false); assert.equal(total.rowsCounted, 2); assert.equal(total.rowsExcluded, 0);
  assert.equal(total.totalPaisa, -1250 - 1000);
  assert.ok(total.reason.includes('cash or Uber credit')); assert.ok(!total.reason.includes('excluded rather than'));
  assert.deepEqual(total.excludedFields, { cash_collected_paisa: 2, uber_credit_paisa: 2, tips_paisa: 2, pass_charge_paisa: 2 });
  assert.equal(worksheetTotal([]).comparable, false); assert.ok(worksheetTotal([]).reason.includes('nothing to total'));
});
