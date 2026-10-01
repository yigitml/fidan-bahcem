import { NextRequest, NextResponse } from 'next/server';
import { database } from '@/lib/database';
import { digest, token } from '@/lib/security';

export type User = {
  id: string;
  email: string;
  name: string;
  password?: string;
  recovery?: string;
  google?: { subject: string; email: string };
  createdAt: string;
  authVersion?: number;
  deletingAt?: string;
  deletionSessionDigest?: string;
};
export type PublicUser = { id: string; email: string; name: string; hasPassword: boolean; googleLinked: boolean };
export type Session = { userId: string; authVersion?: number; createdAt?: number; googleReauthenticatedAt?: number };
export const sessionCookie = 'fb_session';
export const sessionTTL = 7 * 24 * 60 * 60 * 1000;
export const recentAuthenticationTTL = 5 * 60 * 1000;

export function publicUser(user: User): PublicUser {
  return { id: user.id, email: user.email, name: user.name, hasPassword: !!user.password, googleLinked: !!user.google };
}

async function readSession(request: NextRequest, allowPendingDeletion = false) {
  const secret = request.cookies.get(sessionCookie)?.value;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret)) return null;
  const db = await database();
  const entry = await db.get<Session>(['session', digest(secret)]);
  if (!entry.value) return null;
  if (entry.value.createdAt !== undefined && (!Number.isFinite(entry.value.createdAt) || entry.value.createdAt > Date.now() || Date.now() - entry.value.createdAt >= sessionTTL)) return null;
  const userEntry = await db.get<User>(['user', entry.value.userId]);
  const user = userEntry.value;
  if (!user) return null;
  if (user.deletingAt) {
    if (!allowPendingDeletion || user.deletionSessionDigest !== digest(secret) || (entry.value.authVersion || 0) + 1 !== user.authVersion) return null;
  } else if ((entry.value.authVersion || 0) !== (user.authVersion || 0)) return null;
  return { user, userEntry, entry };
}

export const currentSession = (request: NextRequest) => readSession(request);
// Only the delete route may resume an already-authorized deletion after a transient KV failure.
export const deletionSession = (request: NextRequest) => readSession(request, true);

export async function currentUser(request: NextRequest): Promise<User | null> {
  return (await currentSession(request))?.user || null;
}

export async function createSession(user: User, response: NextResponse) {
  const db = await database();
  const current = await db.get<User>(['user', user.id]);
  if (!current.value || current.value.deletingAt || (current.value.authVersion || 0) !== (user.authVersion || 0)) throw new Error('Account changed during authentication');
  const secret = token();
  const saved = await db.atomic().check(current).set(['session', digest(secret)], {
    userId: user.id, authVersion: user.authVersion || 0, createdAt: Date.now(),
  } satisfies Session, { expireIn: sessionTTL }).commit();
  if (!saved.ok) throw new Error('Account changed during authentication');
  response.cookies.set(sessionCookie, secret, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: sessionTTL / 1000 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function signedIn(user: User, extra: Record<string, unknown> = {}) {
  return createSession(user, NextResponse.json({ user: publicUser(user), ...extra }));
}

export function clearSession(response: NextResponse) {
  response.cookies.set(sessionCookie, '', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export async function revokeSessions(userId: string, minimumAuthVersion = Infinity) {
  const db = await database();
  for await (const entry of db.list<Session>({ prefix: ['session'] })) {
    if (entry.value?.userId === userId && (entry.value.authVersion || 0) < minimumAuthVersion) await db.atomic().check(entry).delete(entry.key).commit();
  }
}
