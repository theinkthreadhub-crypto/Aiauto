import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideOnClose } from '../src/reconnect.js';

test('401 logged out → clear session, quick restart for new QR', () => {
  assert.deepEqual(decideOnClose(401), { status: 'logged_out', clearSession: true, delayMs: 1000 });
});
test('515 restart required → immediate reconnect, keep session', () => {
  const d = decideOnClose(515);
  assert.equal(d.clearSession, false);
  assert.equal(d.delayMs, 0);
});
test('440 replaced / 403 forbidden → keep session, long wait', () => {
  for (const c of [440, 403]) {
    const d = decideOnClose(c);
    assert.equal(d.clearSession, false);
    assert.ok(d.delayMs >= 60_000);
  }
});
test('temporary codes never clear session and back off up to 60s', () => {
  for (const c of [408, 428, 500, 503, undefined]) assert.equal(decideOnClose(c).clearSession, false);
  assert.equal(decideOnClose(408, 0).delayMs, 2000);
  assert.equal(decideOnClose(408, 3).delayMs, 16000);
  assert.equal(decideOnClose(408, 20).delayMs, 60000);
});
