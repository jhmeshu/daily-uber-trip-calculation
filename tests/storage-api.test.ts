import { test } from 'node:test';
import { request as httpRequest } from 'node:http';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, migrate } from '../server/store.ts';
import { createApp } from '../server/app.ts';
import { Intake } from '../server/intake.ts';
import { Evidence } from '../server/evidence.ts';
import { blankRide } from '../src/shared/domain.ts';
function sessionPayload(cash: string) { return { form: Object.fromEntries(Object.entries(blankRide()).map(([key, value]) => [key, key === 'cash_collected_paisa' ? cash : typeof value === 'boolean' ? value : value === null ? '' : String(value)])) }; }
function complete() { return { ...blankRide(), trip_date: '2026-10-06', pickup_time: '09:30:00', financial_basis: 'worksheet_cash_plus_credit' as const, cash_collected_paisa: 50000, uber_credit_paisa: 0, tips_paisa: 4000, commission_paisa: 5000, pass_charge_paisa: 0, financial_confirmed: true }; }
test('A01/A13/A19: durable sessions, atomic revisions/history, trash and restore', () => {
  const dir = mkdtempSync(join(tmpdir(), 'uber-store-')); let store = new Store(dir);
  try {
    const r = store.save(complete(), 'reviewed'); const id = randomUUID();
    store.saveSession(id, sessionPayload('700.00'), r.id, r.revision, 0);
    assert.equal(store.get(r.id).cash_collected_paisa, 50000);
    store.close(); store = new Store(dir);
    assert.equal(store.get(r.id).cash_collected_paisa, 50000); assert.equal(store.getSession(id)!.payload !== null, true);
    const corrected = store.save({ ...complete(), cash_collected_paisa: 60000 }, 'reviewed', r.id, r.revision, id);
    assert.equal(corrected.revision, 2); assert.equal(store.history(r.id).length, 2); assert.equal(store.getSession(id), undefined);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM confirmations').get()!.count, 2);
    assert.throws(() => store.save(complete(), 'reviewed', r.id, 1));
    assert.equal(store.get(r.id).cash_collected_paisa, 60000);
    assert.throws(() => store.save({ ...complete(), financial_confirmed: false }, 'reviewed', r.id, 2));
    assert.equal(store.history(r.id).length, 2);
    const deleted = store.change(r.id, 'trash', 2)!;
    assert.equal(store.list().length, 0); assert.equal(deleted.previous_status, 'reviewed'); assert.ok(deleted.deleted_at);
    const restored = store.change(r.id, 'restore', 3)!; assert.equal(restored.status, 'reviewed'); assert.equal(restored.deleted_at, null);
    assert.throws(() => store.change(r.id, 'purge', 4));
    store.change(r.id, 'trash', 4); store.change(r.id, 'purge', 5); assert.throws(() => store.get(r.id)); assert.equal(store.db.prepare('SELECT count(*) AS count FROM history').get()!.count, 0);
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM confirmations').get()!.count, 0);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('migration rollback preserves schema/version and refuses newer databases', () => {
  const db = new DatabaseSync(':memory:');
  try {
    migrate(db, ['CREATE TABLE original (id INTEGER); INSERT INTO original VALUES (42);']);
    assert.throws(() => migrate(db, ['unused', 'CREATE TABLE partial (id INTEGER); INSERT INTO absent VALUES (1);']));
    assert.equal(db.prepare('PRAGMA user_version').get()!.user_version, 1); assert.equal(db.prepare('SELECT id FROM original').get()!.id, 42);
    assert.equal(db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='partial'").get()!.count, 0);
    assert.throws(() => migrate(db, []));
  } finally { db.close(); }
});
test('schema version 4 registers the three import tables with their exact columns and checks', () => {
  const directory = mkdtempSync(join(tmpdir(), 'uber-schema4-')); const store = new Store(directory);
  const now = '2026-10-06T09:30:00.000Z'; const source = randomUUID();
  const columns = (table: string) => store.db.prepare(`PRAGMA table_info(${table})`).all().map(c => String(c.name));
  const insertSource = (sha: string, bytes: number, tabs: string) => store.db.prepare('INSERT INTO import_sources VALUES (?,?,?,?,?,?,?)').run(source, 'ledger.xlsx', sha, bytes, tabs, now, 'imported once');
  const insertRow = (sheetRow: number, disposition: string, missing: string, raw: string, ride: string | null) => store.db.prepare('INSERT INTO import_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), source, 'July-2026', sheetRow, 'LAYOUT_B', raw, '{}', disposition, missing, ride, '', now);
  const insertVariance = (verdict: string, app: number | null, difference: number | null) => store.db.prepare('INSERT INTO import_variance VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(), source, 'July-2026', 'N10', 'commission_paisa', '12.68', '=K9', app, difference, verdict, '', now);
  try {
    assert.equal(store.db.prepare('PRAGMA user_version').get()!.user_version, 4);
    assert.deepEqual(columns('import_sources'), ['id', 'filename', 'sha256', 'bytes', 'detected_tabs', 'imported_at', 'note']);
    assert.deepEqual(columns('import_rows'), ['id', 'source_id', 'sheet_name', 'sheet_row', 'layout', 'raw_cells', 'mapped', 'disposition', 'missing_fields', 'ride_id', 'reason', 'created_at']);
    assert.deepEqual(columns('import_variance'), ['id', 'source_id', 'sheet_name', 'location', 'metric', 'workbook_reported', 'workbook_formula', 'app_value_paisa', 'difference_paisa', 'verdict', 'note', 'created_at']);
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.throws(() => migrate(store.db, [])); // user_version 4 is newer than the app.
    assert.throws(() => insertSource('a'.repeat(63), 4096, '["July-2026"]'));
    assert.throws(() => insertSource('a'.repeat(64), 0, '["July-2026"]'));
    assert.throws(() => insertSource('a'.repeat(64), 4096, 'not json'));
    insertSource('a'.repeat(64), 4096, '["July-2026"]');
    assert.throws(() => insertRow(0, 'imported', '[]', '{}', null));
    assert.throws(() => insertRow(10, 'bogus', '[]', '{}', null));
    assert.throws(() => insertRow(10, 'imported', '[]', 'not json', null));
    assert.throws(() => insertRow(10, 'imported', 'nope', '{}', null));
    assert.throws(() => insertRow(10, 'imported', '[]', '{}', randomUUID()));
    insertRow(9, 'needs_field', '["uber_credit_paisa"]', '{}', null);
    assert.throws(() => insertRow(9, 'imported', '[]', '{}', null)); // UNIQUE(source_id,sheet_name,sheet_row)
    insertVariance('not_comparable', null, null); // an absent amount is unknown, never zero.
    const absent = store.db.prepare('SELECT app_value_paisa, difference_paisa FROM import_variance WHERE verdict=?').get('not_comparable')!;
    assert.equal(absent.app_value_paisa, null); assert.equal(absent.difference_paisa, null);
    assert.throws(() => insertVariance('unknown_verdict', 0, 0));
    insertVariance('match', 1268, 0);
    const ride = store.save(blankRide(), 'draft');
    insertRow(10, 'imported', '[]', '{}', ride.id);
    assert.equal(store.db.prepare('SELECT ride_id FROM import_rows WHERE sheet_row=10').get()!.ride_id, ride.id);
    store.change(ride.id, 'trash', 1); store.change(ride.id, 'purge', 2);
    assert.equal(store.db.prepare('SELECT ride_id FROM import_rows WHERE sheet_row=10').get()!.ride_id, null); // ON DELETE SET NULL
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('save() with notify disabled writes the ride and its history event but no field decisions', () => {
  const directory = mkdtempSync(join(tmpdir(), 'uber-notify-')); const store = new Store(directory);
  try {
    const evidence = new Evidence(store, new Intake(store)); store.afterSave = ride => evidence.finalize(ride);
    const decisions = (id: string) => Number(store.db.prepare('SELECT count(*) AS count FROM field_decisions WHERE ride_id=?').get(id)!.count);
    const silent = store.save(complete(), 'draft', undefined, undefined, undefined, false);
    assert.equal(store.get(silent.id).status, 'draft'); assert.equal(store.history(silent.id).length, 1); assert.equal(decisions(silent.id), 0);
    const loud = store.save(complete(), 'draft');
    assert.ok(decisions(loud.id) > 0);
    assert.equal(Number(store.db.prepare("SELECT count(*) AS count FROM field_decisions WHERE origin='manual'").get()!.count), decisions(loud.id));
    assert.equal(store.save(complete(), 'draft', undefined, undefined, undefined, true).id === silent.id, false);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
test('A20: API rejects foreign origin, host, invalid fields and stale saves; filter/export consistency', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uber-api-')); const store = new Store(dir); const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, data?: unknown, method = 'POST', headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  try {
    assert.equal((await request('/api/rides', {}, 'POST', { Origin: 'http://evil.example' })).status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(base + '/api/rides', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(hostStatus, 403);
    assert.equal((await request('/api/rides', {}, 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    assert.equal((await (await fetch(base + '/api/health')).json()).schema_version, 4);
    assert.equal((await request('/api/rides', { input: complete(), status: 'draft', session_id: false })).status, 400);
    assert.equal((await request('/api/rides', { input: { ...complete(), total: 1 }, status: 'reviewed', session_id: null })).status, 400);
    assert.equal((await request('/api/rides', { input: { ...complete(), trip_date: '2026-99-99' }, status: 'reviewed', session_id: null })).status, 400);
    const response = await request('/api/rides', { input: complete(), status: 'reviewed', session_id: null }); assert.equal(response.status, 201); const ride = await response.json();
    assert.equal((await request(`/api/rides/${ride.id}`, { input: complete(), status: 'reviewed', revision: 0, session_id: null }, 'PUT')).status, 409);
    await request('/api/rides', { input: { ...complete(), trip_date: '2026-09-30' }, status: 'reviewed', session_id: null });
    await request('/api/rides', { input: blankRide(), status: 'draft', session_id: null });
    const data = await (await fetch(base + '/api/rides?month=2026-10')).json(); assert.equal(data.rides.length, 1); assert.equal(data.summary.excluding, 41000);
    const csv = await (await fetch(base + '/api/export?month=2026-10')).text(); assert.ok(csv.includes(ride.id)); assert.equal(csv.trim().split('\r\n').length, 2);
    assert.equal((await request(`/api/rides/${ride.id}/trash`, { revision: 1, confirmed: false })).status, 400);
    assert.equal((await request(`/api/rides/${ride.id}/trash`, { revision: 1, confirmed: true })).status, 200);
    assert.equal((await (await fetch(base + '/api/rides?month=2026-10')).json()).summary.count, 0);
    assert.equal((await request('/api/rides', { input: blankRide(), status: 'reviewed', session_id: null })).status, 400);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('A29: workbook routes hold the loopback guards and reject malformed commit bodies', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'uber-wb-guards-')); const store = new Store(dir); const server = createApp(store);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const request = (path: string, data?: unknown, method = 'POST', headers = {}) => fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: data === undefined ? undefined : JSON.stringify(data) });
  try {
    assert.equal((await request('/api/import/workbook/preview', {}, 'POST', { Origin: 'http://evil.example' })).status, 403);
    const hostStatus = await new Promise<number | undefined>((resolve, reject) => { const req = httpRequest(base + '/api/import/workbook/commit', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
    assert.equal(hostStatus, 403);
    assert.equal((await request('/api/import/workbook/commit', { token: randomUUID(), confirmed: true, reason: '' }, 'POST', { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
    // Missing confirmed violates exact()'s required key set.
    assert.equal((await request('/api/import/workbook/commit', { token: randomUUID(), reason: '' })).status, 400);
    // A client-supplied derived total is never accepted (invariant 4).
    assert.equal((await request('/api/import/workbook/commit', { token: randomUUID(), confirmed: true, reason: '', total: 1 })).status, 400);
    // binary() always buffers the raw request stream into a Buffer, so a JSON body can never arrive at the preview
    // handler as a non-Buffer: it reaches WorkbookImport.preview as Buffer bytes and is rejected by the container
    // inspector with a fixed ValidationError — 400 'Workbook ZIP is empty, invalid or exceeds 25 MB.' — with no
    // path, SQL text or driver message in the body. Task 8's e2e asserts this same 400 contract.
    const preview = await request('/api/import/workbook/preview', {}, 'POST');
    assert.equal(preview.status, 400);
    assert.equal((await preview.json()).error, 'Workbook ZIP is empty, invalid or exceeds 25 MB.');
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('failed history/session writes roll back without publishing partial changes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'uber-failure-')); const store = new Store(directory);
  try {
    const r = store.save(complete(), 'reviewed'); const sessionId = randomUUID();
    store.saveSession(sessionId, sessionPayload('600.00'), r.id, 1, 0);
    store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON history BEGIN SELECT RAISE(ABORT, 'injected storage failure'); END;");
    assert.throws(() => store.save({ ...complete(), cash_collected_paisa: 60000 }, 'reviewed', r.id, 1, sessionId));
    assert.equal(store.get(r.id).cash_collected_paisa, 50000); assert.equal(store.get(r.id).revision, 1); assert.equal(store.history(r.id).length, 1); assert.ok(store.getSession(sessionId));
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM confirmations').get()!.count, 1);
    store.db.exec("CREATE TRIGGER reject_session BEFORE UPDATE ON sessions BEGIN SELECT RAISE(ABORT, 'injected autosave failure'); END;");
    assert.throws(() => store.saveSession(sessionId, sessionPayload('700.00'), r.id, 1, 1));
    assert.deepEqual(store.getSession(sessionId)!.payload, sessionPayload('600.00')); assert.equal(store.getSession(sessionId)!.revision, 1);
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }); }
});
