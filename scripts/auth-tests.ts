import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';
import { type KV } from '../lib/database';
import { createSession, currentSession, currentUser, deletionSession, revokeSessions, sessionTTL, type Session, type User } from '../lib/auth';
import { consumeOAuthState, googleConfiguration, googleRequestMatchesOrigin, oauthCookie, OAuthError, oauthTTL, resolveGoogleUser, safeReturnTo, verifiedGoogleClaims, type OAuthState } from '../lib/google-oauth';
import { digest, password, token, verifyPassword } from '../lib/security';
import { GET as start, POST as link } from '../app/api/auth/google/route';
import { GET as callback } from '../app/api/auth/google/callback/route';
import { GET as config } from '../app/api/auth/config/route';
import { GET as storeGet, POST as storePost } from '../app/api/store/[action]/route';

// Real isolated Deno KV plus provider-only fixtures. Production modules expose no test mode.
const runtime = (globalThis as unknown as { Deno: { openKv(path?: string): Promise<KV & { close(): void }> } }).Deno;
if (!runtime) throw new Error('Run these tests with Deno and --unstable-kv.');
const originalOpenKv = runtime.openKv;
const originalDeployment = process.env.DENO_DEPLOY;
const originalPort = process.env.PORT;
const kv = await originalOpenKv(':memory:');
Object.defineProperty(runtime, 'openKv', { value: () => Promise.resolve(kv), configurable: true });
const origin = 'http://localhost:3000';
const clientId = 'auth-tests.apps.googleusercontent.com';
const testPassword = '  correct horse battery staple  ';
const identity = { subject: 'google-fixture-subject', email: 'google-fixture@example.com', name: 'Google Fixture' };
const keypair = generateKeyPairSync('rsa', { modulusLength: 2048 });
const originalCertificates = OAuth2Client.prototype.getFederatedSignonCertsAsync;
OAuth2Client.prototype.getFederatedSignonCertsAsync = async () => ({
  certs: { fixture: keypair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
  format: 'PEM' as Awaited<ReturnType<typeof originalCertificates>>['format'],
});
const originalFetch = globalThis.fetch;
let providerNonce = '';
let providerOverrides: Record<string, unknown> = {};
let providerStatus = 200;
let invalidSignature = false;
let tokenCalls = 0;
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://oauth2.googleapis.com/token', 'Unexpected network request');
  tokenCalls++;
  const form = new URLSearchParams(String(init?.body));
  assert.equal(form.get('client_id'), clientId);
  assert.equal(form.get('client_secret'), 'fixture-client-secret');
  assert.equal(form.get('redirect_uri'), `${process.env.APP_URL}/api/auth/google/callback`);
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.match(form.get('code_verifier') || '', /^[a-f0-9]{64}$/);
  const now = Math.floor(Date.now() / 1000);
  const claims = { iss: 'https://accounts.google.com', aud: clientId, sub: identity.subject, email: identity.email, email_verified: true, name: identity.name, iat: now, exp: now + 300, nonce: providerNonce, ...providerOverrides };
  const signed = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}`;
  const signature = invalidSignature ? Buffer.alloc(256).toString('base64url') : sign('RSA-SHA256', Buffer.from(signed), keypair.privateKey).toString('base64url');
  return Response.json({ id_token: `${signed}.${signature}` }, { status: providerStatus });
};

function request(path: string, session = '', extra: RequestInit = {}) {
  return new NextRequest(`${origin}${path}`, { ...extra, signal: extra.signal || undefined, headers: { Host: 'localhost:3000', ...(session ? { Cookie: session } : {}), ...Object.fromEntries(new Headers(extra.headers)) } });
}
function cookie(response: NextResponse, name = 'fb_session') {
  const value = response.cookies.get(name)?.value;
  assert.ok(value, `${name} was not set`);
  return `${name}=${value}`;
}
async function post(action: string, data: unknown, session = '', expected = 200) {
  const response = await storePost(request(`/api/store/${action}`, session, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), { params: Promise.resolve({ action }) });
  const body = await response.json();
  assert.equal(response.status, expected, `${action}: ${JSON.stringify(body)}`);
  return { response, body };
}
async function get(action: string, session = '', expected = 200) {
  const response = await storeGet(request(`/api/store/${action}`, session), { params: Promise.resolve({ action }) });
  const body = await response.json();
  assert.equal(response.status, expected, `${action}: ${JSON.stringify(body)}`);
  return body;
}
async function register(address = identity.email) {
  const result = await post('register', { name: 'Auth Fixture', email: address, password: testPassword });
  return { ...result, session: cookie(result.response), user: (await kv.get<User>(['user', result.body.user.id])).value! };
}
async function flow(session = '', intent = 'login') {
  const response = await start(request(`/api/auth/google?intent=${intent}&returnTo=/hesabim`, session));
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.origin, 'https://accounts.google.com');
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('scope'), 'openid email profile');
  assert.equal(location.searchParams.get('redirect_uri'), `${origin}/api/auth/google/callback`);
  const state = location.searchParams.get('state')!;
  const record = (await kv.get<OAuthState>(['google-oauth', digest(state)])).value!;
  assert.ok(record);
  providerNonce = record.nonce;
  return { state, record, browser: cookie(response, oauthCookie), session };
}
async function finish(started: Awaited<ReturnType<typeof flow>>, query = 'code=fixture-code', session = started.session, browser = started.browser) {
  return callback(request(`/api/auth/google/callback?state=${started.state}&${query}`, [session, browser].filter(Boolean).join('; ')));
}
function result(response: NextResponse, expected: string, success = false, expectedOrigin = origin) {
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location')!);
  assert.equal(location.origin, expectedOrigin);
  assert.equal(location.searchParams.get(success ? 'auth_success' : 'auth_error'), expected);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.cookies.get(oauthCookie)?.value, '');
}
async function withCommitRace(predicate: (keys: (string | number)[][]) => boolean, mutate: () => Promise<void>, action: () => Promise<void>) {
  const original = kv.atomic;
  let fired = false;
  kv.atomic = () => {
    const transaction = original.call(kv);
    const set = transaction.set;
    const commit = transaction.commit;
    const keys: (string | number)[][] = [];
    transaction.set = (key, value, options) => { keys.push(key); return set.call(transaction, key, value, options); };
    transaction.commit = async () => { if (!fired && predicate(keys)) { fired = true; await mutate(); } return commit.call(transaction); };
    return transaction;
  };
  try { await action(); assert.equal(fired, true, 'Race fixture did not execute'); }
  finally { kv.atomic = original; }
}

let passed = 0;
async function test(label: string, run: () => Promise<void> | void) {
  for await (const entry of kv.list({ prefix: [] })) await kv.delete(entry.key);
  process.env.APP_URL = origin; process.env.GOOGLE_CLIENT_ID = clientId; process.env.GOOGLE_CLIENT_SECRET = 'fixture-client-secret';
  delete process.env.DENO_DEPLOY; delete process.env.PORT;
  delete process.env.TRUSTED_CLIENT_IP_HEADER;
  providerNonce = ''; providerOverrides = {}; providerStatus = 200; invalidSignature = false; tokenCalls = 0;
  await run(); passed++; console.log(`PASS ${label}`);
}

try {
  await test('configuration and redirect allowlist reject insecure origins and open redirects', async () => {
    assert.equal((await config().json()).googleAvailable, true);
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/%5cevil.example', '/yonetim', '/hesabim\n', '/hesabim?next=//evil']) assert.equal(safeReturnTo(value), '/hesabim');
    assert.equal(safeReturnTo('/odeme'), '/odeme');
    for (const value of ['http://example.com', 'https://example.com/unsafe', 'https://user:pass@example.com', 'https://example.com?next=x', 'invalid']) { process.env.APP_URL = value; assert.equal(googleConfiguration(), null); }
    process.env.APP_URL = origin; delete process.env.GOOGLE_CLIENT_SECRET;
    assert.equal((await config().json()).googleAvailable, false);
    result(await start(request('/api/auth/google')), 'unavailable');
    assert.equal((await link(request('/api/auth/google', '', { method: 'POST' }))).status, 503);
  });
  await test('Google origin guard requires canonical Host and allows only the known deployed listener', () => {
    const canonical = 'https://auth-fixture.example';
    const host = new URL(canonical).host;
    const supplied = (url: string, headers: HeadersInit = { Host: host }) => new NextRequest(url, { headers });
    assert.equal(googleRequestMatchesOrigin(supplied(canonical + '/api/auth/google'), canonical), true);
    assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google'), canonical), false);
    process.env.DENO_DEPLOY = 'true';
    for (const scheme of ['http', 'https']) assert.equal(googleRequestMatchesOrigin(supplied(`${scheme}://0.0.0.0:8000/api/auth/google`), canonical), true);
    for (const url of ['http://0.0.0.0:8123/api/auth/google', 'http://127.0.0.1:8000/api/auth/google', 'https://preview.example/api/auth/google', 'http://auth-fixture.example/api/auth/google']) assert.equal(googleRequestMatchesOrigin(supplied(url), canonical), false);
    const rejectedHeaders: HeadersInit[] = [{}, { Host: 'preview.example' }, { Host: host + ':443' }, { Host: `${host}, preview.example` }, new Headers([['Host', host], ['Host', 'preview.example']]), { Host: 'preview.example', 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' }, { 'X-Forwarded-Host': host, 'X-Forwarded-Proto': 'https' }];
    for (const headers of rejectedHeaders) {
      assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google', headers), canonical), false);
      assert.equal(googleRequestMatchesOrigin(supplied(canonical + '/api/auth/google', headers), canonical), false);
    }
    assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google', { Host: host, 'X-Forwarded-Host': 'preview.example', 'X-Forwarded-Proto': 'ftp' }), canonical), true);
    process.env.PORT = '8123';
    assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8123/api/auth/google'), canonical), true);
    assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google'), canonical), false);
    process.env.PORT = '80'; assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0/api/auth/google'), canonical), true);
    process.env.PORT = '443'; assert.equal(googleRequestMatchesOrigin(supplied('https://0.0.0.0/api/auth/google'), canonical), true);
    for (const port of ['0', '65536', '-1', '8000,8123', 'invalid']) { process.env.PORT = port; assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google'), canonical), false); }
    delete process.env.PORT;
    assert.equal(googleRequestMatchesOrigin(supplied('http://0.0.0.0:8000/api/auth/google', { Host: 'localhost:3000' }), origin), false);
    process.env.APP_URL = 'http://auth-fixture.example'; assert.equal(googleConfiguration(), null);
  });
  await test('local loopback normalization preserves exact Host, protocol and effective port outside deployment', async () => {
    for (const canonical of ['http://127.0.0.1:3010', 'http://[::1]:3010', 'https://127.0.0.1:8443', 'https://[::1]:8443', 'http://127.0.0.1', 'https://[::1]']) {
      process.env.APP_URL = canonical;
      const expected = new URL(canonical);
      const supplied = (url = canonical, host = expected.host) => new NextRequest(url + '/api/auth/google', { headers: { Host: host } });
      const normalized = supplied(); assert.equal(normalized.nextUrl.hostname, 'localhost');
      assert.equal(googleRequestMatchesOrigin(normalized, canonical), true);
      const redirected = new URL((await start(normalized)).headers.get('location')!);
      assert.equal(redirected.origin, 'https://accounts.google.com');
      assert.equal(redirected.searchParams.get('redirect_uri'), canonical + '/api/auth/google/callback');
      for (const wrongHost of ['localhost' + (expected.port ? ':' + expected.port : ''), 'preview.example', expected.host + ', preview.example']) assert.equal(googleRequestMatchesOrigin(supplied(canonical, wrongHost), canonical), false);
      const changedPort = new URL(canonical); changedPort.port = '3011';
      assert.equal(googleRequestMatchesOrigin(supplied(changedPort.origin), canonical), false);
      const changedProtocol = new URL(canonical); changedProtocol.protocol = expected.protocol === 'http:' ? 'https:' : 'http:';
      assert.equal(googleRequestMatchesOrigin(supplied(changedProtocol.origin), canonical), false);
      process.env.DENO_DEPLOY = 'true'; assert.equal(googleRequestMatchesOrigin(normalized, canonical), false);
      delete process.env.DENO_DEPLOY;
    }
  });
  await test('deployed standalone reconstruction preserves canonical login, cancellation, replay and reauthentication', async () => {
    const canonical = 'https://auth-fixture.example';
    process.env.APP_URL = canonical; process.env.DENO_DEPLOY = 'true';
    const deployed = (path: string, cookies = '', host = 'auth-fixture.example') => new NextRequest(`http://0.0.0.0:8000${path}`, { headers: { Host: host, ...(cookies ? { Cookie: cookies } : {}) } });
    const begin = async (session = '', intent = 'login') => {
      const response = await start(deployed(`/api/auth/google?intent=${intent}`, session));
      const url = new URL(response.headers.get('location')!);
      assert.equal(url.origin, 'https://accounts.google.com');
      assert.equal(url.searchParams.get('redirect_uri'), canonical + '/api/auth/google/callback');
      assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
      const state = url.searchParams.get('state')!;
      providerNonce = (await kv.get<OAuthState>(['google-oauth', digest(state)])).value!.nonce;
      return { state, browser: cookie(response, oauthCookie), session };
    };
    result(await start(deployed('/api/auth/google', '', 'preview.example')), 'origin_mismatch', false, canonical);
    const cancelled = await begin();
    result(await callback(deployed(`/api/auth/google/callback?state=${cancelled.state}&error=access_denied`, cancelled.browser)), 'cancelled', false, canonical);
    result(await callback(deployed(`/api/auth/google/callback?state=${cancelled.state}&code=fixture-code`, cancelled.browser)), 'invalid_state', false, canonical);
    assert.equal(tokenCalls, 0);
    const started = await begin();
    result(await callback(deployed(`/api/auth/google/callback?state=${started.state}&code=fixture-code`, started.browser, 'preview.example')), 'origin_mismatch', false, canonical);
    assert.equal(tokenCalls, 0);
    const signedIn = await callback(deployed(`/api/auth/google/callback?state=${started.state}&code=fixture-code`, started.browser));
    result(signedIn, 'signed_in', true, canonical);
    const session = cookie(signedIn); assert.equal((await currentUser(request('/', session)))?.email, identity.email);
    const reauthentication = await begin(session, 'reauthenticate');
    result(await callback(deployed(`/api/auth/google/callback?state=${reauthentication.state}&code=fixture-code`, `${session}; ${reauthentication.browser}`)), 'reauthenticated', true, canonical);
    assert.ok((await currentSession(request('/', session)))?.entry.value?.googleReauthenticatedAt);
  });
  await test('deployed Google linking retains canonical Origin and password/session proof', async () => {
    const account = await register();
    const canonical = 'https://auth-fixture.example';
    process.env.APP_URL = canonical; process.env.DENO_DEPLOY = 'true';
    const linking = (headers: Record<string, string>) => link(new NextRequest('http://0.0.0.0:8000/api/auth/google', { method: 'POST', headers: { Host: 'auth-fixture.example', Origin: canonical, 'Content-Type': 'application/json', Cookie: account.session, ...headers }, body: JSON.stringify({ password: testPassword }) }));
    assert.equal((await linking({ Origin: 'https://preview.example' })).status, 403);
    assert.equal((await linking({ Host: 'preview.example', 'X-Forwarded-Host': 'auth-fixture.example' })).status, 403);
    const response = await linking({}); assert.equal(response.status, 200);
    const url = new URL((await response.json()).url); assert.equal(url.searchParams.get('redirect_uri'), canonical + '/api/auth/google/callback');
    const state = url.searchParams.get('state')!; providerNonce = (await kv.get<OAuthState>(['google-oauth', digest(state)])).value!.nonce;
    const linked = await callback(new NextRequest(`http://0.0.0.0:8000/api/auth/google/callback?state=${state}&code=fixture-code`, { headers: { Host: 'auth-fixture.example', Cookie: `${account.session}; ${cookie(response, oauthCookie)}` } }));
    result(linked, 'linked', true, canonical);
    assert.equal((await currentUser(request('/', account.session)))?.google?.subject, identity.subject);
  });
  await test('state is bound to browser, expires and is consumed atomically once', async () => {
    const started = await flow();
    result(await finish(started, 'code=fixture-code', '', `${oauthCookie}=${token()}`), 'invalid_state');
    assert.equal(tokenCalls, 0);
    const requests = [consumeOAuthState(request(`/api/auth/google/callback?state=${started.state}`, started.browser)), consumeOAuthState(request(`/api/auth/google/callback?state=${started.state}`, started.browser))];
    const responses = await Promise.allSettled(requests);
    assert.equal(responses.filter(response => response.status === 'fulfilled').length, 1);
    assert.equal(responses.filter(response => response.status === 'rejected').length, 1);
    const expired = await flow();
    await kv.set(['google-oauth', digest(expired.state)], { ...expired.record, createdAt: Date.now() - oauthTTL - 1 });
    result(await finish(expired), 'invalid_state');
  });
  await test('provider cancellation consumes state and never creates a session', async () => {
    const started = await flow(); result(await finish(started, 'error=access_denied'), 'cancelled');
    result(await finish(started), 'invalid_state');
    assert.equal(tokenCalls, 0); assert.equal((await get('me')).user, null);
  });
  await test('signed Google login creates one identity and safe public session', async () => {
    const started = await flow(); const response = await finish(started); result(response, 'signed_in', true);
    const session = cookie(response); const me = (await get('me', session)).user;
    assert.equal(me.email, identity.email); assert.equal(me.hasPassword, false); assert.equal(me.googleLinked, true);
    assert.equal(me.password, undefined); assert.equal(me.google, undefined);
    const again = await finish(await flow()); result(again, 'signed_in', true);
    assert.equal((await get('me', cookie(again))).user.id, me.id);
    assert.equal(response.cookies.get('fb_session')?.httpOnly, true);
    assert.equal(response.cookies.get('fb_session')?.sameSite, 'lax');
  });
  await test('ID token signature, nonce, issuer, audience, authorized party, verified email and time are required', async () => {
    for (const overrides of [{ nonce: 'wrong' }, { iss: 'https://evil.example' }, { aud: 'other-client' }, { azp: 'other-client' }, { email_verified: false }, { exp: Math.floor(Date.now() / 1000) - 1 }, { iat: Math.floor(Date.now() / 1000) + 120 }, { sub: 'bad\nsubject' }, { email: 'invalid' }]) {
      const started = await flow(); providerOverrides = overrides; result(await finish(started), 'invalid_identity');
    }
    const started = await flow(); providerOverrides = {}; invalidSignature = true; result(await finish(started), 'invalid_identity');
    assert.equal((await kv.get(['google-user', identity.subject])).value, null);
    const now = Math.floor(Date.now() / 1000);
    assert.throws(() => verifiedGoogleClaims({ iss: 'https://accounts.google.com', aud: clientId, sub: 'valid', email: identity.email, email_verified: true, iat: now - 300, exp: now + 300, nonce: 'fixture' } as TokenPayload & { nonce: string }, 'fixture', clientId, Date.now()), OAuthError);
  });
  await test('exchange errors never leak provider response or issue a session', async () => {
    const started = await flow(); providerStatus = 400; result(await finish(started), 'exchange_failed');
    assert.equal((await kv.get(['google-user', identity.subject])).value, null);
  });
  await test('existing password account requires explicit password-authenticated Google link', async () => {
    const account = await register(); result(await finish(await flow()), 'link_required');
    const wrong = await link(request('/api/auth/google', account.session, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) }));
    assert.equal(wrong.status, 401);
    const response = await link(request('/api/auth/google', account.session, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: testPassword }) }));
    assert.equal(response.status, 200);
    const location = new URL((await response.json()).url); const state = location.searchParams.get('state')!;
    const record = (await kv.get<OAuthState>(['google-oauth', digest(state)])).value!;
    providerNonce = record.nonce;
    result(await finish({ state, record, browser: cookie(response, oauthCookie), session: account.session }), 'linked', true);
    assert.equal((await get('me', account.session)).user.googleLinked, true);
    const signedIn = await finish(await flow()); result(signedIn, 'signed_in', true);
    assert.equal((await get('me', cookie(signedIn))).user.id, account.user.id);
  });
  await test('link callback rejects changed session, password rotation, email mismatch and logout race', async () => {
    const account = await register();
    const state: OAuthState = { browserDigest: digest(token()), verifier: token(), nonce: token(), returnTo: '/hesabim', intent: 'link', userId: account.user.id, sessionDigest: digest(account.session.split('=')[1]), authVersion: 0, createdAt: Date.now() };
    await assert.rejects(resolveGoogleUser({ ...identity, email: 'different@example.com' }, state, request('/api/auth/google/callback', account.session)), { code: 'email_mismatch' });
    const other = await post('login', { email: identity.email, password: testPassword });
    await assert.rejects(resolveGoogleUser(identity, state, request('/api/auth/google/callback', cookie(other.response))), { code: 'session_changed' });
    await withCommitRace(keys => keys.some(key => key[0] === 'google-user'), () => kv.delete(['session', state.sessionDigest!]), async () => {
      await assert.rejects(resolveGoogleUser(identity, state, request('/api/auth/google/callback', account.session)), { code: 'retry' });
    });
    assert.equal((await kv.get(['google-user', identity.subject])).value, null);
    await kv.set(['user', account.user.id], { ...account.user, authVersion: 1 });
    await assert.rejects(resolveGoogleUser(identity, state, request('/api/auth/google/callback', cookie(other.response))), { code: 'session_changed' });
  });
  await test('link rejects malformed, primitive, oversized, cross-origin and unbounded password attempts', async () => {
    const account = await register();
    for (const [body, contentType, suppliedOrigin, expected] of [['{}', 'text/plain', origin, 415], ['null', 'application/json', origin, 400], ['[]', 'application/json', origin, 400], ['{bad', 'application/json', origin, 400], [JSON.stringify({ password: 'ü'.repeat(600) }), 'application/json', origin, 413], ['{}', 'application/json', 'https://evil.example', 403]] as const) {
      assert.equal((await link(request('/api/auth/google', account.session, { method: 'POST', headers: { Origin: suppliedOrigin, 'Content-Type': contentType }, body }))).status, expected);
    }
    for (let attempt = 0; attempt < 11; attempt++) await link(request('/api/auth/google', account.session, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': `spoof-${attempt}` }, body: JSON.stringify({ password: 'wrong' }) }));
    assert.equal((await link(request('/api/auth/google', account.session, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'x-forwarded-for': 'another-spoof' }, body: JSON.stringify({ password: testPassword }) }))).status, 429);
  });
  await test('password changes rotate recovery, preserve whitespace and invalidate other sessions', async () => {
    assert.equal(password(testPassword), testPassword); assert.equal(verifyPassword('x', 'malformed'), false);
    const account = await register(); const second = await post('login', { email: identity.email, password: testPassword });
    await post('login', { email: identity.email, password: testPassword.trim() }, '', 401);
    await post('password', { currentPassword: 'wrong', password: 'next correct password' }, account.session, 401);
    const updated = await post('password', { currentPassword: testPassword, password: 'next correct password' }, account.session);
    assert.ok(updated.body.recoveryCode); assert.notEqual(updated.body.recoveryCode, account.body.recoveryCode);
    assert.equal((await get('me', account.session)).user, null); assert.equal((await get('me', cookie(second.response))).user, null);
    assert.ok((await get('me', cookie(updated.response))).user);
    await post('recover', { email: identity.email, recoveryCode: account.body.recoveryCode, password: 'recovered password' }, '', 401);
    const recovered = await post('recover', { email: identity.email, recoveryCode: updated.body.recoveryCode, password: 'recovered password' }, cookie(updated.response));
    assert.equal(recovered.response.cookies.get('fb_session')?.value, ''); assert.ok(recovered.body.recoveryCode);
    assert.equal((await get('me', cookie(updated.response))).user, null);
    await post('login', { email: identity.email, password: 'next correct password' }, '', 401);
    await post('login', { email: identity.email, password: 'recovered password' });
  });
  await test('revocation never removes newly authenticated sessions and expired sessions fail closed', async () => {
    const account = await register();
    const updated = { ...account.user, authVersion: 1 }; await kv.set(['user', updated.id], updated);
    const response = await createSession(updated, NextResponse.json({ ok: true }));
    await revokeSessions(updated.id, 1);
    assert.ok(await currentUser(request('/api/store/me', cookie(response))));
    const secret = cookie(response).split('=')[1]; const session = (await kv.get<Session>(['session', digest(secret)])).value!;
    await kv.set(['session', digest(secret)], { ...session, createdAt: Date.now() - sessionTTL - 1 });
    assert.equal(await currentSession(request('/api/store/me', cookie(response))), null);
    assert.equal(await currentSession(request('/api/store/me', 'fb_session=malformed')), null);
  });
  await test('profile write is rejected when logout wins the atomic commit race', async () => {
    const account = await register();
    await withCommitRace(keys => keys.some(key => key[0] === 'user'), () => kv.delete(['session', digest(account.session.split('=')[1])]), async () => {
      await post('profile', { name: 'Unauthorized mutation' }, account.session, 409);
    });
    assert.equal((await kv.get<User>(['user', account.user.id])).value!.name, 'Auth Fixture');
  });
  await test('session creation and password recovery cannot resurrect a concurrently deleted account', async () => {
    const account = await register();
    await withCommitRace(keys => keys.some(key => key[0] === 'session'), () => kv.delete(['user', account.user.id]), async () => {
      await assert.rejects(createSession(account.user, NextResponse.json({ ok: true })), /Account changed/);
    });
    await kv.set(['user', account.user.id], account.user);
    await withCommitRace(keys => keys.some(key => key[0] === 'user'), async () => { await kv.set(['user', account.user.id], { ...account.user, deletingAt: new Date().toISOString(), authVersion: 1 }); }, async () => {
      await post('recover', { email: identity.email, recoveryCode: account.body.recoveryCode, password: 'recovered password' }, '', 409);
    });
    assert.equal((await kv.get<User>(['user', account.user.id])).value!.password, account.user.password);
    assert.ok((await kv.get<User>(['user', account.user.id])).value!.deletingAt);
  });
  await test('Google-only deletion needs recent same-session provider proof and explicit confirmation', async () => {
    const response = await finish(await flow()); const session = cookie(response); const user = (await get('me', session)).user;
    const denied = await post('delete', { confirmation: 'HESABIMI SİL' }, session, 401); assert.equal(denied.body.code, 'reauthentication_required');
    const started = await flow(session, 'reauthenticate'); result(await finish(started), 'reauthenticated', true);
    const before = (await kv.get<Session>(['session', digest(session.split('=')[1])])).value!; assert.ok(before.googleReauthenticatedAt);
    await post('delete', { confirmation: 'wrong' }, session, 400);
    const second = cookie(await finish(await flow()));
    await post('delete', { confirmation: 'HESABIMI SİL' }, second, 401);
    await post('delete', { confirmation: 'HESABIMI SİL' }, session);
    assert.equal((await kv.get(['user', user.id])).value, null); assert.equal((await kv.get(['google-user', identity.subject])).value, null);
    assert.equal((await get('me', second)).user, null);
  });
  await test('reauthentication rejects wrong identity, changed session and user mutation during commit', async () => {
    const session = cookie(await finish(await flow()));
    const wrong = await flow(session, 'reauthenticate'); providerOverrides = { sub: 'wrong-google-account' }; result(await finish(wrong), 'wrong_account');
    providerOverrides = {}; const changed = await flow(session, 'reauthenticate');
    const second = cookie(await finish(await flow())); providerNonce = changed.record.nonce; result(await finish(changed, 'code=fixture-code', second), 'session_changed');
    const raced = await flow(session, 'reauthenticate'); const user = (await currentUser(request('/api/store/me', session)))!;
    await withCommitRace(keys => keys.some(key => key[0] === 'session'), async () => { await kv.set(['user', user.id], { ...user, authVersion: 1 }); }, async () => { result(await finish(raced), 'session_changed'); });
    assert.equal((await kv.get<Session>(['session', digest(session.split('=')[1])])).value?.googleReauthenticatedAt, undefined);
  });
  await test('transient account deletion keeps only initiating session able to resume cleanup', async () => {
    const account = await register(); const other = cookie((await post('login', { email: identity.email, password: testPassword })).response);
    const order = { id: 'fixture-order', userId: account.user.id }; await kv.set(['order', order.id], order); await kv.set(['orders', account.user.id, order.id], order);
    const originalDelete = kv.delete; let failed = false;
    kv.delete = async key => { if (!failed && key[0] === 'order') { failed = true; throw new Error('Simulated transient KV failure'); } await originalDelete.call(kv, key); };
    try { await post('delete', { password: testPassword }, account.session, 503); }
    finally { kv.delete = originalDelete; }
    assert.equal(failed, true); assert.equal(await currentUser(request('/api/store/me', account.session)), null);
    assert.ok(await deletionSession(request('/api/store/me', account.session))); assert.equal(await deletionSession(request('/api/store/me', other)), null);
    assert.equal((await get('me', account.session)).deletionPending, true); assert.equal((await get('me', other)).user, null);
    await post('profile', { name: 'Blocked' }, account.session, 401); await post('delete', { password: testPassword }, other, 401);
    await post('delete', { password: 'wrong' }, account.session, 401); await post('delete', { password: testPassword }, account.session);
    for (const key of [['user', account.user.id], ['email', identity.email], ['order', order.id], ['orders', account.user.id, order.id]]) assert.equal((await kv.get(key)).value, null);
    await register(); // Released email index can be reused only after final deletion.
  });
  await test('pending Google-only deletion can renew expired proof without restoring normal access', async () => {
    const session = cookie(await finish(await flow())); const user = (await get('me', session)).user;
    result(await finish(await flow(session, 'reauthenticate')), 'reauthenticated', true);
    const order = { id: 'google-order', userId: user.id }; await kv.set(['order', order.id], order); await kv.set(['orders', user.id, order.id], order);
    const originalDelete = kv.delete; let failed = false;
    kv.delete = async key => { if (!failed && key[0] === 'order') { failed = true; throw new Error('Simulated transient KV failure'); } await originalDelete.call(kv, key); };
    try { await post('delete', { confirmation: 'HESABIMI SİL' }, session, 503); }
    finally { kv.delete = originalDelete; }
    const key = ['session', digest(session.split('=')[1])]; const stored = (await kv.get<Session>(key)).value!;
    await kv.set(key, { ...stored, googleReauthenticatedAt: Date.now() - 6 * 60_000 });
    await post('delete', { confirmation: 'HESABIMI SİL' }, session, 401);
    result(await finish(await flow(session, 'reauthenticate')), 'reauthenticated', true);
    assert.equal(await currentUser(request('/api/store/me', session)), null);
    await post('delete', { confirmation: 'HESABIMI SİL' }, session);
    assert.equal((await kv.get(['user', user.id])).value, null);
  });
  console.log(`PASS: ${passed} authentication security suites with isolated Deno KV and signed provider fixtures.`);
} finally {
  globalThis.fetch = originalFetch;
  OAuth2Client.prototype.getFederatedSignonCertsAsync = originalCertificates;
  Object.defineProperty(runtime, 'openKv', { value: originalOpenKv, configurable: true });
  if (originalDeployment === undefined) delete process.env.DENO_DEPLOY; else process.env.DENO_DEPLOY = originalDeployment;
  if (originalPort === undefined) delete process.env.PORT; else process.env.PORT = originalPort;
  kv.close();
}
