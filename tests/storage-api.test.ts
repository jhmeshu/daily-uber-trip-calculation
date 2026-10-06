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
