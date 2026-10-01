import { createHash, timingSafeEqual } from 'node:crypto';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/database';
import { currentSession, deletionSession, type User } from '@/lib/auth';
import { digest, email, token } from '@/lib/security';
import { RequestError, takeRateLimit } from '@/lib/http-security';

export const oauthCookie = 'fb_google_oauth';
export const oauthTTL = 10 * 60 * 1000;
export type OAuthIntent = 'login' | 'link' | 'reauthenticate';
export type OAuthState = {
  browserDigest: string;
  nonce: string;
  verifier: string;
  returnTo: string;
  intent: OAuthIntent;
  userId?: string;
  sessionDigest?: string;
  authVersion?: number;
  createdAt: number;
};
export class OAuthError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export function googleConfiguration() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const value = process.env.APP_URL?.trim();
  if (!clientId || !clientSecret || !value || !clientId.endsWith('.apps.googleusercontent.com')) return null;
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null;
    return { clientId, clientSecret, origin: url.origin, redirectUri: `${url.origin}/api/auth/google/callback` };
  } catch { return null; }
}

export function googleRequestMatchesOrigin(request: NextRequest, origin: string): boolean {
  const canonical = new URL(origin);
  const host = request.headers.get('host');
  const url = request.nextUrl;
  if (!host || host.toLowerCase() !== canonical.host || url.username || url.password) return false;
  if (url.origin === canonical.origin) return true;
  const requestPort = url.port || (url.protocol === 'https:' ? '443' : '80');
  const canonicalPort = canonical.port || (canonical.protocol === 'https:' ? '443' : '80');
  // NextURL rewrites loopback IPs to localhost; retain the exact incoming Host.
  if (process.env.DENO_DEPLOY !== 'true' && ['127.0.0.1', '[::1]'].includes(canonical.hostname) && url.hostname === 'localhost' && url.protocol === canonical.protocol && requestPort === canonicalPort) return true;
  // Next's standalone server builds NextRequest URLs from its listener address.
  // On Deno Deploy, identify the public host using Host, never forwarding headers.
  if (process.env.DENO_DEPLOY !== 'true' || canonical.protocol !== 'https:') return false;
  const port = process.env.PORT || '8000';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535) return false;
  return url.hostname === '0.0.0.0' && requestPort === String(Number(port)) && ['http:', 'https:'].includes(url.protocol);
}

export function safeReturnTo(value: string | null | undefined) {
  if (!value || value.length > 500 || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u0020]/.test(value)) return '/hesabim';
  try {
    const url = new URL(value, 'https://internal.invalid');
    if (url.origin !== 'https://internal.invalid' || !['/', '/hesabim', '/odeme', '/fidanlar'].includes(url.pathname)) return '/hesabim';
    return url.pathname;
  } catch { return '/hesabim'; }
}

export function equalSecrets(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clearOAuth(response: NextResponse) {
  response.cookies.set(oauthCookie, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export function oauthResult(request: NextRequest, code: string, returnTo = '/hesabim', success = false) {
  const origin = googleConfiguration()?.origin || request.nextUrl.origin;
  const destination = new URL(safeReturnTo(returnTo), origin);
  destination.searchParams.set(success ? 'auth_success' : 'auth_error', code);
  return clearOAuth(NextResponse.redirect(destination, 303));
}

export async function startOAuth(request: NextRequest, intent: OAuthIntent = 'login', user?: User) {
  const configuration = googleConfiguration();
  if (!configuration) throw new OAuthError('unavailable');
  if (!googleRequestMatchesOrigin(request, configuration.origin)) throw new OAuthError('origin_mismatch');
  const db = await database();
  try { await takeRateLimit(request, 'google-start'); }
  catch (error) { if (error instanceof RequestError) throw new OAuthError('rate_limited'); throw error; }
  const state = token(); const browser = token(); const verifier = token();
  const session = intent === 'login' ? null : await (intent === 'reauthenticate' ? deletionSession(request) : currentSession(request));
  if (intent !== 'login' && (!user || !session || session.user.id !== user.id || session.user.password !== user.password || (session.user.authVersion || 0) !== (user.authVersion || 0))) throw new OAuthError('session_changed');
  const record: OAuthState = {
    browserDigest: digest(browser), nonce: token(), verifier,
    returnTo: safeReturnTo(request.nextUrl.searchParams.get('returnTo')), intent,
    createdAt: Date.now(), ...(user && session ? { userId: user.id, sessionDigest: session.entry.key[1] as string, authVersion: user.authVersion || 0 } : {}),
  };
  await db.set(['google-oauth', digest(state)], record, { expireIn: oauthTTL });
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: configuration.clientId, redirect_uri: configuration.redirectUri, response_type: 'code',
    scope: 'openid email profile', state, nonce: record.nonce, code_challenge_method: 'S256',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    prompt: intent === 'reauthenticate' ? 'consent select_account' : 'select_account', hl: 'tr',
  }).toString();
  const response = NextResponse.redirect(url, 303);
  response.cookies.set(oauthCookie, browser, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/api/auth/google', maxAge: oauthTTL / 1000 });
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  return response;
}

export async function consumeOAuthState(request: NextRequest) {
  const state = request.nextUrl.searchParams.get('state');
  const browser = request.cookies.get(oauthCookie)?.value;
  if (!state || !/^[a-f0-9]{64}$/.test(state) || !browser || !/^[a-f0-9]{64}$/.test(browser)) throw new OAuthError('invalid_state');
  const db = await database();
  const entry = await db.get<OAuthState>(['google-oauth', digest(state)]);
  if (!entry.value || !equalSecrets(entry.value.browserDigest, digest(browser)) || entry.value.createdAt > Date.now() || Date.now() - entry.value.createdAt > oauthTTL) throw new OAuthError('invalid_state');
  if (!(await db.atomic().check(entry).delete(entry.key).commit()).ok) throw new OAuthError('invalid_state');
  return entry.value;
}

type GoogleIdentity = { subject: string; email: string; name: string };
export function verifiedGoogleClaims(payload: (TokenPayload & { nonce?: string }) | undefined, expectedNonce: string, clientId: string, issuedAfter: number): GoogleIdentity {
  const now = Math.floor(Date.now() / 1000);
  if (!payload || typeof payload.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(payload.sub) || payload.email_verified !== true || typeof payload.email !== 'string' ||
    payload.aud !== clientId || (payload.azp && payload.azp !== clientId) || !['https://accounts.google.com', 'accounts.google.com'].includes(payload.iss) ||
    !Number.isFinite(payload.exp) || payload.exp <= now || !Number.isFinite(payload.iat) || payload.iat > now + 60 || payload.iat < Math.floor(issuedAfter / 1000) - 60 ||
    !equalSecrets(payload.nonce, expectedNonce)) throw new OAuthError('invalid_identity');
  try {
    return { subject: payload.sub, email: email(payload.email), name: payload.name?.trim().slice(0, 100) || 'Fidan Bahçem Üyesi' };
  } catch { throw new OAuthError('invalid_identity'); }
}

export async function exchangeGoogleCode(code: string, state: OAuthState) {
  const configuration = googleConfiguration();
  if (!configuration) throw new OAuthError('unavailable');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: configuration.clientId, client_secret: configuration.clientSecret,
      redirect_uri: configuration.redirectUri, grant_type: 'authorization_code', code, code_verifier: state.verifier }),
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new OAuthError('exchange_failed');
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || !('id_token' in result) || typeof result.id_token !== 'string') throw new OAuthError('exchange_failed');
  const client = new OAuth2Client({ clientId: configuration.clientId, transporterOptions: { timeout: 15000 } });
  try {
    const ticket = await client.verifyIdToken({ idToken: result.id_token, audience: configuration.clientId });
    return verifiedGoogleClaims(ticket.getPayload(), state.nonce, configuration.clientId, state.createdAt);
  } catch { throw new OAuthError('invalid_identity'); }
}

export async function resolveGoogleUser(identity: GoogleIdentity, state: OAuthState, request: NextRequest): Promise<User> {
  const db = await database();
  if (state.intent !== 'login') {
    const session = await (state.intent === 'reauthenticate' ? deletionSession(request) : currentSession(request));
    const user = session?.user;
    if (!session || !user || !state.userId || user.id !== state.userId || (user.authVersion || 0) !== state.authVersion || !equalSecrets(state.sessionDigest, session.entry.key[1] as string)) throw new OAuthError('session_changed');
    if (state.intent === 'reauthenticate') {
      if (user.google?.subject !== identity.subject) throw new OAuthError('wrong_account');
      return user;
    }
    if (user.google && user.google.subject !== identity.subject) throw new OAuthError('already_linked');
    // Password accounts prove ownership before linking; matching email alone cannot prove it.
    if (identity.email !== user.email) throw new OAuthError('email_mismatch');
    const google = await db.get<string>(['google-user', identity.subject]);
    const entry = session.userEntry;
    if (google.value && google.value !== user.id) throw new OAuthError('already_linked');
    if (!entry.value || entry.value.deletingAt || entry.value.google?.subject && entry.value.google.subject !== identity.subject) throw new OAuthError('session_changed');
    const linked = { ...entry.value, google: { subject: identity.subject, email: identity.email } };
    if (!(await db.atomic().check(google).check(entry).check(session.entry).set(google.key, user.id).set(entry.key, linked).commit()).ok) throw new OAuthError('retry');
    return linked;
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const google = await db.get<string>(['google-user', identity.subject]);
    if (google.value) {
      const user = (await db.get<User>(['user', google.value])).value;
      if (!user || user.deletingAt || user.google?.subject !== identity.subject) throw new OAuthError('invalid_identity');
      return user;
    }
    const existing = await db.get<string>(['email', identity.email]);
    if (existing.value) throw new OAuthError('link_required');
    const user: User = { id: crypto.randomUUID(), email: identity.email, name: identity.name, google: { subject: identity.subject, email: identity.email }, createdAt: new Date().toISOString() };
    if ((await db.atomic().check(google).check(existing).set(google.key, user.id).set(existing.key, user.id).set(['user', user.id], user).commit()).ok) return user;
  }
  throw new OAuthError('retry');
}
