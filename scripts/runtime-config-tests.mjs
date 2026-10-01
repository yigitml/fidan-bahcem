import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const args = process.argv.slice(2);
const origin = args.find(arg => arg !== '--webhook-only') || 'http://127.0.0.1:3000';
const webhookOnly = args.includes('--webhook-only');
const expectedKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY;
if (!webhookOnly) assert.ok(expectedKey, 'Provide the expected synthetic runtime public key.');
const password = `Runtime-QA-${randomUUID()}!`;
const registered = await fetch(origin + '/api/store/register', {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Runtime configuration QA', email: `runtime-${randomUUID()}@example.invalid`, password }),
});
assert.equal(registered.status, 200);
const cookie = registered.headers.get('set-cookie')?.split(';')[0];
assert.ok(cookie);
try {
  const response = await fetch(origin + '/api/billing/status', { headers: { Cookie: cookie } });
  assert.equal(response.status, 200);
  const body = await response.json();
  if (webhookOnly) {
    assert.deepEqual(body.config, { enabled: false, environment: null, webApiKey: null, offeringId: null, allowedProductIds: [] });
    const event = { event: { id: randomUUID(), type: 'TEST', environment: 'SANDBOX', event_timestamp_ms: Date.now() } };
    const headers = { 'Content-Type': 'application/json' };
    const request = () => fetch(origin + '/api/billing/webhook', { method: 'POST', headers, body: JSON.stringify(event) });
    assert.equal((await request()).status, 401, 'The receiver still requires webhook authentication.');
    assert.ok(process.env.REVENUECAT_WEBHOOK_SECRET, 'Provide a synthetic webhook authorization secret.');
    headers.Authorization = `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}`;
    const delivered = await request();
    assert.equal(delivered.status, 200, 'Server-only billing configuration must accept an authenticated provider test event.');
    assert.deepEqual(await delivered.json(), { ok: true, replay: false, disposition: 'test' });
    const replay = await request();
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { ok: true, replay: true, disposition: 'test' });
  } else {
    assert.equal(body.config.enabled, true);
    assert.equal(body.config.webApiKey, expectedKey, 'The compiled app must read the runtime key rather than its build key.');
  }
  for (const secret of [process.env.REVENUECAT_SECRET_API_KEY, process.env.REVENUECAT_WEBHOOK_SECRET]) {
    if (secret) assert.equal(JSON.stringify(body).includes(secret), false);
  }
  console.log(webhookOnly ? 'PASS: compiled webhook-only configuration keeps checkout disabled, authenticates delivery and deduplicates retries.' : 'PASS: compiled billing configuration uses the runtime public key and excludes server secrets.');
} finally {
  const deleted = await fetch(origin + '/api/store/delete', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ password }),
  });
  assert.equal(deleted.status, 200, 'Disposable runtime-check account must be removed.');
}
