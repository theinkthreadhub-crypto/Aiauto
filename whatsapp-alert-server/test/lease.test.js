import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLease } from '../src/lease.js';
import { createFakeSupabase } from './fakeSupabase.js';

test('only one instance holds the lease; expiry and release hand it over', async () => {
  const db = createFakeSupabase();
  let t = Date.parse('2026-11-23T10:00:00Z');
  const now = () => t;
  const A = createLease(db, { owner: 'aaaa-1', ttlMs: 90_000, now });
  const B = createLease(db, { owner: 'bbbb-2', ttlMs: 90_000, now });

  assert.equal(await A.acquire(), true);
  assert.equal(await B.acquire(), false, 'B blocked while A active');
  t += 30_000;
  assert.equal(await A.acquire(), true, 'A renews');
  t += 60_000;
  assert.equal(await B.acquire(), false, 'still within TTL of renewal');
  t += 31_000;
  assert.equal(await B.acquire(), true, 'A stale → B takes over');
  assert.equal(await A.acquire(), false, 'A notices it lost the lease');

  await B.release();
  assert.equal(await A.acquire(), true, 'release lets A take it immediately');
});

test('release by a non-owner does nothing', async () => {
  const db = createFakeSupabase();
  const A = createLease(db, { owner: 'aaaa', ttlMs: 90_000 });
  const B = createLease(db, { owner: 'bbbb', ttlMs: 90_000 });
  await A.acquire();
  await B.release();
  assert.equal(await B.acquire(), false);
});

test('DB error during acquire throws (caller keeps current state)', async () => {
  const db = createFakeSupabase();
  const A = createLease(db, { owner: 'aaaa', ttlMs: 90_000 });
  db.failNext('update');
  await assert.rejects(A.acquire(), /lease acquire failed/);
});

test('rejects unsafe owner strings (PostgREST filter injection)', () => {
  assert.throws(() => createLease(createFakeSupabase(), { owner: 'x,value.neq.y' }));
});
