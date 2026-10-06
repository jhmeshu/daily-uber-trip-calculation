import { calculate, decimal, cleanLocation, type Ride } from './domain.ts';
export const csvHeaders = ['id', 'status', 'calculation_status', 'trip_date', 'pickup_time', 'timezone', 'pickup_location', 'drop_location', 'distance_km', 'duration_seconds', 'payment_method', 'service_type', 'financial_basis', 'cash_collected_bdt', 'uber_credit_bdt', 'commission_bdt', 'pass_charge_bdt', 'tips_bdt', 'reported_net_bdt', 'income_excluding_tips_bdt', 'income_including_tips_bdt', 'financial_confirmed', 'adjustment_reason', 'comments', 'attachment_references', 'created_at', 'updated_at', 'reviewed_at'] as const;
function cell(value: string | number | null, text = true): string {
  let s = value === null ? '' : String(value);
  if (text && /^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export function exportCsv(rides: (Ride & {attachment_references?:string[]})[], includeDrafts = false): string {
  const lines = rides.filter(r => r.status === 'reviewed' || (includeDrafts && r.status === 'draft')).map(r => {
    const c = calculate(r);
    const values = [r.id, r.status, c.status, r.trip_date, r.pickup_time, r.timezone, r.pickup_location===null?null:cleanLocation(r.pickup_location), r.drop_location===null?null:cleanLocation(r.drop_location),
      decimal(r.distance_meters, 3), r.duration_seconds, r.payment_method, r.service_type, r.financial_basis,
      decimal(r.cash_collected_paisa), decimal(r.uber_credit_paisa), decimal(r.commission_paisa), decimal(r.pass_charge_paisa), decimal(r.tips_paisa), decimal(r.reported_net_paisa),
      decimal(c.excluding), decimal(c.including), String(r.financial_confirmed), r.adjustment_reason, r.comments, r.attachment_references?.join(';')??'', r.created_at, r.updated_at, r.reviewed_at];
    return values.map((v, i) => cell(v, ![8, 9, 13, 14, 15, 16, 17, 18, 19, 20].includes(i))).join(',');
  });
  return '\uFEFF' + [csvHeaders.join(','), ...lines].join('\r\n') + '\r\n';
}
