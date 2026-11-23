import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proto } from 'baileys';
import { useSupabaseAuthState, AuthStoreError, LEASE_ID } from '../src/supabaseAuthState.js';
import { createFakeSupabase } from './fakeSupabase.js';

const fast = { retryBaseMs: 1 };

test('first run: no rows → new creds, nothing written until saveCreds', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  assert.equal(a.isNew, true);
  assert.equal(a.state.creds.registered, false);
  assert.equal(db.rows.size, 0);
  await a.saveCreds();
  assert.ok(db.rows.has('creds'));
});

test('restart: creds + all Signal key types round-trip with binary data intact', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  a.state.creds.registered = true;
  await a.saveCreds();
  await a.state.keys.set({
    'pre-key': { 1: { public: Buffer.from([1, 2, 3]), private: Buffer.from([4, 5]) } },
    session: { 'abc.0': new Uint8Array([9, 8, 7]) },
    'sender-key': { g1: new Uint8Array([6]) },
    'app-state-sync-key': { k1: { keyData: Buffer.from([1]), timestamp: 5 } },
    'lid-mapping': { m1: '123@lid' },
    'device-list': { u1: ['0', '1'] },
    tctoken: { t1: { token: Buffer.from([2, 2]), timestamp: '10' } },
  });

  const b = await useSupabaseAuthState(db, fast); // simulated restart
  assert.equal(b.isNew, false);
  assert.equal(b.state.creds.registered, true);
  assert.deepEqual(b.state.creds.noiseKey, a.state.creds.noiseKey);
  assert.ok(Buffer.isBuffer(b.state.creds.noiseKey.private));

  const pk = await b.state.keys.get('pre-key', ['1', '2']);
  assert.deepEqual([...pk['1'].public], [1, 2, 3]);
  assert.equal(pk['2'], null);
  assert.deepEqual([...(await b.state.keys.get('session', ['abc.0']))['abc.0']], [9, 8, 7]);
  assert.deepEqual([...(await b.state.keys.get('sender-key', ['g1'])).g1], [6]);
  const sk = (await b.state.keys.get('app-state-sync-key', ['k1'])).k1;
  assert.ok(sk instanceof proto.Message.AppStateSyncKeyData);
  assert.deepEqual([...sk.keyData], [1]);
  assert.equal((await b.state.keys.get('lid-mapping', ['m1'])).m1, '123@lid');
  assert.deepEqual((await b.state.keys.get('device-list', ['u1'])).u1, ['0', '1']);
  assert.deepEqual([...(await b.state.keys.get('tctoken', ['t1'])).t1.token], [2, 2]);
});

test('key updates and deletions persist', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  await a.state.keys.set({ session: { s: Buffer.from([1]) } });
  await a.state.keys.set({ session: { s: Buffer.from([2]) } });
  assert.deepEqual([...(await a.state.keys.get('session', ['s'])).s], [2]);
  await a.state.keys.set({ session: { s: null } });
  assert.equal((await a.state.keys.get('session', ['s'])).s, null);
  assert.ok(!db.rows.has('session-s'));
});

test('large batches are chunked', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  const keys = {};
  for (let i = 0; i < 250; i++) keys[i] = { public: Buffer.from([i % 256]) };
  await a.state.keys.set({ 'pre-key': keys });
  const got = await a.state.keys.get('pre-key', Object.keys(keys));
  assert.equal(Object.values(got).filter(Boolean).length, 250);
  assert.equal(db.calls.upsert, 3);
});

test('DB read failure on load throws — never silently creates a fresh session', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  a.state.creds.registered = true;
  await a.saveCreds();
  const before = db.rows.get('creds').value;

  db.failNext('select');
  let flagged = false;
  await assert.rejects(useSupabaseAuthState(db, { ...fast, onStoreError: () => (flagged = true) }), AuthStoreError);
  assert.ok(flagged);
  assert.equal(db.rows.get('creds').value, before, 'saved creds untouched');

  const b = await useSupabaseAuthState(db, fast); // DB back
  assert.equal(b.state.creds.registered, true);
});

test('key read failure propagates (no null that could reset a session)', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  await a.state.keys.set({ session: { s: Buffer.from([1]) } });
  db.failNext('select');
  await assert.rejects(a.state.keys.get('session', ['s']), AuthStoreError);
});

test('temporary write failure is retried and data persists', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  db.failNext('upsert', 2);
  await a.state.keys.set({ session: { s: Buffer.from([5]) } });
  assert.deepEqual([...(await a.state.keys.get('session', ['s'])).s], [5]);
});

test('persistent write failure surfaces an error after retries', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, { retries: 2, retryBaseMs: 1 });
  db.failNext('upsert', 10);
  await assert.rejects(a.saveCreds(), AuthStoreError);
  // queue still works afterwards
  db.failures?.splice?.(0);
});

test('writes are serialized: set then delete same key in parallel → deleted', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  await Promise.all([
    a.state.keys.set({ session: { s: Buffer.from([1]) } }),
    a.state.keys.set({ session: { s: null } }),
  ]);
  assert.equal((await a.state.keys.get('session', ['s'])).s, null);
});

test('clear() (logged out) wipes session but keeps the lease row', async () => {
  const db = createFakeSupabase();
  db.rows.set(LEASE_ID, { id: LEASE_ID, value: 'owner-1', updated_at: new Date().toISOString() });
  const a = await useSupabaseAuthState(db, fast);
  await a.saveCreds();
  await a.state.keys.set({ session: { s: Buffer.from([1]) } });
  await a.clear();
  assert.deepEqual([...db.rows.keys()], [LEASE_ID]);
  const b = await useSupabaseAuthState(db, fast);
  assert.equal(b.isNew, true, 'next start needs a new QR');
});

test('detach() drops late writes from an old socket', async () => {
  const db = createFakeSupabase();
  const a = await useSupabaseAuthState(db, fast);
  a.detach();
  await a.saveCreds();
  await a.state.keys.set({ session: { s: Buffer.from([1]) } });
  assert.equal(db.rows.size, 0);
});
