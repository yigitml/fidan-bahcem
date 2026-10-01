import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const origin = process.argv[2] || 'http://127.0.0.1:3000';
const expectedKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY;
assert.ok(expectedKey, 'Provide the expected synthetic runtime public key.');
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
  assert.equal(body.config.enabled, true);
  assert.equal(body.config.webApiKey, expectedKey, 'The compiled app must read the runtime key rather than its build key.');
  for (const secret of [process.env.REVENUECAT_SECRET_API_KEY, process.env.REVENUECAT_WEBHOOK_SECRET]) {
    if (secret) assert.equal(JSON.stringify(body).includes(secret), false);
  }
  console.log('PASS: compiled billing configuration uses the runtime public key and excludes server secrets.');
} finally {
  const deleted = await fetch(origin + '/api/store/delete', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ password }),
  });
  assert.equal(deleted.status, 200, 'Disposable runtime-check account must be removed.');
}
