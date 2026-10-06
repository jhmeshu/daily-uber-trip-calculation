import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blankRide, calculate, decimal, formatDuration, parseDuration, cashNet, financialSignature, matches, parseFilters, parseMoney, reviewErrors, summarize, validateInput, type Ride } from '../src/shared/domain.ts';
import { exportCsv, csvHeaders } from '../src/shared/csv.ts';
export function complete() {
  return { ...blankRide(), trip_date: '2026-10-06', pickup_time: '09:30:00', financial_basis: 'worksheet_cash_plus_credit' as const,
    cash_collected_paisa: 50000, uber_credit_paisa: 0, tips_paisa: 4000, commission_paisa: 5000, pass_charge_paisa: 0, financial_confirmed: true };
}
function ride(overrides: Partial<Ride> = {}): Ride {
  return { ...complete(), id: 'e051523f-1204-4a74-8e7c-d7e517558dc1', status: 'reviewed', revision: 1, created_at: '2026-10-06T00:00:00Z', updated_at: '2026-10-06T00:00:00Z', reviewed_at: '2026-10-06T00:00:00Z', deleted_at: null, previous_status: null, ...overrides };
}
test('A04: unknown is distinct from explicit zero', () => {
  assert.equal(parseMoney('  '), null); assert.equal(parseMoney('0'), 0);
  const r = complete(); r.pass_charge_paisa = null as any;
  assert.equal(calculate(r).status, 'incomplete'); assert.equal(calculate(r).excluding, null); assert.ok(reviewErrors(r).length);
  r.pass_charge_paisa = 0; assert.deepEqual(reviewErrors(r), []);
});
test('A05 and A06: exact paisa calculations', () => {
  assert.deepEqual(calculate(complete()), { status: 'complete', including: 45000, excluding: 41000, warnings: [] });
  const r = { ...complete(), cash_collected_paisa: 0, uber_credit_paisa: parseMoney('280.10'), tips_paisa: 0, commission_paisa: 0 };
  assert.equal(calculate(r).excluding, 28010); assert.equal(calculate(r).including, 28010); assert.equal(decimal(28010), '280.10');
  assert.equal(parseMoney('-0.01'), -1); assert.equal(parseMoney('90071992547409.91'), Number.MAX_SAFE_INTEGER);
  assert.equal(decimal(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  for (const v of ['1.001', 'NaN', 'Infinity', '1e3', '2,000', '.', '90071992547409.92']) assert.throws(() => parseMoney(v));
});
test('A07/A08: already-net and periodic fees never become worksheet receipts/deductions', () => {
  const r = { ...blankRide(), financial_basis: 'already_net' as const, reported_net_paisa: 10000 };
  assert.equal(calculate(r).status, 'unresolved'); assert.equal(calculate(r).including, null); assert.ok(reviewErrors(r).length);
  assert.equal(blankRide().pass_charge_paisa, null);
  assert.throws(() => validateInput({ ...complete(), monthly_pass_paisa: 50000 }));
});
test('date/time, integer, enum and server-owned-total validation', () => {
  for (const trip_date of ['2026-02-29', '2026-99-99', '2026-04-31', '2026-10-6']) assert.throws(() => validateInput({ ...complete(), trip_date }));
  validateInput({ ...complete(), trip_date: '2024-02-29' });
  for (const patch of [{ pickup_time: '24:00:00' }, { cash_collected_paisa: 1.1 }, { distance_meters: -1 }, { financial_confirmed: 'true' }, { timezone: 'Unknown' }, { financial_basis: 'fake' }, { income: 1 }, { commission_paisa: undefined }]) assert.throws(() => validateInput({ ...complete(), ...patch }));
  assert.ok(reviewErrors({ ...complete(), pickup_time: null }).length);
  assert.ok(reviewErrors({ ...complete(), financial_confirmed: false }).length);
});
test('intentional adjustments need explanation and current financial confirmation', () => {
  const r = { ...complete(), cash_collected_paisa: -100, tips_paisa: 0 };
  assert.ok(calculate(r).warnings.length); assert.ok(reviewErrors(r).length);
  assert.deepEqual(reviewErrors({ ...r, adjustment_reason: 'Refund correction confirmed' }), []);
  assert.notEqual(financialSignature(r), financialSignature({ ...r, cash_collected_paisa: 0 }));
});
test('A12/A14: reviewed-only selection follows local month boundaries', () => {
  const rows = [ride(), ride({ status: 'draft' }), ride({ status: 'deleted' }), ride({ trip_date: '2026-09-30' }), ride({ trip_date: '2026-10-31', distance_meters: 0 }), ride({ trip_date: '2026-11-01' })];
  const selected = rows.filter(r => matches(r, parseFilters(new URLSearchParams('month=2026-10'))));
  const summary = summarize(selected);
  assert.equal(summary.count, 2); assert.equal(summary.drafts, 1); assert.equal(summary.excluding, 82000); assert.equal(summary.measured_count, 1); assert.equal(summary.distance_meters, 0); assert.equal(summary.missing_route, 2);
  assert.throws(() => parseFilters(new URLSearchParams('from=2026-10-02&to=2026-10-01')));
});
test('A15: CSV BOM, stable headers, Bangla, quoting, formula protection and blank/zero', () => {
  const r = ride({ pickup_location: 'ঢাকা, "Airport"\nGate 1', drop_location: ' \t=HYPERLINK("bad")', comments: '@SUM(1)', cash_collected_paisa: -100, adjustment_reason: 'Refund', pass_charge_paisa: 0 });
  const csv = exportCsv([r, ride({ status: 'draft', cash_collected_paisa: null })], true);
  assert.ok(csv.startsWith('\uFEFF' + csvHeaders.join(','))); assert.ok(csv.includes('"ঢাকা, ""Airport""\nGate 1"')); assert.ok(csv.includes("'@SUM(1)")); assert.ok(csv.includes("' \t=HYPERLINK")); assert.ok(csv.includes(',-1.00,0.00,50.00,0.00,40.00,'));
  assert.equal(exportCsv([ride({ status: 'draft' })]).split('\r\n').length, 2);
  assert.ok(!csv.includes('/Users/')); assert.ok(exportCsv([ride({ status: 'draft', cash_collected_paisa: null })], true).includes('worksheet_cash_plus_credit,,0.00'));
});

test('Duration uses hh:mm:ss and cash net excludes known tips exactly',()=>{
 assert.equal(formatDuration(3214),'00:53:34');assert.equal(parseDuration('00:53:34'),3214);assert.equal(formatDuration(2350),'00:39:10');assert.equal(parseDuration('25:00:01'),90001);assert.equal(formatDuration(0),'00:00:00');assert.equal(parseDuration(''),null);assert.equal(formatDuration(null),'');
 for(const value of ['53:34','00:60:00','00:00:60','-01:00:00','3214'])assert.throws(()=>parseDuration(value));
 assert.equal(cashNet({cash_collected_paisa:40738,tips_paisa:4000}),36738);assert.equal(cashNet({cash_collected_paisa:40738,tips_paisa:0}),40738);assert.equal(cashNet({cash_collected_paisa:40738,tips_paisa:null}),null);
});
