import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import { Store } from '../server/store.ts';
import { WorkbookImport } from '../server/workbook.ts';
import { Intake } from '../server/intake.ts';
import { Evidence } from '../server/evidence.ts';
import { blankRide, summarize } from '../src/shared/domain.ts';
import { columnIndex, mapCell, mapRow, detectLayout, isRideRow, rideRows, serialToLocalDate, serialToLocalTime, serialToDurationSeconds, assertDateSystem, usesDate1904, worksheetTotal, WORKBOOK_PARSER_VERSION, LAYOUT_A, LAYOUT_B, LAYOUT_C, layouts, type CellValue, type SheetRow, type WorkbookLayout } from '../src/shared/workbook.ts';
import { PARSER_VERSION } from '../src/shared/parser.ts';
import { decimal, financialFields, validateInput, ValidationError } from '../src/shared/domain.ts';

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

// ---- Task 4: WorkbookImport over synthetic fflate-built workbooks (release files are personal data). ----
const enc = strToU8;
function sheetXmlOf(rows: SheetRow[]): string {
  const body = rows.map((cells, i) => `<row r="${i + 1}">${cells.map((v, j) => {
    const letters = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T'];
    const ref = `${letters[j]}${i + 1}`;
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return `<c r="${ref}"><v>${v}</v></c>`;
    if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`;
}
function syntheticWorkbook(sheets: Record<string, string>): Buffer {
  const names = Object.keys(sheets);
  const files: Record<string, Uint8Array> = { '[Content_Types].xml': enc('<Types/>'), '_rels/.rels': enc('<Relationships/>'), 'xl/workbook.xml': enc(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr/><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`), 'xl/_rels/workbook.xml.rels': enc(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((n, i) => `<Relationship Id="rId${i + 1}" Type="t" Target="worksheets/sheet${i + 2}.xml"/>`).join('')}</Relationships>`) };
  names.forEach((n, i) => { files[`xl/worksheets/sheet${i + 2}.xml`] = enc(sheets[n]!); });
  return Buffer.from(zipSync(files));
}
const sixTabWorkbook = () => syntheticWorkbook({
  'October-2026': sheetXmlOf([HEAD_A, RIDE_A]),
  'September-2026': sheetXmlOf([HEAD_A, RIDE_B]),
  'August-2026': sheetXmlOf([HEAD_A, RIDE_A]),
  'July-2026': sheetXmlOf([HEAD_B, RIDE_B]),
  'March-2026': sheetXmlOf([row({ A: 'March-2026' }), HEAD_C, RIDE_C]),
  'Cost Compare-Office with Uber-v': sheetXmlOf([HEAD_COST, RIDE_A]),
});

test('A23: preview writes no rides and changes no month total', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-a23-')); const store = new Store(root);
  try {
    const reviewed = store.save({ ...blankRide(), trip_date: '2026-10-06', pickup_time: '09:30:00', financial_basis: 'worksheet_cash_plus_credit', cash_collected_paisa: 50000, uber_credit_paisa: 0, tips_paisa: 4000, commission_paisa: 5000, pass_charge_paisa: 0, financial_confirmed: true }, 'reviewed');
    const before = summarize(store.list());
    const wb = new WorkbookImport(store);
    const preview = wb.preview(sixTabWorkbook());
    assert.equal(store.list().length, 1); assert.equal(store.get(reviewed.id).status, 'reviewed');
    assert.deepEqual(summarize(store.list()), before);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_sources').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_rows').get()!.n, 0);
    assert.equal(preview.tabs.length, 6);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A23: preview reports six tabs, layouts, and Cost Compare as not a ride ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-tabs-')); const store = new Store(root);
  try {
    const preview = new WorkbookImport(store).preview(sixTabWorkbook());
    assert.deepEqual(preview.tabs.map(t => t.sheet), ['October-2026', 'September-2026', 'August-2026', 'July-2026', 'March-2026', 'Cost Compare-Office with Uber-v']);
    assert.deepEqual(preview.tabs.map(t => t.layout), ['A', 'A', 'A', 'B', 'C', 'unrecognised']);
    assert.deepEqual(preview.tabs.map(t => t.ledger), [true, true, true, true, true, false]);
    const cost = preview.tabs[5]!;
    assert.equal(cost.verdict, 'not_comparable'); assert.equal(cost.reason, 'Tab is not a ride ledger.'); assert.equal(cost.rows.length, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('staging bounds: at most 5 concurrent, expired on access, evicted oldest on insert, 25 MB cap', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-staging-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    const tokens = [wb.preview(sixTabWorkbook()).token, wb.preview(sixTabWorkbook()).token, wb.preview(sixTabWorkbook()).token, wb.preview(sixTabWorkbook()).token, wb.preview(sixTabWorkbook()).token, wb.preview(sixTabWorkbook()).token];
    assert.equal(wb.staging.size, 5); assert.throws(() => wb.commit(tokens[0]!, true, ''), /preview is unknown or was replaced/);
    assert.equal(wb.staging.get(tokens[5]!)!.token, tokens[5]);
    wb.staging.get(tokens[5]!)!.expires = Date.now() - 1;
    assert.throws(() => wb.commit(tokens[5]!, true, ''), /preview expired/);
    assert.equal(wb.staging.size, 4); // expired entry was pruned on access.
    for (const t of tokens.slice(1, 5)) wb.staging.get(t)!.expires = Date.now() - 1;
    wb.preview(sixTabWorkbook());
    assert.equal(wb.staging.size, 1); // prune-on-insert clears the rest.
    const huge = Buffer.concat([sixTabWorkbook(), Buffer.alloc(26_000_000)]);
    assert.throws(() => wb.preview(huge), ValidationError);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('token is bound to the file: unknown token and tampered staging are rejected', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-token-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    assert.throws(() => wb.commit(crypto.randomUUID(), true, ''), /preview is unknown or was replaced/);
    const token = wb.preview(sixTabWorkbook()).token;
    wb.staging.get(token)!.buffer = Buffer.from('garbage');
    assert.throws(() => wb.commit(token, true, ''), /no longer matches its preview/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A43: a duplicate SHA-256 re-import is refused without confirmation plus reason, and the reason is stored', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-dup-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    const buffer = sixTabWorkbook();
    const first = wb.commit(wb.preview(buffer).token, true, '');
    assert.equal(first.imported, 5);
    const again = wb.preview(buffer);
    assert.ok(again.duplicate); assert.equal(again.duplicate!.rowCount, 5); assert.ok(again.duplicate!.importedAt.length > 0);
    assert.throws(() => wb.commit(again.token, true, ''), /imported before/);
    const second = wb.commit(again.token, true, 'Re-imported after correcting the July tab');
    assert.equal(second.imported, 5);
    const source = store.db.prepare('SELECT * FROM import_sources ORDER BY rowid DESC LIMIT 1').get()!;
    assert.equal(source.note, 'Re-imported after correcting the July tab');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_rows').get()!.n, 10);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A44: a matching date/time/distance/cash ride is a non-blocking warning, the row still imports', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-a44-')); const store = new Store(root);
  try {
    const mapped = mapRow(RIDE_A, layouts.A, 'Asia/Dhaka').input;
    const existing = store.save({ ...mapped, financial_basis: 'unresolved' }, 'draft');
    const wb = new WorkbookImport(store);
    const preview = wb.preview(sixTabWorkbook());
    const october = preview.tabs[0]!;
    assert.equal(october.rows[0]!.warning, true);
    const result = wb.commit(preview.token, true, '');
    assert.equal(result.imported, 5);
    const row = store.db.prepare('SELECT * FROM import_rows WHERE sheet_name=?').get('October-2026')!;
    assert.equal(row.disposition, 'imported');
    assert.notEqual(store.get(existing.id).status, 'deleted');
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A28: every committed row is draft, unresolved, unconfirmed, revision 1, reviewed_at null', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-a28-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    const result = wb.commit(wb.preview(sixTabWorkbook()).token, true, '');
    assert.equal(result.imported, 5);
    for (const ride of store.list()) {
      assert.equal(ride.status, 'draft'); assert.equal(ride.financial_basis, 'unresolved');
      assert.equal(ride.financial_confirmed, false); assert.equal(ride.revision, 1); assert.equal(ride.reviewed_at, null);
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A47: each ride gets a distinct randomUUID, a create history row, an import_rows link, valid data, app timezone', () => {
    const root = mkdtempSync(join(tmpdir(), 'uber-wb-a47-')); const store = new Store(root);
  try {
    store.db.prepare("UPDATE settings SET value='\"Europe/London\"' WHERE key='timezone'").run();
    const wb = new WorkbookImport(store);
    wb.commit(wb.preview(sixTabWorkbook()).token, true, '');
    const rides = store.list();
    assert.equal(rides.length, 5);
    assert.equal(new Set(rides.map(r => r.id)).size, 5);
    for (const ride of rides) {
      validateInput(JSON.parse(String(store.db.prepare('SELECT data FROM rides WHERE id=?').get(ride.id)!.data)));
      assert.equal(ride.timezone, 'Europe/London');
      assert.equal(store.db.prepare("SELECT count(*) AS n FROM history WHERE ride_id=? AND action='create'").get(ride.id)!.n, 1);
      const link = store.db.prepare('SELECT * FROM import_rows WHERE ride_id=?').get(ride.id)!;
      assert.ok(link && link.sheet_name && Number(link.sheet_row) > 0);
    }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A29: commit writes zero field_decisions rows even with evidence.finalize wired as afterSave', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-fd-')); const store = new Store(root);
  try {
    const intake = new Intake(store), evidence = new Evidence(store, intake);
    store.afterSave = r => evidence.finalize(r);
    const wb = new WorkbookImport(store);
    wb.commit(wb.preview(sixTabWorkbook()).token, true, '');
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM field_decisions').get()!.n, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A48: a failure injected on the last ride rolls the batch back to zero', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-a48-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    const buffer = sixTabWorkbook();
    const token = wb.preview(buffer).token;
    const entry = wb.staging.get(token)!;
    const lastRow = entry.tabs.flatMap(t => t.rows).pop()!;
    lastRow.mapped = { ...lastRow.mapped, trip_date: 'not-a-date' };
    assert.throws(() => wb.commit(token, true, ''), ValidationError);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM rides').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_rows').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_variance').get()!.n, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM import_sources').get()!.n, 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A36: summarize fields match except drafts, which rise by the imported count', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-sum-')); const store = new Store(root);
  try {
    store.save({ ...blankRide(), trip_date: '2026-10-06', pickup_time: '09:30:00', financial_basis: 'worksheet_cash_plus_credit', cash_collected_paisa: 50000, uber_credit_paisa: 0, tips_paisa: 4000, commission_paisa: 5000, pass_charge_paisa: 0, financial_confirmed: true }, 'reviewed');
    const before = summarize(store.list());
    const wb = new WorkbookImport(store);
    const result = wb.commit(wb.preview(sixTabWorkbook()).token, true, '');
    const after = summarize(store.list());
    assert.equal(after.count, before.count); assert.equal(after.cash, before.cash); assert.equal(after.credit, before.credit);
    assert.equal(after.tips, before.tips); assert.equal(after.deductions, before.deductions); assert.equal(after.including, before.including);
    assert.equal(after.excluding, before.excluding); assert.equal(after.distance_meters, before.distance_meters);
    assert.equal(after.drafts, before.drafts + result.imported);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('A36: the variance report has defect rows and exact per-tab totals with no tolerance', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-a36-')); const store = new Store(root);
  try {
    // Two rows whose workbook-stated net total is one paisa above the app recalculation: a single-paisa gap is a variance.
    const first = row({ B: 1, C: 46325, F: 'Tejgaon', I: 1000, J: 0, K: 1000, L: 0, N: 'Cash', O: 0, P: 1000 });
    const second = row({ B: 2, C: 46326, F: 'Tejgaon', I: 500, J: 1, K: 499, L: 0, N: 'Cash', O: 0, P: 499.01 });
    // A33 shared-formula row-mismatch master embedded in October's ledger; A34 plain cross-tab; A35 embedded literal + typed literal.
    const oct = sheetXmlOf([HEAD_A, first, second])
      .replace('<c r="K3"><v>499</v></c>', '<c r="K3"><f t="shared" ref="K3:K7" si="0">I2-J2</f><v>499</v></c>')
      .replace('</sheetData>', `<row r="78"><c r="P78"><f>'August-2026'!Q81</f><v>1</v></c></row><row r="80"><c r="Q80"><f>I80-J80</f><v>1</v></c></row></sheetData>`);
    const aug = sheetXmlOf([HEAD_A, first])
      .replace('</sheetData>', `<row r="55"><c r="O55"><f>734.81-654.82</f><v>79.99</v></c></row><row r="80"><c r="Q80"><v>0</v></c></row></sheetData>`);
    const buffer = syntheticWorkbook({ 'October-2026': oct, 'August-2026': aug });
    const wb = new WorkbookImport(store);
    const preview = wb.preview(buffer);
    const kinds = preview.defects.map(d => d.kind).sort();
    assert.ok(kinds.includes('row-mismatch'), JSON.stringify(kinds));
    assert.ok(kinds.includes('cross-tab-carry-forward'), JSON.stringify(kinds));
    assert.ok(kinds.includes('embedded-numeric-literal'), JSON.stringify(kinds));
    assert.ok(kinds.includes('typed-literal-where-sibling-has-formula'), JSON.stringify(kinds));
    const result = wb.commit(preview.token, true, '');
    const report = wb.report();
    assert.equal(report.tabs.length, 2);
    const october = report.tabs.find(t => t.sheet === 'October-2026')!;
    assert.equal(october.appTotalPaisa, 149900);
    assert.equal(october.statedPaisa, 149901);
    assert.equal(october.differencePaisa, -1);
    assert.equal(october.verdict, 'variance'); // one paisa is a variance, not a match.
    assert.equal(report.variance.filter(v => v.verdict === 'defect').length, preview.defects.length);
    assert.ok(report.variance.some(v => v.sheet_name === 'October-2026' && v.metric === 'income_excluding_tips' && v.verdict === 'variance'));
    assert.equal(result.imported, 3);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test('report() defaults to the most recent source and validates the id', () => {
  const root = mkdtempSync(join(tmpdir(), 'uber-wb-report-')); const store = new Store(root);
  try {
    const wb = new WorkbookImport(store);
    const first = wb.commit(wb.preview(sixTabWorkbook()).token, true, '');
    const second = wb.commit(wb.preview(sixTabWorkbook()).token, true, 'second run');
    assert.equal(wb.report().source.id, second.sourceId);
    assert.equal(wb.report(first.sourceId).source.id, first.sourceId);
    assert.throws(() => wb.report('not-a-uuid'), ValidationError);
    assert.throws(() => wb.report(crypto.randomUUID()), /No workbook import found/);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});
