import { randomUUID } from 'node:crypto';
import { Store, requireId } from './store.ts';
import { hash } from './intake.ts';
import { readSheets, sharedFormulaGroups, plainFormulas, typedLiterals, formulaAddresses, classifyFormulaGroups, type FormulaClassification } from './workbook-container.ts';
import { ValidationError, validateInput, decimal, type RideInput } from '../src/shared/domain.ts';
import { detectLayout, isRideRow, mapRow, rideRows, worksheetTotal, layouts, type LayoutName, type SheetRow, type CellValue } from '../src/shared/workbook.ts';

// Staging bounds are net-new: Backups.pending is unbounded and only checks expiry at activate.
const MAX_STAGED = 5, MAX_STAGED_BYTES = 25_000_000, STAGING_TTL = 30 * 60 * 1000;
type Disposition = 'imported' | 'skipped' | 'needs_field';
type StagedRow = { sheetRow: number; layout: LayoutName; disposition: Disposition; missingFields: string[]; mapped: RideInput; cells: CellValue[]; warning: boolean };
type StagedTab = { sheet: string; layout: LayoutName; ledger: boolean; headerRow: number; rows: StagedRow[]; appTotalPaisa: number | null; statedPaisa: number | null; verdict: string; reason: string; excludedAbsent: number; comparable: boolean };
type StagedEntry = { token: string; sha256: string; bytes: number; buffer: Buffer; expires: number; tabs: StagedTab[]; defects: FormulaClassification[]; duplicate: { importedAt: string; rowCount: number } | null };

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const decodeEntities = (value: string) => value.replace(/&(?:amp|lt|gt|quot|apos);/g, m => ENTITIES[m]!);
// Cell values come straight off the worksheet XML so the synthetic fflate fixtures need no sharedStrings table.
function columnIndexOf(ref: string) { let index = 0; for (const c of ref.replace(/[0-9]/g, '').toUpperCase()) index = index * 26 + (c.charCodeAt(0) - 64); return index - 1; }
export function sheetRows(sheetXml: string, shared: string[]): SheetRow[] {
  const grid = new Map<number, CellValue[]>();
  for (const rowMatch of sheetXml.matchAll(/<row\b[^>]*?\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: CellValue[] = [];
    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1]!, inner = cellMatch[2] ?? '';
      const ref = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1]; if (!ref) continue;
      const type = /\bt="([^"]+)"/.exec(attributes)?.[1] ?? 'n';
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let value: CellValue = null;
      if (type === 's') value = raw === undefined ? null : (shared[Number(raw)] ?? null);
      else if (type === 'inlineStr') value = decodeEntities(/<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1] ?? '');
      else if (type === 'b') value = raw === '1';
      else if (type === 'str') value = raw === undefined ? null : decodeEntities(raw);
      else if (type === 'e') value = null;
      else value = raw === undefined || raw === '' ? null : Number(raw);
      cells[columnIndexOf(ref)] = value === undefined ? null : value;
    }
    grid.set(Number(rowMatch[1]), cells);
  }
  const max = grid.size ? Math.max(...grid.keys()) : 0;
  return Array.from({ length: max }, (_, i) => grid.get(i + 1) ?? []);
}

export class WorkbookImport {
  staging = new Map<string, StagedEntry>();
  constructor(public store: Store) {}
  timezone() { return JSON.parse(String(this.store.db.prepare("SELECT value FROM settings WHERE key='timezone'").get()!.value)) as string; }
  private existingSource(sha256: string) {
    const row = this.store.db.prepare('SELECT * FROM import_sources WHERE sha256=?').get(sha256); if (!row) return null;
    const count = this.store.db.prepare('SELECT count(*) AS n FROM import_rows WHERE source_id=?').get(row.id) as { n: number };
    return { importedAt: String(row.imported_at), rowCount: Number(count.n) };
  }
  private pruneStaged() {
    const now = Date.now();
    for (const [token, entry] of this.staging) if (entry.expires <= now) this.staging.delete(token);
    while (this.staging.size >= MAX_STAGED) this.staging.delete(this.staging.keys().next().value!);
  }
  private staged(token: string) { const entry = this.staging.get(token); if (!entry) throw new ValidationError('The workbook preview is unknown or was replaced.'); if (entry.expires <= Date.now()) { this.staging.delete(token); throw new ValidationError('The workbook preview expired. Upload it again.'); } return entry; }
  preview(buffer: Buffer) {
    const parsed = readSheets(buffer);
    if (buffer.length > MAX_STAGED_BYTES) throw new ValidationError('Workbook exceeds the 25 MB limit.');
    const sha256 = hash(buffer);
    const timezone = this.timezone();
    const siblingFormulas = new Map<string, Set<string>>();
    for (const sheet of parsed.sheets) for (const address of formulaAddresses(sheet.xml)) { let set = siblingFormulas.get(address); if (!set) siblingFormulas.set(address, set = new Set()); set.add(sheet.name); }
    const defects = parsed.sheets.flatMap(sheet => classifyFormulaGroups(sharedFormulaGroups(sheet.xml), sheet.name, { typedLiterals: typedLiterals(sheet.xml), siblingFormulas, plainFormulas: plainFormulas(sheet.xml) }));
    const duplicate = this.existingSource(sha256);
    // Rule reuse, not function reuse: evidence.candidates() is a per-row full-table scan with a
    // disjunction and a reviewed-only filter. The A44 conjunction is applied here against one snapshot.
    const existing = this.store.list();
    const identifiers = new Map(this.store.db.prepare('SELECT ride_id, identifier FROM trip_identifiers').all().map(r => [String(r.ride_id), String(r.identifier)]));
    // identifiers is hoisted for rule reuse; the A44 conjunction below deliberately excludes trip ids.
    const tabs = parsed.sheets.map(sheet => {
      const rows = sheetRows(sheet.xml, parsed.sharedStrings);
      const detected = detectLayout(rows);
      if (detected.layout === 'unrecognised') return { sheet: sheet.name, layout: 'unrecognised' as LayoutName, ledger: false, headerRow: 0, rows: [] as StagedRow[], appTotalPaisa: null, statedPaisa: null, verdict: 'not_comparable', reason: 'Tab is not a ride ledger.', excludedAbsent: 0, comparable: false } satisfies StagedTab;
      const layout = layouts[detected.layout];
      const stagedRows = rideRows(rows, layout, detected.headerRow).map(r => {
        const mapped = mapRow(r.cells, layout, timezone);
        const warning = existing.some(e => e.trip_date !== null && e.trip_date === mapped.input.trip_date && e.pickup_time !== null && e.pickup_time === mapped.input.pickup_time && e.distance_meters !== null && mapped.input.distance_meters !== null && e.distance_meters === mapped.input.distance_meters && e.cash_collected_paisa !== null && mapped.input.cash_collected_paisa !== null && e.cash_collected_paisa === mapped.input.cash_collected_paisa);
        return { sheetRow: r.row, layout: detected.layout, disposition: (mapped.missingFields.length ? 'needs_field' : 'imported') as Disposition, missingFields: mapped.missingFields, mapped: mapped.input, cells: r.cells as CellValue[], warning };
      });
      const total = worksheetTotal(stagedRows.map(r => r.mapped));
      const statedTotal = stagedRows.reduce<number | null>((acc, r) => r.mapped.reported_net_paisa === null ? acc : (acc ?? 0) + r.mapped.reported_net_paisa, null);
      const verdict = !total.comparable ? 'not_comparable' : statedTotal === null ? 'not_comparable' : total.totalPaisa === statedTotal ? 'match' : 'variance';
      const excludedAbsent = Object.values(total.excludedFields).reduce((sum, n) => sum + (n ?? 0), 0);
      return { sheet: sheet.name, layout: detected.layout, ledger: true, headerRow: detected.headerRow, rows: stagedRows, appTotalPaisa: total.totalPaisa, statedPaisa: statedTotal, verdict, reason: total.reason, excludedAbsent, comparable: total.comparable } satisfies StagedTab;
    });
    const token = randomUUID();
    this.pruneStaged();
    this.staging.set(token, { token, sha256, bytes: buffer.length, buffer, expires: Date.now() + STAGING_TTL, tabs, defects, duplicate });
    return { token, sha256, bytes: buffer.length, tabs, defects, duplicate };
}
  commit(token: string, confirmed: boolean, reason: unknown) {
    const entry = this.staged(token);
    if (confirmed !== true) throw new ValidationError('Confirm the import before committing.');
    if (typeof reason !== 'string') throw new ValidationError('Provide an import reason, empty when not a re-import.');
    if (hash(entry.buffer) !== entry.sha256) throw new ValidationError('The staged workbook no longer matches its preview.');
    const duplicate = this.existingSource(entry.sha256);
    if (duplicate && (confirmed !== true || !reason.trim())) throw new ValidationError('This workbook was imported before. Re-importing requires confirmation and a reason.');
    const sourceId = randomUUID();
    let imported = 0;
    this.store.transaction(() => {
      const now = new Date().toISOString();
      this.store.db.prepare('INSERT INTO import_sources VALUES (?,?,?,?,?,?,?)').run(sourceId, 'workbook.xlsx', entry.sha256, entry.bytes, JSON.stringify(entry.tabs.map(t => ({ sheet: t.sheet, layout: t.layout }))), now, reason);
      for (const tab of entry.tabs) {
        if (!tab.ledger) continue;
        for (const row of tab.rows) {
          const input = validateInput(structuredClone(row.mapped));
          let rideId: string | null = null;
          // notify:false — evidence.finalize fan-out would mislabel every workbook row 'manual'.
          const ride = this.store.save(input, 'draft', undefined, undefined, undefined, false);
          rideId = ride.id;
          imported++;
          this.store.db.prepare('INSERT INTO import_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), sourceId, tab.sheet, row.sheetRow, tab.layout, JSON.stringify(row.cells), JSON.stringify(input), row.disposition, JSON.stringify(row.missingFields), rideId, row.missingFields.length ? `Missing fields: ${row.missingFields.join(', ')}` : '', now);
        }
        for (const defect of entry.defects.filter(d => d.sheet === tab.sheet)) {
          this.store.db.prepare('INSERT INTO import_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), sourceId, defect.sheet, defect.range ?? defect.cell, defect.kind, null, null, null, null, 'defect', defect.detail, now);
        }
        this.store.db.prepare('INSERT INTO import_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), sourceId, tab.sheet, tab.sheet, 'income_excluding_tips', tab.statedPaisa === null ? null : decimal(tab.statedPaisa), null, tab.appTotalPaisa,     tab.statedPaisa === null ? null : tab.appTotalPaisa! - tab.statedPaisa, tab.verdict, tab.reason, now);
      }
    });
    return { sourceId, imported };
  }
  report(sourceId?: string) {
    if (sourceId !== undefined) requireId(sourceId);
    const source = sourceId === undefined
      ? this.store.db.prepare('SELECT * FROM import_sources ORDER BY imported_at DESC, rowid DESC LIMIT 1').get()
      : this.store.db.prepare('SELECT * FROM import_sources WHERE id=?').get(sourceId);
    if (!source) throw new ValidationError('No workbook import found.');
    const rows = this.store.db.prepare('SELECT * FROM import_rows WHERE source_id=? ORDER BY sheet_name, sheet_row').all(source.id);
    const byTab = new Map<string, RideInput[]>();
    for (const row of rows) { const input = validateInput(JSON.parse(String(row.mapped))); const list = byTab.get(String(row.sheet_name)) ?? []; list.push(input); byTab.set(String(row.sheet_name), list); }
    const tabs = [...byTab.entries()].map(([sheet, inputs]) => {
      const total = worksheetTotal(inputs);
      const statedTotal = inputs.reduce<number | null>((acc, r) => r.reported_net_paisa === null ? acc : (acc ?? 0) + r.reported_net_paisa, null);
      const verdict = !total.comparable ? 'not_comparable' : statedTotal === null ? 'not_comparable' : total.totalPaisa === statedTotal ? 'match' : 'variance';
      return { sheet, appTotalPaisa: total.totalPaisa, statedPaisa: statedTotal, differencePaisa: statedTotal === null ? null : total.totalPaisa - statedTotal, verdict, reason: total.reason, excludedAbsent: Object.values(total.excludedFields).reduce((sum, n) => sum + (n ?? 0), 0) };
    });
    const variance = this.store.db.prepare('SELECT * FROM import_variance WHERE source_id=? ORDER BY rowid').all(source.id);
    return { source: { id: String(source.id), filename: String(source.filename), sha256: String(source.sha256), bytes: Number(source.bytes), importedAt: String(source.imported_at), note: String(source.note) }, tabs, variance };
  }
}
