import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import type { KV } from '../lib/database';
import { digest } from '../lib/security';
import type { BillingSnapshot } from '../lib/revenuecat';

// Real in-memory Deno KV and provider mocks exist only inside this test process.
const deno = (globalThis as unknown as { Deno: { openKv(path?: string): Promise<KV & { close(): void }> } }).Deno;
const kv = await deno.openKv(':memory:');
Object.defineProperty(deno, 'openKv', { value: async () => kv, configurable: true });
const billing = await import('../lib/revenuecat');
const statusRoute = await import('../app/api/billing/status/route');
const syncRoute = await import('../app/api/billing/sync/route');
const webhookRoute = await import('../app/api/billing/webhook/route');
const userId = randomUUID();
const secondUser = randomUUID();
const sessionToken = 'a'.repeat(64);
const origin = 'http://localhost:3000';
const product = 'test-membership';
let providerCalls = 0;
let failures = 0;
let passed = 0;
const realFetch = globalThis.fetch;
type Subscriber = { request_date_ms: number; subscriber: Record<string, unknown> };
let provider: (id: string) => Response | Promise<Response> = id => Response.json(subscriber(id));
function subscriber(id: string = userId, options: { sandbox?: boolean; expires?: string | null; refunded?: boolean; cancelled?: boolean; grace?: string | null; purchasedAt?: string; originalId?: string } = {}): Subscriber {
  const purchaseDate = options.purchasedAt || new Date(Date.now() - 10_000).toISOString();
  const expiry = options.expires === undefined ? new Date(Date.now() + 3_600_000).toISOString() : options.expires;
  return { request_date_ms: Date.now(), subscriber: { original_app_user_id: options.originalId || id, entitlements: { garden: { product_identifier: product, purchase_date: purchaseDate, expires_date: expiry, grace_period_expires_date: options.grace || null } }, subscriptions: { [product]: { purchase_date: purchaseDate, expires_date: expiry, grace_period_expires_date: options.grace || null, is_sandbox: options.sandbox ?? true, refunded_at: options.refunded ? new Date().toISOString() : null, unsubscribe_detected_at: options.cancelled ? new Date().toISOString() : null, billing_issues_detected_at: options.grace ? new Date().toISOString() : null } }, non_subscriptions: {}, management_url: 'https://billing.revenuecat.com/manage/test' } };
}
function configure(environment = 'sandbox', key = 'rcb_sb_test-key') {
  process.env.APP_URL = origin;
  process.env.REVENUECAT_ENVIRONMENT = environment;
  process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = key;
  process.env.REVENUECAT_SECRET_API_KEY = 'sk_test-only-never-real';
  process.env.REVENUECAT_WEBHOOK_SECRET = 'test-only-webhook-auth';
  process.env.REVENUECAT_ALLOWED_PRODUCT_IDS = product;
  delete process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET;
  delete process.env.REVENUECAT_OFFERING_ID;
  delete process.env.REVENUECAT_MANAGEMENT_HOSTS;
}
async function clean() {
  for await (const entry of kv.list({ prefix: [] })) await kv.delete(entry.key);
  await kv.set(['user', userId], { id: userId, email: 'billing-test@example.invalid', name: 'Billing Test', createdAt: new Date().toISOString(), authVersion: 0 });
  await kv.set(['user', secondUser], { id: secondUser, email: 'billing-second@example.invalid', name: 'Second Billing', createdAt: new Date().toISOString(), authVersion: 0 });
  await kv.set(['session', digest(sessionToken)], { userId, authVersion: 0, createdAt: Date.now() });
  configure();
  providerCalls = 0;
  provider = id => Response.json(subscriber(id));
}
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  assert.ok(url.startsWith('https://api.revenuecat.com/v1/subscribers/'), `Unexpected network call: ${url}`);
  assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer sk_test-only-never-real');
  assert.equal(init?.cache, 'no-store');
  providerCalls++;
  return provider(decodeURIComponent(url.split('/').at(-1)!));
};
function request(path: string, body?: string, extra: Record<string, string> = {}, signedIn = true) {
  const headers = new Headers({ host: 'localhost:3000', origin, 'content-type': 'application/json', ...extra });
  if (signedIn) headers.set('cookie', `fb_session=${sessionToken}`);
  return new NextRequest(`${origin}${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body });
}
function event(type = 'RENEWAL', extra: Record<string, unknown> = {}) { return { api_version: '1.0', event: { id: randomUUID(), type, event_timestamp_ms: Date.now(), environment: 'SANDBOX', app_user_id: userId, original_app_user_id: userId, aliases: [userId], ...extra } }; }
async function rejectsStatus(action: Promise<unknown>, expected: number) {
  await assert.rejects(action, (error: unknown) => error instanceof billing.BillingError && error.status === expected);
}
async function test(name: string, action: () => Promise<void> | void) {
  await clean();
  try { await action(); passed++; console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}`, error); }
}
try {
  await test('configuration requires all app-specific values and separates SDK environments', () => {
    assert.equal(billing.billingPublicConfig().enabled, true);
    process.env.REVENUECAT_SECRET_API_KEY = '';
    assert.equal(billing.billingPublicConfig().enabled, false);
    configure('production');
    assert.equal(billing.billingPublicConfig().enabled, false);
    configure('production', 'rcb_live-key');
    assert.equal(billing.billingPublicConfig().enabled, true);
    process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY = 'rcb_bad key';
    assert.equal(billing.billingPublicConfig().enabled, false);
    configure(); process.env.REVENUECAT_ALLOWED_PRODUCT_IDS = '';
    assert.equal(billing.billingPublicConfig().enabled, false);
  });
  await test('management URLs reject scripts, lookalikes, credentials and unconfigured hosts', () => {
    for (const value of ['javascript:alert(1)', 'http://billing.revenuecat.com/', 'https://billing.revenuecat.com.evil.invalid/', 'https://user:pass@billing.revenuecat.com/', 'https://evil.invalid/']) assert.equal(billing.safeManagementUrl(value), null);
    assert.ok(billing.safeManagementUrl('https://billing.revenuecat.com/manage/test'));
    process.env.REVENUECAT_MANAGEMENT_HOSTS = 'portal.example.invalid';
    assert.ok(billing.safeManagementUrl('https://portal.example.invalid/manage'));
  });
  await test('server snapshot grants only allowlisted provider-verified purchases', async () => {
    const snapshot = await billing.syncBillingUser(userId);
    assert.equal(snapshot.entitlements[0].active, true);
    assert.equal(snapshot.entitlements[0].renews, true);
    assert.equal(snapshot.environment, 'sandbox');
    assert.equal(providerCalls, 1);
    assert.equal((await kv.get<BillingSnapshot>(['revenuecat', 'sandbox', userId])).value?.entitlements[0].productId, product);
  });
  await test('sandbox never grants a production purchase', async () => {
    provider = id => Response.json(subscriber(id, { sandbox: false }));
    assert.equal((await billing.syncBillingUser(userId)).entitlements.length, 0);
  });
  await test('disallowed products and mismatched entitlement purchase periods never grant access', async () => {
    provider = id => {
      const payload = subscriber(id);
      const entitlements = payload.subscriber.entitlements as Record<string, Record<string, unknown>>;
      entitlements.garden.purchase_date = new Date(Date.now() - 86_400_000).toISOString();
      entitlements.unconfigured = { ...entitlements.garden, product_identifier: 'other-product' };
      return Response.json(payload);
    };
    assert.equal((await billing.syncBillingUser(userId)).entitlements.length, 0);
  });
  await test('production never grants sandbox data', async () => {
    configure('production', 'rcb_live-key');
    assert.equal((await billing.syncBillingUser(userId)).entitlements.length, 0);
    assert.equal((await kv.get(['revenuecat', 'sandbox', userId])).value, null);
  });
  await test('expired, cancelled, refunded and grace-period subscriptions use provider authority', async () => {
    provider = id => Response.json(subscriber(id, { cancelled: true }));
    let snapshot = await billing.syncBillingUser(userId);
    assert.equal(snapshot.entitlements[0].active, true); assert.equal(snapshot.entitlements[0].renews, false);
    provider = id => Response.json(subscriber(id, { expires: new Date(Date.now() - 1_000).toISOString() }));
    snapshot = await billing.syncBillingUser(userId); assert.equal(snapshot.entitlements[0].active, false);
    provider = id => Response.json(subscriber(id, { expires: new Date(Date.now() - 1_000).toISOString(), grace: new Date(Date.now() + 60_000).toISOString() }));
    snapshot = await billing.syncBillingUser(userId); assert.equal(snapshot.entitlements[0].active, true); assert.equal(snapshot.entitlements[0].renews, true); assert.equal(snapshot.entitlements[0].billingIssue, true);
    provider = id => Response.json(subscriber(id, { refunded: true }));
    assert.equal((await billing.syncBillingUser(userId)).entitlements.length, 0);
  });
  await test('expired uncancelled Test Store periods stop reporting renewal in fresh and cached views', async () => {
    provider = id => Response.json(subscriber(id, { expires: new Date(Date.now() - 1_000).toISOString() }));
    const expired = await billing.syncBillingUser(userId);
    assert.equal(expired.entitlements[0].active, false);
    assert.equal(expired.entitlements[0].renews, false);
    provider = id => Response.json(subscriber(id));
    const saved = await billing.syncBillingUser(userId);
    assert.equal(saved.entitlements[0].active, true);
    assert.equal(saved.entitlements[0].renews, true);
    const realNow = Date.now;
    try {
      Date.now = () => realNow() + 7_200_000;
      const stored = await billing.storedBillingUser(userId);
      const exported = (await billing.exportBillingUser(userId)).sandbox;
      for (const current of [stored, exported]) {
        assert.equal(current?.entitlements[0].active, false);
        assert.equal(current?.entitlements[0].renews, false);
        assert.equal(current?.verifiedAt, saved.verifiedAt);
        assert.equal(current?.providerTimestamp, saved.providerTimestamp);
        assert.equal(current?.entitlements[0].purchasedAt, saved.entitlements[0].purchasedAt);
        assert.equal(current?.entitlements[0].expiresAt, saved.entitlements[0].expiresAt);
        assert.equal(current?.entitlements[0].accessUntil, saved.entitlements[0].accessUntil);
      }
      assert.deepEqual((await kv.get<BillingSnapshot>(['revenuecat', 'sandbox', userId])).value, saved);
    } finally { Date.now = realNow; }
  });
  await test('lifetime purchases and malformed provider entries cannot bypass filtering', async () => {
    provider = id => {
      const payload = subscriber(id, { expires: null });
      const purchaseDate = new Date(Date.now() - 5_000).toISOString();
      payload.subscriber.subscriptions = {};
      payload.subscriber.entitlements = { garden: { product_identifier: product, purchase_date: purchaseDate, expires_date: null } };
      payload.subscriber.non_subscriptions = { [product]: [null, 'bad', { id: 'receipt-1', purchase_date: purchaseDate, is_sandbox: true }, { id: 'refunded', purchase_date: purchaseDate, is_sandbox: true, refunded_at: new Date().toISOString() }] };
      return Response.json(payload);
    };
    const snapshot = await billing.syncBillingUser(userId);
    assert.equal(snapshot.entitlements[0].active, true); assert.equal(snapshot.entitlements[0].accessUntil, null);
    assert.deepEqual(snapshot.purchases.map(item => item.transactionId), ['receipt-1']);
  });
  await test('provider failures leave the last verified cache untouched', async () => {
    const old = await billing.syncBillingUser(userId);
    for (const response of [new Response('{}', { status: 503 }), new Response('not-json'), Response.json({ request_date_ms: Date.now(), subscriber: {} }), new Response('x'.repeat(1_048_577))]) {
      provider = () => response;
      await rejectsStatus(billing.syncBillingUser(userId), 503);
      assert.equal((await kv.get<BillingSnapshot>(['revenuecat', 'sandbox', userId])).value?.providerTimestamp, old.providerTimestamp);
    }
    provider = () => { throw new TypeError('network failed'); };
    await rejectsStatus(billing.syncBillingUser(userId), 503);
  });
  await test('future and missing provider timestamps cannot save unverifiable state', async () => {
    provider = id => { const payload = subscriber(id); payload.request_date_ms = Date.now() + 600_000; return Response.json(payload); };
    await rejectsStatus(billing.syncBillingUser(userId), 503);
    provider = id => { const payload = subscriber(id); payload.request_date_ms = 0; return Response.json(payload); };
    await rejectsStatus(billing.syncBillingUser(userId), 503);
    assert.equal((await kv.get(['revenuecat', 'sandbox', userId])).value, null);
  });
  await test('provider timestamps prevent a slower response from replacing newer state', async () => {
    const newer = subscriber(); newer.request_date_ms = Date.now() + 10_000;
    provider = () => Response.json(newer);
    const saved = await billing.syncBillingUser(userId);
    provider = id => Response.json(subscriber(id, { refunded: true }));
    assert.equal((await billing.syncBillingUser(userId)).providerTimestamp, saved.providerTimestamp);
  });
  await test('stored snapshots expire and product removals apply without a new provider response', async () => {
    const snapshot = await billing.syncBillingUser(userId);
    snapshot.entitlements[0].accessUntil = new Date(Date.now() - 1).toISOString();
    await kv.set(['revenuecat', 'sandbox', userId], snapshot);
    assert.equal((await billing.storedBillingUser(userId))?.entitlements[0].active, false);
    process.env.REVENUECAT_ALLOWED_PRODUCT_IDS = 'different-product';
    assert.equal((await billing.storedBillingUser(userId))?.entitlements.length, 0);
  });
  await test('deleted accounts cannot be recreated by an in-flight sync', async () => {
    provider = async id => { await kv.delete(['user', id]); return Response.json(subscriber(id)); };
    await rejectsStatus(billing.syncBillingUser(userId), 401);
    assert.equal((await kv.get(['revenuecat', 'sandbox', userId])).value, null);
  });
  await test('deleting accounts fail before the provider is queried', async () => {
    await kv.set(['user', userId], { id: userId, deletingAt: new Date().toISOString() });
    await rejectsStatus(billing.syncBillingUser(userId), 401);
    assert.equal(providerCalls, 0);
  });
  await test('billing export includes both environments while disabled and deletion removes local billing data', async () => {
    const snapshot = await billing.syncBillingUser(userId);
    await kv.set(['revenuecat', 'production', userId], { ...snapshot, environment: 'production' });
    await billing.limitBillingUser(userId);
    process.env.REVENUECAT_SECRET_API_KEY = '';
    const exported = await billing.exportBillingUser(userId);
    assert.ok(exported.sandbox); assert.ok(exported.production);
    await billing.cleanupBillingUser(userId);
    assert.deepEqual(await billing.exportBillingUser(userId), { sandbox: null, production: null });
    for await (const entry of kv.list({ prefix: ['revenuecat-rate', userId] })) assert.fail(`Unremoved rate entry: ${entry.key}`);
  });
  await test('status is authenticated, private and uncached', async () => {
    assert.equal((await statusRoute.GET(request('/api/billing/status', undefined, {}, false))).status, 401);
    const response = await statusRoute.GET(request('/api/billing/status'));
    assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') || '', /private.*no-store/);
    assert.equal((await response.json()).config.enabled, true);
  });
  await test('status reads the current runtime SDK key and matching environment on each request', async () => {
    const sandbox = await billing.syncBillingUser(userId);
    let response = await statusRoute.GET(request('/api/billing/status'));
    let body = await response.json();
    assert.equal(body.config.webApiKey, 'rcb_sb_test-key');
    assert.equal(body.snapshot.environment, 'sandbox');
    configure('production', 'rcb_runtime-live-key');
    response = await statusRoute.GET(request('/api/billing/status'));
    body = await response.json();
    assert.equal(body.config.enabled, true); assert.equal(body.config.webApiKey, 'rcb_runtime-live-key');
    assert.equal(body.config.environment, 'production'); assert.equal(body.snapshot, null);
    assert.equal(JSON.stringify(body).includes('sk_test-only-never-real'), false);
    assert.equal(JSON.stringify(body).includes('test-only-webhook-auth'), false);
    configure('sandbox', 'rcb_sb_runtime-new-key');
    body = await (await statusRoute.GET(request('/api/billing/status'))).json();
    assert.equal(body.config.webApiKey, 'rcb_sb_runtime-new-key'); assert.equal(body.snapshot.providerTimestamp, sandbox.providerTimestamp);
    delete process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY;
    body = await (await statusRoute.GET(request('/api/billing/status'))).json();
    assert.equal(body.config.enabled, false); assert.equal(body.config.webApiKey, null); assert.equal(body.snapshot, null);
  });
  await test('sync rejects cross-site, missing, malformed and scheme-mismatched origins', async () => {
    for (const value of ['', 'null', 'invalid', 'https://localhost:3000', 'http://localhost:3000.evil.invalid', 'http://localhost:3000/path', 'http://user@localhost:3000']) assert.equal((await syncRoute.POST(request('/api/billing/sync', '{}', { origin: value }))).status, 403, value);
    assert.equal(providerCalls, 0);
  });
  await test('sync requires a session and a JSON object with a valid expected purchase', async () => {
    assert.equal((await syncRoute.POST(request('/api/billing/sync', '{}', {}, false))).status, 401);
    for (const body of ['null', '[]', 'true', '"text"', 'invalid', '{"expectedProductId":"unconfigured"}', '{"purchasedAfter":-1}']) assert.equal((await syncRoute.POST(request('/api/billing/sync', body))).status, 400, body);
    assert.equal((await syncRoute.POST(request('/api/billing/sync', '{}', { 'content-type': 'application/json-malformed' }))).status, 415);
    assert.equal((await syncRoute.POST(request('/api/billing/sync', ' '.repeat(2_049)))).status, 413);
    assert.equal(providerCalls, 0);
  });
  await test('purchase confirmation stays pending until matching recent provider data exists', async () => {
    let response = await syncRoute.POST(request('/api/billing/sync', JSON.stringify({ expectedProductId: product, purchasedAfter: Date.now() - 60_000 })));
    assert.equal(response.status, 200); assert.equal((await response.json()).verification, 'verified');
    response = await syncRoute.POST(request('/api/billing/sync', JSON.stringify({ expectedProductId: product, purchasedAfter: Date.now() + 10_000 })));
    assert.equal(response.status, 200); assert.equal((await response.json()).verification, 'pending');
  });
  await test('sync rate limit is atomic for concurrent calls and does not contact provider once exhausted', async () => {
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => billing.limitBillingUser(userId)));
    const accepted = results.filter(result => result.status === 'fulfilled').length;
    assert.ok(accepted > 0 && accepted <= 10);
    for (let count = accepted; count < 10; count++) await billing.limitBillingUser(userId);
    assert.equal((await syncRoute.POST(request('/api/billing/sync', '{}'))).status, 429);
    assert.equal(providerCalls, 0);
  });
  await test('streaming body limits apply without a Content-Length and invalid UTF8 is rejected', async () => {
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(new Uint8Array(30)); controller.enqueue(new Uint8Array(30)); controller.close(); } });
    await rejectsStatus(billing.readBillingBody({ headers: new Headers(), body: stream }, 50), 413);
    const invalid = new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } });
    await rejectsStatus(billing.readBillingBody({ headers: new Headers(), body: invalid }), 400);
  });
  await test('webhook requires exact authorization before reading or processing data', async () => {
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', '{}', {}, false))).status, 401);
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', '{}', { authorization: 'Bearer wrong' }, false))).status, 401);
    assert.equal(providerCalls, 0);
  });
  await test('optional HMAC uses raw JSON, exact header, a fresh delivery timestamp and constant-time verification', async () => {
    process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET = 'test-only-signing-secret';
    const raw = JSON.stringify(event('TEST'));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = `t=${timestamp},v1=${createHmac('sha256', 'test-only-signing-secret').update(`${timestamp}.${raw}`).digest('hex')}`;
    const headers = { authorization: 'Bearer test-only-webhook-auth', 'x-revenuecat-webhook-signature': signature };
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', raw, headers, false))).status, 200);
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', `${raw} `, headers, false))).status, 401);
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', raw, { ...headers, 'x-revenuecat-webhook-signature': signature.replace('v1=', 'v1=0') }, false))).status, 401);
    assert.throws(() => billing.verifyBillingWebhookSignature(raw, 't=1,v1=' + '0'.repeat(64)), (error: unknown) => error instanceof billing.BillingError && error.status === 401);
  });
  await test('webhook validates schema, content type and streaming size', async () => {
    const headers = { authorization: 'Bearer test-only-webhook-auth' };
    for (const body of ['null', '{}', '[]', '{"event":{"id":"x","type":"RENEWAL","event_timestamp_ms":-1}}']) assert.equal((await webhookRoute.POST(request('/api/billing/webhook', body, headers, false))).status, 400);
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', '{}', { ...headers, 'content-type': 'application/json-malformed' }, false))).status, 415);
    assert.equal((await webhookRoute.POST(request('/api/billing/webhook', ' '.repeat(65_537), headers, false))).status, 413);
  });
  await test('webhook retries are idempotent without repeating provider fetch', async () => {
    const payload = event();
    assert.deepEqual(await billing.processBillingWebhook(payload), { replay: false, disposition: 'synchronized' });
    assert.deepEqual(await billing.processBillingWebhook(payload), { replay: true, disposition: 'synchronized' });
    assert.equal(providerCalls, 1);
  });
  await test('old webhook events cannot overwrite current data or require a working provider', async () => {
    await billing.processBillingWebhook(event());
    provider = () => { throw new Error('Provider must not be queried'); };
    const result = await billing.processBillingWebhook(event('CANCELLATION', { event_timestamp_ms: Date.now() - 10_000 }));
    assert.equal(result.disposition, 'stale'); assert.equal(providerCalls, 1);
  });
  await test('different-environment webhook records are isolated and never synchronize', async () => {
    const payload = event('RENEWAL', { environment: 'PRODUCTION' });
    assert.equal((await billing.processBillingWebhook(payload)).disposition, 'different_environment');
    assert.equal(providerCalls, 0);
    assert.ok((await kv.get(['revenuecat-event', 'production', payload.event.id])).value);
    assert.equal((await kv.get(['revenuecat-event', 'sandbox', payload.event.id])).value, null);
  });
  await test('unknown or deleting account webhook deliveries do not recreate billing data', async () => {
    await kv.delete(['user', userId]);
    assert.equal((await billing.processBillingWebhook(event())).disposition, 'unknown_account'); assert.equal(providerCalls, 0);
  });
  await test('webhook provider failures are retriable and never commit a replay marker', async () => {
    const payload = event();
    provider = () => new Response('{}', { status: 500 });
    await rejectsStatus(billing.processBillingWebhook(payload), 503);
    assert.equal((await kv.get(['revenuecat-event', 'sandbox', payload.event.id])).value, null);
    provider = id => Response.json(subscriber(id));
    assert.equal((await billing.processBillingWebhook(payload)).disposition, 'synchronized');
  });
  await test('provider aliases are synchronized under local UUIDs without trusting webhook entitlement claims', async () => {
    provider = id => Response.json(subscriber(id, { originalId: '$RCAnonymousID:provider-alias', refunded: true }));
    const payload = event('RENEWAL', { app_user_id: '$RCAnonymousID:provider-alias', original_app_user_id: '$RCAnonymousID:provider-alias', aliases: [userId], entitlement_ids: ['forged-access'] });
    assert.equal((await billing.processBillingWebhook(payload)).disposition, 'synchronized');
    assert.equal((await billing.storedBillingUser(userId))?.entitlements.length, 0);
  });
  await test('transfers without an environment atomically revoke the source and verify the destination', async () => {
    await billing.syncBillingUser(userId);
    provider = id => Response.json(subscriber(id, { refunded: id === userId, originalId: userId }));
    const payload = event('TRANSFER', { environment: undefined, app_user_id: undefined, original_app_user_id: undefined, aliases: undefined, transferred_from: [userId], transferred_to: [secondUser] });
    assert.equal((await billing.processBillingWebhook(payload)).disposition, 'synchronized');
    assert.equal((await billing.storedBillingUser(userId))?.entitlements.length, 0);
    assert.equal((await billing.storedBillingUser(secondUser))?.entitlements[0].active, true);
  });
  await test('a failed transfer is fully retriable and never leaves partially updated accounts', async () => {
    const before = await billing.syncBillingUser(userId);
    const payload = event('TRANSFER', { transferred_from: [userId], transferred_to: [secondUser] });
    provider = id => id === secondUser ? new Response('{}', { status: 503 }) : Response.json(subscriber(id, { refunded: true }));
    await rejectsStatus(billing.processBillingWebhook(payload), 503);
    assert.equal((await billing.storedBillingUser(userId))?.providerTimestamp, before.providerTimestamp);
    assert.equal((await billing.storedBillingUser(secondUser)), null);
    assert.equal((await kv.get(['revenuecat-event', 'sandbox', payload.event.id])).value, null);
  });
  await test('an account removed while a webhook fetch is pending cannot receive a recreated snapshot', async () => {
    const payload = event();
    provider = async id => { await kv.delete(['user', id]); return Response.json(subscriber(id)); };
    await rejectsStatus(billing.processBillingWebhook(payload), 409);
    assert.equal((await billing.storedBillingUser(userId)), null);
    assert.equal((await kv.get(['revenuecat-event', 'sandbox', payload.event.id])).value, null);
  });
  await test('concurrent webhook delivery writes one marker and one authoritative result', async () => {
    const payload = event();
    const results = await Promise.all([billing.processBillingWebhook(payload), billing.processBillingWebhook(payload)]);
    assert.equal(results.filter(result => result.replay).length, 1);
    assert.ok((await billing.storedBillingUser(userId))?.entitlements[0].active);
  });
  const sdk = await import('@revenuecat/purchases-js');
  const web = await import('../lib/revenuecat-web');
  const staticMethods = ['configure', 'isConfigured', 'getSharedInstance'] as const;
  const originals = staticMethods.map(name => Object.getOwnPropertyDescriptor(sdk.Purchases, name)!);
  const user = { id: userId, name: 'Billing Test', email: 'billing-test@example.invalid' };
  const second = { ...user, id: secondUser };
  const packageObject = { identifier: '$rc_monthly', product: { identifier: product, title: 'Configured package', description: 'From provider', price: { formattedPrice: '₺149,99' }, normalPeriodDuration: 'P1M', defaultSubscriptionOption: {} } };
  const unwanted = { ...packageObject, identifier: 'unconfigured-package', product: { ...packageObject.product, identifier: 'unconfigured-product' } };
  type MockInstance = { getAppUserId(): string; changeUser(id: string): Promise<void>; getOfferings(): Promise<unknown>; isSandbox(): boolean; purchase(value: unknown): Promise<void>; close(): void };
  let shared: MockInstance | null = null;
  let sessionId = userId;
  let configurations = 0;
  let purchaseCalls = 0;
  let sessionCalls = 0;
  let offerings: () => Promise<unknown> = async () => ({ current: { availablePackages: [packageObject, unwanted] }, all: { selected: { availablePackages: [packageObject] } } });
  let purchaseAction: (value: unknown) => Promise<void> = async () => {};
  let beforeSession: () => void = () => {};
  const assertCurrent = () => {};
  const target = {} as HTMLElement;
  Object.defineProperty(sdk.Purchases, 'configure', { value: ({ apiKey, appUserId }: { apiKey: string; appUserId: string }) => {
    configurations++;
    let currentId = appUserId;
    const instance: MockInstance = { getAppUserId: () => currentId, changeUser: async id => { currentId = id; }, getOfferings: () => offerings(), isSandbox: () => apiKey.startsWith('rcb_sb_'), purchase: async value => { purchaseCalls++; await purchaseAction(value); }, close: () => { if (shared === instance) shared = null; } };
    shared = instance;
    return instance;
  }, configurable: true });
  Object.defineProperty(sdk.Purchases, 'isConfigured', { value: () => !!shared, configurable: true });
  Object.defineProperty(sdk.Purchases, 'getSharedInstance', { value: () => { assert.ok(shared); return shared; }, configurable: true });
  globalThis.fetch = async input => {
    assert.equal(input, '/api/store/me');
    sessionCalls++; beforeSession();
    return Response.json({ user: { id: sessionId } });
  };
  async function sdkTest(name: string, action: () => Promise<void>) {
    web.resetRevenueCatIdentity();
    configurations = 0; purchaseCalls = 0; sessionCalls = 0; sessionId = userId; beforeSession = () => {};
    offerings = async () => ({ current: { availablePackages: [packageObject, unwanted] }, all: { selected: { availablePackages: [packageObject] } } });
    purchaseAction = async () => {};
    await test(name, action);
  }
  try {
    await sdkTest('SDK offerings preserve provider prices and only allow configured products and offerings', async () => {
      const packages = await web.billingPackages(user, billing.billingPublicConfig(), assertCurrent);
      assert.equal(packages.length, 1); assert.equal(packages[0].price, '₺149,99'); assert.equal(packages[0].subscription, true);
      process.env.REVENUECAT_OFFERING_ID = 'missing';
      assert.deepEqual(await web.billingPackages(user, billing.billingPublicConfig(), assertCurrent), []);
      process.env.REVENUECAT_OFFERING_ID = 'selected';
      assert.equal((await web.billingPackages(user, billing.billingPublicConfig(), assertCurrent)).length, 1);
    });
    await sdkTest('SDK identity uses the current local account and isolates account switches', async () => {
      await web.billingPackages(user, billing.billingPublicConfig(), assertCurrent);
      assert.equal(shared?.getAppUserId(), userId);
      sessionId = secondUser;
      await web.billingPackages(second, billing.billingPublicConfig(), assertCurrent);
      assert.equal(shared?.getAppUserId(), secondUser); assert.equal(configurations, 1);
    });
    await sdkTest('SDK cannot configure or purchase when the signed-in account changed', async () => {
      sessionId = secondUser;
      await assert.rejects(web.billingPackages(user, billing.billingPublicConfig(), assertCurrent), web.BillingSessionChanged);
      assert.equal(configurations, 0); assert.equal(purchaseCalls, 0);
    });
    await sdkTest('SDK rejects configuration whose reported environment differs', async () => {
      const config = { ...billing.billingPublicConfig(), environment: 'production' as const };
      await assert.rejects(web.billingPackages(user, config, assertCurrent), /Ödeme ortamı/);
      assert.equal(purchaseCalls, 0);
    });
    await sdkTest('an old offering response is discarded after reset while the next account loads immediately', async () => {
      let release: (value: unknown) => void = () => {};
      let started: () => void = () => {};
      const began = new Promise<void>(resolve => { started = resolve; });
      offerings = () => new Promise(resolve => { release = resolve; started(); });
      const old = web.billingPackages(user, billing.billingPublicConfig(), assertCurrent);
      const checkedOld = assert.rejects(old, web.BillingSessionChanged);
      await began;
      web.resetRevenueCatIdentity(); sessionId = secondUser;
      offerings = async () => ({ current: { availablePackages: [packageObject] }, all: {} });
      const next = await web.billingPackages(second, billing.billingPublicConfig(), assertCurrent);
      assert.equal(next.length, 1); assert.equal(shared?.getAppUserId(), secondUser);
      release({ current: { availablePackages: [packageObject] }, all: {} });
      await checkedOld;
    });
    await sdkTest('SDK checkout re-fetches the selected package and validates session immediately before purchase', async () => {
      const config = billing.billingPublicConfig();
      const [item] = await web.billingPackages(user, config, assertCurrent);
      sessionCalls = 0;
      beforeSession = () => { if (sessionCalls === 3) sessionId = secondUser; };
      await assert.rejects(web.purchaseBillingPackage(user, config, item, target, assertCurrent), web.BillingSessionChanged);
      assert.equal(purchaseCalls, 0);
    });
    await sdkTest('SDK cancellation is recoverable and successful checkout uses provider package and account identity', async () => {
      const config = billing.billingPublicConfig();
      const [item] = await web.billingPackages(user, config, assertCurrent);
      purchaseAction = async () => { throw new sdk.PurchasesError(sdk.ErrorCode.UserCancelledError); };
      assert.equal(await web.purchaseBillingPackage(user, config, item, target, assertCurrent), 'cancelled');
      purchaseAction = async value => {
        const params = value as { rcPackage: unknown; customerEmail: string; htmlTarget: unknown; metadata: Record<string, string> };
        assert.equal(params.rcPackage, packageObject); assert.equal(params.customerEmail, user.email); assert.equal(params.htmlTarget, target); assert.equal(params.metadata.app_user_id, userId);
      };
      assert.equal(await web.purchaseBillingPackage(user, config, item, target, assertCurrent), 'completed');
      assert.equal(purchaseCalls, 2);
    });
    await sdkTest('SDK permits one checkout at a time and discards a completion after account reset', async () => {
      const config = billing.billingPublicConfig();
      const [item] = await web.billingPackages(user, config, assertCurrent);
      let finish: () => void = () => {};
      let started: () => void = () => {};
      const began = new Promise<void>(resolve => { started = resolve; });
      purchaseAction = () => new Promise<void>(resolve => { finish = resolve; started(); });
      const checkout = web.purchaseBillingPackage(user, config, item, target, assertCurrent);
      const checkedCheckout = assert.rejects(checkout, web.BillingSessionChanged);
      await began;
      await assert.rejects(web.purchaseBillingPackage(user, config, item, target, assertCurrent), /zaten açık/);
      assert.equal(purchaseCalls, 1);
      web.resetRevenueCatIdentity(); finish();
      await checkedCheckout;
    });
  } finally {
    web.resetRevenueCatIdentity();
    staticMethods.forEach((name, index) => Object.defineProperty(sdk.Purchases, name, originals[index]));
  }
} finally {
  globalThis.fetch = realFetch;
  kv.close();
}
console.log(`Billing tests: ${passed} passed, ${failures} failed.`);
if (failures) process.exitCode = 1;
