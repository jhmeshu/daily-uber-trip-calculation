export const financialFields = ['cash_collected_paisa', 'uber_credit_paisa', 'tips_paisa', 'commission_paisa', 'pass_charge_paisa'] as const;
export type MoneyField = typeof financialFields[number];
export const paymentMethods = ['Cash', 'bKash', 'Other', 'Unknown'] as const;
export const serviceTypes = ['Uber X', 'Uber Premium', 'Other', 'Unknown'] as const;
export const bases = ['worksheet_cash_plus_credit', 'already_net', 'unresolved'] as const;
export type RideInput = Record<MoneyField, number | null> & {
  trip_date: string | null; pickup_time: string | null; timezone: string;
  duration_seconds: number | null; distance_meters: number | null;
  pickup_location: string | null; drop_location: string | null;
  payment_method: typeof paymentMethods[number]; service_type: typeof serviceTypes[number];
  financial_basis: typeof bases[number]; reported_net_paisa: number | null;
  comments: string; adjustment_reason: string; financial_confirmed: boolean;
};
export type Ride = RideInput & {
  id: string; status: 'draft' | 'reviewed' | 'deleted'; revision: number;
  created_at: string; updated_at: string; reviewed_at: string | null;
  deleted_at: string | null; previous_status: 'draft' | 'reviewed' | null;
};
export const blankRide = (): RideInput => ({
  trip_date: null, pickup_time: null, timezone: 'Asia/Dhaka', duration_seconds: null,
  distance_meters: null, pickup_location: null, drop_location: null,
  cash_collected_paisa: null, uber_credit_paisa: null, tips_paisa: null,
  commission_paisa: null, pass_charge_paisa: null, reported_net_paisa: null,
  payment_method: 'Unknown', service_type: 'Unknown', financial_basis: 'unresolved',
  comments: '', adjustment_reason: '', financial_confirmed: false,
});
export class ValidationError extends Error {}
export function parseDecimal(raw: string, places: number): number | null {
  const value = raw.trim();
  if (!value) return null;
  if (!new RegExp(`^-?\\d+(?:\\.\\d{1,${places}})?$`).test(value)) throw new ValidationError(`Use a number with at most ${places} decimal places.`);
  const [whole, fraction = ''] = value.replace(/^-/, '').split('.');
  const result = BigInt(whole!) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, '0'));
  const signed = value.startsWith('-') ? -result : result;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new ValidationError('Amount is too large.');
  return Number(signed);
}
export const parseMoney = (raw: string) => parseDecimal(raw, 2);
export function decimal(value: number | null, places = 2): string {
  if (value === null) return '';
  const v = BigInt(value); const abs = v < 0n ? -v : v; const scale = 10n ** BigInt(places);
  return `${v < 0n ? '-' : ''}${abs / scale}.${String(abs % scale).padStart(places, '0')}`;
}
export const money = (value: number | null) => value === null ? 'Unknown' : `BDT ${decimal(value)}`;
export function formatDuration(seconds: number | null): string {
  if(seconds===null)return '';
  return [Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
export function parseDuration(raw:string):number|null {
  const value=raw.trim();if(!value)return null;
  const match=value.match(/^(\d{2,}):([0-5]\d):([0-5]\d)$/);
  if(!match)throw new ValidationError('Use duration as hh:mm:ss, for example 00:53:34.');
  const seconds=Number(match[1])*3600+Number(match[2])*60+Number(match[3]);
  if(!Number.isSafeInteger(seconds)||seconds>1_000_000_000_000)throw new ValidationError('Duration is too large.');
  return seconds;
}
export const cleanPickup=(value:string)=>value.replace(/^\s*\?+\s*/,'');
export const cashNet=(r:Pick<RideInput,'cash_collected_paisa'|'tips_paisa'>):number|null=>r.cash_collected_paisa===null||r.tips_paisa===null?null:r.cash_collected_paisa-r.tips_paisa;
export function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '1900-01-01' && value <= '9999-12-31' && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
const inputKeys = Object.keys(blankRide());
export function validateInput(raw: unknown): RideInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ValidationError('Expected a ride object.');
  const obj = raw as Record<string, unknown>;
  if (Object.keys(obj).some(k => !inputKeys.includes(k)) || inputKeys.some(k => !(k in obj))) throw new ValidationError('Unexpected or missing ride fields. Calculated totals are server-owned.');
  const r = obj as unknown as RideInput;
  for (const key of [...financialFields, 'reported_net_paisa', 'distance_meters', 'duration_seconds'] as const) {
    const v = r[key];
    if (v !== null && (!Number.isSafeInteger(v) || Math.abs(v) > 1_000_000_000_000)) throw new ValidationError(`${key}: expected integer or null within the supported range.`);
  }
  for (const key of ['distance_meters', 'duration_seconds'] as const) if (r[key] !== null && r[key]! < 0) throw new ValidationError(`${key} cannot be negative.`);
  if (r.trip_date !== null && (typeof r.trip_date !== 'string' || !validDate(r.trip_date))) throw new ValidationError('Use a valid trip date.');
  if (r.pickup_time !== null && (typeof r.pickup_time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(r.pickup_time))) throw new ValidationError('Use a valid pickup time (HH:mm:ss).');
  if (typeof r.timezone !== 'string') throw new ValidationError('Invalid timezone.');
  try { new Intl.DateTimeFormat('en', { timeZone: r.timezone }); } catch { throw new ValidationError('Invalid timezone.'); }
  for (const key of ['pickup_location', 'drop_location', 'comments', 'adjustment_reason'] as const) {
    if ((r[key] === null && (key === 'pickup_location' || key === 'drop_location'))) continue;
    if (typeof r[key] !== 'string' || r[key]!.length > 10_000) throw new ValidationError(`${key}: expected text up to 10,000 characters.`);
  }
  if (!paymentMethods.includes(r.payment_method) || !serviceTypes.includes(r.service_type) || !bases.includes(r.financial_basis)) throw new ValidationError('Invalid payment method, service type or financial basis.');
  if (typeof r.financial_confirmed !== 'boolean') throw new ValidationError('Financial confirmation must be explicit.');
  return structuredClone(r);
}
export function financialSignature(r: RideInput): string {
  return JSON.stringify([...financialFields.map(k => r[k]), r.financial_basis, r.reported_net_paisa, r.adjustment_reason]);
}
export function calculate(r: RideInput) {
  if (r.financial_basis !== 'worksheet_cash_plus_credit') return { status: 'unresolved' as const, including: null, excluding: null, warnings: [] as string[] };
  if (financialFields.some(k => r[k] === null)) return { status: 'incomplete' as const, including: null, excluding: null, warnings: [] as string[] };
  const receipts = r.cash_collected_paisa! + r.uber_credit_paisa!;
  const including = receipts - r.commission_paisa! - r.pass_charge_paisa!;
  const excluding = including - r.tips_paisa!;
  const warnings: string[] = [];
  if (financialFields.some(k => r[k]! < 0)) warnings.push('A financial amount is negative.');
  if (r.tips_paisa! > receipts) warnings.push('Tips exceed receipts.');
  if (including < 0 || excluding < 0) warnings.push('Income is negative.');
  return { status: 'complete' as const, including, excluding, warnings };
}
export function reviewErrors(r: RideInput): string[] {
  const c = calculate(r); const errors: string[] = [];
  if (!r.trip_date || !r.pickup_time) errors.push('Trip date and pickup time are required for review.');
  if (c.status !== 'complete') errors.push('Review requires worksheet-basis receipts and all five known financial amounts. Enter zero only when confirmed.');
  if (!r.financial_confirmed) errors.push('Confirm the current financial amounts and worksheet interpretation.');
  if (c.warnings.length && !r.adjustment_reason.trim()) errors.push('Explain the intentional adjustment before review.');
  return errors;
}
export type Filters = { month?: string; from?: string; to?: string; payment?: string; service?: string; status?: string; search?: string };
export function parseFilters(params: URLSearchParams): Filters {
  const f: Filters = {};
  for (const key of ['month', 'from', 'to', 'payment', 'service', 'status', 'search'] as const) {
    const v = params.get(key); if (v) f[key] = v;
  }
  if (f.month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(f.month)) throw new ValidationError('Invalid month.');
  if ([f.from, f.to].some(v => v && !validDate(v))) throw new ValidationError('Invalid date range.');
  if (f.from && f.to && f.from > f.to) throw new ValidationError('Start date must precede end date.');
  if (f.payment && !paymentMethods.includes(f.payment as RideInput['payment_method'])) throw new ValidationError('Invalid payment filter.');
  if (f.service && !serviceTypes.includes(f.service as RideInput['service_type'])) throw new ValidationError('Invalid service filter.');
  if (f.status && !['draft', 'reviewed', 'deleted'].includes(f.status)) throw new ValidationError('Invalid status filter.');
  if (f.search && f.search.length > 1000) throw new ValidationError('Search is too long.');
  return f;
}
export function matches(r: Ride, f: Filters) {
  if (f.status ? r.status !== f.status : r.status === 'deleted') return false;
  if (f.month && !r.trip_date?.startsWith(f.month)) return false;
  if (f.from && (!r.trip_date || r.trip_date < f.from)) return false;
  if (f.to && (!r.trip_date || r.trip_date > f.to)) return false;
  if (f.payment && r.payment_method !== f.payment) return false;
  if (f.service && r.service_type !== f.service) return false;
  if (f.search && ![r.pickup_location, r.drop_location, r.comments].join(' ').toLocaleLowerCase().includes(f.search.toLocaleLowerCase())) return false;
  return true;
}
export function summarize(rides: Ride[]) {
  const reviewed = rides.filter(r => r.status === 'reviewed' && reviewErrors(r).length === 0);
  const sum = (fn: (r: Ride) => number) => {
    const total = reviewed.reduce((acc, r) => acc + BigInt(fn(r)), 0n);
    if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) throw new ValidationError('Summary exceeds supported numeric range; narrow the selection.');
    return Number(total);
  };
  return { count: reviewed.length, measured_count: reviewed.filter(r => r.distance_meters !== null).length,
    distance_meters: sum(r => r.distance_meters ?? 0), missing_route: reviewed.filter(r => !r.pickup_location || !r.drop_location).length,
    cash: sum(r => r.cash_collected_paisa!), credit: sum(r => r.uber_credit_paisa!), tips: sum(r => r.tips_paisa!),
    deductions: sum(r => r.commission_paisa! + r.pass_charge_paisa!), including: sum(r => calculate(r).including!), excluding: sum(r => calculate(r).excluding!),
    drafts: rides.filter(r => r.status === 'draft').length };
}
