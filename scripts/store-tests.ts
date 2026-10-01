import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import type { KV } from '../lib/database';
import type { User } from '../lib/auth';
import { digest, token } from '../lib/security';
import { readJsonObject, RequestError, sameOrigin, takeRateLimit } from '../lib/http-security';
import { POST } from '../app/api/store/[action]/route';
import { products } from '../lib/products';

const runtime = (globalThis as unknown as { Deno: { openKv(path?: string): Promise<KV & { close(): void }> } }).Deno;
if (!runtime) throw new Error('Use Deno with --unstable-kv for isolated store tests.');
const originalOpenKv = runtime.openKv;
const kv = await originalOpenKv(':memory:');
Object.defineProperty(runtime, 'openKv', { value: () => Promise.resolve(kv), configurable: true });
const originalNow = Date.now;
const now = originalNow();
Date.now = () => now; // Fixed rate window avoids minute-boundary flakes.
const origin = 'http://localhost:3000';

function request(action: string, body: BodyInit, session = '', headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/api/store/${action}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...(session ? { Cookie: session } : {}), ...headers }, body });
}
async function call(action: string, data: unknown, expected = 200, session = '') {
  const response = await POST(request(action, JSON.stringify(data), session), { params: Promise.resolve({ action }) });
  const body = await response.json();
  assert.equal(response.status, expected, `${action}: ${JSON.stringify(body)}`);
  return body;
}
function checkout(overrides: Record<string, unknown> = {}) {
  return { requestId: crypto.randomUUID(), demoConsent: true, items: [{ id: 'findik', quantity: 2 }], name: 'Store Fixture', phone: '+90 (555) 000-00-00', email: 'store-fixture@example.com', address: 'Synthetic Store Street 1', city: 'İstanbul', district: 'Kadıköy', ...overrides };
}
async function account() {
  const user: User = { id: crypto.randomUUID(), email: 'store-fixture@example.com', name: 'Store Fixture', createdAt: new Date(now).toISOString(), authVersion: 0 };
  const secret = token();
  await kv.set(['user', user.id], user);
  await kv.set(['email', user.email], user.id);
  await kv.set(['session', digest(secret)], { userId: user.id, authVersion: 0, createdAt: now });
  return { user, session: `fb_session=${secret}`, sessionKey: ['session', digest(secret)] };
}
async function operator() {
  const secret = token(); await kv.set(['operator-session', digest(secret)], { createdAt: now });
  return `fb_operator=${secret}`;
}
async function entries(prefix: (string | number)[]) {
  const values = [];
  for await (const entry of kv.list({ prefix })) values.push(entry);
  return values;
}
function streamed(bytes: Uint8Array, width = 1) {
  let position = 0;
  return new ReadableStream<Uint8Array>({ pull(controller) { if (position >= bytes.length) controller.close(); else { controller.enqueue(bytes.slice(position, position + width)); position += width; } } });
}
async function beforeCommit(predicate: (keys: (string | number)[][]) => boolean, mutation: () => Promise<void>, run: () => Promise<void>) {
  const original = kv.atomic;
  let fired = false;
  kv.atomic = () => {
    const transaction = original.call(kv);
    const set = transaction.set; const commit = transaction.commit; const keys: (string | number)[][] = [];
    transaction.set = (key, value, options) => { keys.push(key); return set.call(transaction, key, value, options); };
    transaction.commit = async () => { if (!fired && predicate(keys)) { fired = true; await mutation(); } return commit.call(transaction); };
    return transaction;
  };
  try { await run(); assert.equal(fired, true, 'Commit race fixture did not run'); }
  finally { kv.atomic = original; }
}
let passed = 0;
async function test(label: string, run: () => Promise<void> | void) {
  for await (const entry of kv.list({ prefix: [] })) await kv.delete(entry.key);
  process.env.APP_URL = origin; delete process.env.TRUSTED_CLIENT_IP_HEADER;
  await run(); passed++; console.log(`PASS ${label}`);
}

try {
  await test('origin matching is exact, canonical and safe for malformed inputs', () => {
    const check = (value: string | null, url = `${origin}/api/store/order`) => sameOrigin({ url, headers: new Headers(value ? { Origin: value } : {}) });
    assert.equal(check(origin), true);
    for (const value of [null, 'null', 'invalid', `${origin}/`, `${origin}/path`, `${origin}?next=x`, 'http://user:pass@localhost:3000', 'https://localhost:3000', 'http://localhost:3001', 'https://evil.example']) assert.equal(check(value), false, String(value));
    process.env.APP_URL = 'https://canonical.example';
    assert.equal(check(origin), false);
    assert.equal(check('https://canonical.example', 'http://internal:3000/api/store/order'), true);
    process.env.APP_URL = 'invalid'; assert.equal(check(origin), false);
  });
  await test('JSON media types match exactly and malformed JSON objects fail safely', async () => {
    for (const type of ['application/jsonp', 'application/jsonx', 'application/json+xml', 'text/plain', '']) {
      assert.equal((await POST(request('order', '{}', '', { 'Content-Type': type }), { params: Promise.resolve({ action: 'order' }) })).status, 415, type);
    }
    assert.deepEqual(await readJsonObject(request('order', '{"ok":true}', '', { 'Content-Type': 'Application/JSON; charset=utf-8' })), { ok: true });
    for (const body of ['null', '[]', 'true', '12', '"text"', '{invalid']) {
      assert.equal((await POST(request('order', body), { params: Promise.resolve({ action: 'order' }) })).status, 400, body);
    }
    assert.equal((await POST(request('order', '{}', '', { Origin: 'not-a-url' }), { params: Promise.resolve({ action: 'order' }) })).status, 403);
    assert.equal((await POST(request('order', '{}', '', { 'Content-Length': '-1' }), { params: Promise.resolve({ action: 'order' }) })).status, 413);
  });
  await test('streaming JSON counts UTF-8 bytes, handles split characters and rejects invalid UTF-8', async () => {
    const raw = JSON.stringify({ text: 'üüüüüü' }); const bytes = new TextEncoder().encode(raw);
    assert.ok(bytes.length > raw.length);
    assert.deepEqual(await readJsonObject(request('order', streamed(bytes)), bytes.length), { text: 'üüüüüü' });
    await assert.rejects(readJsonObject(request('order', streamed(bytes)), raw.length), (error: unknown) => error instanceof RequestError && error.status === 413);
    await assert.rejects(readJsonObject(request('order', streamed(bytes), '', { 'Content-Length': '1' }), raw.length), (error: unknown) => error instanceof RequestError && error.status === 413);
    await assert.rejects(readJsonObject(request('order', streamed(new Uint8Array([0xff])))), (error: unknown) => error instanceof RequestError && error.status === 400);
    const oversized = new TextEncoder().encode(JSON.stringify({ text: 'ü'.repeat(9000) }));
    assert.equal((await POST(request('order', streamed(oversized, 4000)), { params: Promise.resolve({ action: 'order' }) })).status, 413);
  });
  await test('default rate limiting ignores spoofed IP headers and concurrent commits never exceed fifteen', async () => {
    for (let i = 0; i < 14; i++) await takeRateLimit({ headers: new Headers({ 'x-forwarded-for': `spoof-${i}` }) }, 'fixture');
    const attempts = await Promise.allSettled(Array.from({ length: 40 }, (_, i) => takeRateLimit({ headers: new Headers({ 'x-forwarded-for': `parallel-spoof-${i}`, 'x-real-ip': String(i) }) }, 'fixture')));
    assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
    for (const attempt of attempts) if (attempt.status === 'rejected') assert.equal((attempt.reason as RequestError).status, 429);
    const buckets = await entries(['rate']); assert.equal(buckets.length, 1); assert.equal(buckets[0].value, 15);
  });
  await test('explicit trusted proxy selects only supported ingress identity and first forwarding hop', async () => {
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-forwarded-for';
    for (let i = 0; i < 15; i++) await takeRateLimit({ headers: new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }) }, 'trusted');
    await assert.rejects(takeRateLimit({ headers: new Headers({ 'x-forwarded-for': '198.51.100.1, spoofed-proxy' }) }, 'trusted'), (error: unknown) => error instanceof RequestError && error.status === 429);
    await takeRateLimit({ headers: new Headers({ 'x-forwarded-for': '198.51.100.2' }) }, 'trusted');
    process.env.TRUSTED_CLIENT_IP_HEADER = 'x-unsupported';
    for (let i = 0; i < 15; i++) await takeRateLimit({ headers: new Headers({ 'x-unsupported': String(i) }) }, 'unsupported');
    await assert.rejects(takeRateLimit({ headers: new Headers({ 'x-unsupported': 'new-client' }) }, 'unsupported'), (error: unknown) => error instanceof RequestError && error.status === 429);
  });
  await test('orders require boolean demo consent, valid UUID and distinct valid cart lines', async () => {
    const invalid = [
      { demoConsent: false }, { demoConsent: 'true' }, { demoConsent: undefined },
      { requestId: 'guessable-id' }, { requestId: '00000000-0000-0000-0000-000000000000' },
      { items: [{ id: 'findik', quantity: 1 }, { id: 'findik', quantity: 2 }] },
      { items: [null] }, { items: [['findik', 1]] }, { items: [{ id: 'unknown', quantity: 1 }] },
      ...[0, -1, 100, 1.5, '2'].map(quantity => ({ items: [{ id: 'findik', quantity }] })),
    ];
    for (const overrides of invalid) await call('order', checkout(overrides), 400);
    assert.equal((await entries(['order'])).length, 0);
  });
  await test('phone validation requires sensible numeric contact data', async () => {
    for (const phone of ['call me', '555', '1234567890123456', '+90 abc 5550000000', '(---) () ()']) await call('order', checkout({ phone }), 400);
    for (const phone of ['05550000000', '+90 (555) 000-00-00', '+1 202 555 0101']) await call('order', checkout({ phone }), 201);
  });
  await test('catalog prices and delivery threshold are server-authoritative with no card data retained', async () => {
    const below = await call('order', checkout({ items: [{ id: 'findik', quantity: 4, price: 1, name: 'forged' }], total: 1, cardNumber: '4111111111111111', cvv: '123' }), 201);
    assert.equal(below.order.total, 829); assert.equal(below.order.items[0].price, 185); assert.equal(below.order.items[0].name, 'Fındık');
    assert.equal(below.order.payment, 'demo-completed'); assert.equal(below.order.userId, null);
    const exact = await call('order', checkout({ items: [{ id: 'yapraksiz-fidan', quantity: 5 }] }), 201); assert.equal(exact.order.total, 750);
    const above = await call('order', checkout({ items: [{ id: 'findik', quantity: 5 }] }), 201); assert.equal(above.order.total, 925);
    for (const entry of await entries(['order'])) { assert.equal(JSON.stringify(entry.value).includes('cardNumber'), false); assert.equal(JSON.stringify(entry.value).includes('cvv'), false); }
  });
  await test('idempotency returns same receipt and rejects altered items or shipping without disclosure', async () => {
    const data = checkout(); const created = await call('order', data, 201); const retry = await call('order', data);
    assert.equal(retry.order.id, created.order.id);
    assert.equal((await call('order', { ...data, total: 1, cardNumber: 'ignored' })).order.id, created.order.id);
    for (const change of [{ city: 'Ankara' }, { name: 'Different Customer' }, { email: 'different@example.com' }, { items: [{ id: 'findik', quantity: 3 }] }]) {
      const denied = await call('order', { ...data, ...change }, 409); assert.equal(denied.order, undefined);
    }
    assert.equal((await entries(['order'])).length, 1); assert.equal((await entries(['order-request', 'guest'])).length, 1);
  });
  await test('idempotent retry retains original receipt when catalog price and display name change', async () => {
    const data = checkout(); const created = await call('order', data, 201);
    const product = products.find(item => item.id === 'findik')!;
    const original = { price: product.price, name: product.name };
    try {
      product.price = 285; product.name = 'Fındık Güncel';
      const retry = await call('order', data);
      assert.deepEqual(retry.order, created.order);
      assert.equal(retry.order.total, 459); assert.equal(retry.order.items[0].price, 185); assert.equal(retry.order.items[0].name, original.name);
      for (const changes of [{ items: [{ id: 'cam', quantity: 2 }] }, { items: [{ id: 'findik', quantity: 3 }] }, { city: 'Ankara' }]) {
        const conflict = await call('order', { ...data, ...changes }, 409); assert.equal(conflict.order, undefined);
      }
      const fresh = await call('order', { ...data, requestId: crypto.randomUUID() }, 201);
      assert.equal(fresh.order.total, 659); assert.equal(fresh.order.items[0].price, 285); assert.equal(fresh.order.items[0].name, 'Fındık Güncel');
      assert.notEqual(fresh.order.id, created.order.id);
      assert.deepEqual((await kv.get(['order', created.order.id])).value, created.order);
      assert.equal((await entries(['order'])).length, 2);
    } finally { product.price = original.price; product.name = original.name; }
  });
  await test('checkout identity snapshots reject account changes while optional legacy snapshots remain valid', async () => {
    const loggedIn = await account();
    const guest = checkout({ checkoutUserId: null }); await call('order', guest, 201);
    assert.equal((await call('order', guest, 409, loggedIn.session)).code, 'checkout_session_changed');
    const member = checkout({ checkoutUserId: loggedIn.user.id }); const created = await call('order', member, 201, loggedIn.session); assert.equal(created.order.userId, loggedIn.user.id);
    assert.equal((await call('order', member, 409)).code, 'checkout_session_changed');
    await call('order', checkout({ checkoutUserId: crypto.randomUUID() }), 409, loggedIn.session);
    await call('order', checkout(), 201); await call('order', checkout(), 201, loggedIn.session);
  });
  await test('logout wins authenticated order commit race without leaving partial order records', async () => {
    const loggedIn = await account(); const data = checkout({ checkoutUserId: loggedIn.user.id });
    await beforeCommit(keys => keys.some(key => key[0] === 'order'), () => kv.delete(loggedIn.sessionKey), async () => { await call('order', data, 409, loggedIn.session); });
    for (const prefix of [['order'], ['order-request'], ['orders'], ['schema']]) assert.equal((await entries(prefix)).length, 0);
  });
  await test('logout before idempotent receipt check prevents returning private receipt', async () => {
    const loggedIn = await account(); const data = checkout({ checkoutUserId: loggedIn.user.id }); const created = await call('order', data, 201, loggedIn.session);
    await beforeCommit(keys => keys.length === 0, () => kv.delete(loggedIn.sessionKey), async () => {
      const blocked = await call('order', data, 401, loggedIn.session); assert.equal(blocked.order, undefined);
    });
    assert.deepEqual((await kv.get(['order', created.order.id])).value, created.order);
    assert.equal((await entries(['order'])).length, 1); assert.equal((await entries(['order-request', loggedIn.user.id])).length, 1);
  });
  await test('deletion before idempotent receipt check prevents disclosure and recreation of cleaned records', async () => {
    const loggedIn = await account(); const data = checkout({ checkoutUserId: loggedIn.user.id }); const created = await call('order', data, 201, loggedIn.session);
    await beforeCommit(keys => keys.length === 0, async () => {
      await kv.set(['user', loggedIn.user.id], { ...loggedIn.user, deletingAt: new Date(now).toISOString(), authVersion: 1 });
      await kv.delete(['order', created.order.id]); await kv.delete(['order-request', loggedIn.user.id, data.requestId]); await kv.delete(['orders', loggedIn.user.id, created.order.id]);
    }, async () => { const blocked = await call('order', data, 401, loggedIn.session); assert.equal(blocked.order, undefined); });
    for (const prefix of [['order'], ['order-request'], ['orders']]) assert.equal((await entries(prefix)).length, 0);
  });
  await test('account deletion wins order commit race and tombstoned account cannot create member orders', async () => {
    const loggedIn = await account(); const data = checkout({ checkoutUserId: loggedIn.user.id });
    await beforeCommit(keys => keys.some(key => key[0] === 'order'), async () => { await kv.set(['user', loggedIn.user.id], { ...loggedIn.user, deletingAt: new Date(now).toISOString(), authVersion: 1 }); }, async () => { await call('order', data, 409, loggedIn.session); });
    await call('order', data, 409, loggedIn.session);
    assert.equal((await entries(['order'])).length, 0); assert.equal((await entries(['orders'])).length, 0);
  });
  await test('admin status cannot recreate order indexes after deletion starts or wins its commit race', async () => {
    const loggedIn = await account(); const admin = await operator(); const created = await call('order', checkout(), 201, loggedIn.session);
    const key = ['orders', loggedIn.user.id, created.order.id]; await kv.delete(key);
    await kv.set(['user', loggedIn.user.id], { ...loggedIn.user, deletingAt: new Date(now).toISOString(), authVersion: 1 });
    await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 404, admin);
    assert.equal((await kv.get(key)).value, null); assert.equal((await kv.get<{ status: string }>(['order', created.order.id])).value!.status, 'Alındı');
    await kv.set(['user', loggedIn.user.id], loggedIn.user);
    await beforeCommit(keys => keys.some(key => key[0] === 'order'), async () => { await kv.set(['user', loggedIn.user.id], { ...loggedIn.user, deletingAt: new Date(now).toISOString(), authVersion: 1 }); }, async () => { await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 409, admin); });
    assert.equal((await kv.get(key)).value, null); assert.equal((await kv.get<{ status: string }>(['order', created.order.id])).value!.status, 'Alındı');
  });
  await test('admin logout before status commit revokes mutation authority atomically', async () => {
    const member = await account(); const admin = await operator(); const created = await call('order', checkout(), 201, member.session);
    const operatorKey = ['operator-session', digest(admin.split('=')[1])];
    await beforeCommit(keys => keys.some(key => key[0] === 'order'), async () => { await call('admin-logout', {}, 200, admin); }, async () => {
      await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 409, admin);
    });
    assert.equal((await kv.get(operatorKey)).value, null);
    for (const key of [['order', created.order.id], ['orders', member.user.id, created.order.id]]) assert.equal((await kv.get<{ status: string }>(key)).value!.status, 'Alındı');
    await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 401, admin);
  });
  await test('owner session age fails closed without relying on delayed KV expiration', async () => {
    const admin = await operator(); const created = await call('order', checkout(), 201);
    const operatorKey = ['operator-session', digest(admin.split('=')[1])];
    for (const value of [true, { createdAt: now - 60 * 60_000 }, { createdAt: now + 1 }, { createdAt: 'invalid' }]) {
      await kv.set(operatorKey, value);
      await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 401, admin);
      assert.equal((await kv.get<{ status: string }>(['order', created.order.id])).value!.status, 'Alındı');
    }
    await kv.set(operatorKey, { createdAt: now });
    await beforeCommit(keys => keys.some(key => key[0] === 'order'), async () => { await kv.set(operatorKey, { createdAt: now - 60 * 60_000 }); }, async () => {
      await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 409, admin);
    });
    assert.equal((await kv.get<{ status: string }>(['order', created.order.id])).value!.status, 'Alındı');
    process.env.ADMIN_KEY_HASH = digest('fixture-owner-key');
    const response = await POST(request('admin-login', JSON.stringify({ key: 'fixture-owner-key' })), { params: Promise.resolve({ action: 'admin-login' }) });
    assert.equal(response.status, 200);
    const secret = response.cookies.get('fb_operator')!.value;
    assert.deepEqual((await kv.get(['operator-session', digest(secret)])).value, { createdAt: now });
    await call('admin-status', { id: created.order.id, status: 'Hazırlanıyor' }, 200, `fb_operator=${secret}`);
  });
  console.log(`PASS: ${passed} store security suites with isolated Deno KV.`);
} finally {
  Date.now = originalNow;
  Object.defineProperty(runtime, 'openKv', { value: originalOpenKv, configurable: true });
  kv.close();
}
