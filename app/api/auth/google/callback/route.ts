import { NextRequest } from 'next/server';
import { createSession, deletionSession, sessionTTL } from '@/lib/auth';
import { database } from '@/lib/database';
import { OAuthError, consumeOAuthState, exchangeGoogleCode, googleConfiguration, googleRequestMatchesOrigin, oauthResult, resolveGoogleUser } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  let returnTo = '/hesabim';
  try {
    const configuration = googleConfiguration();
    if (!configuration) throw new OAuthError('unavailable');
    if (!googleRequestMatchesOrigin(request, configuration.origin)) throw new OAuthError('origin_mismatch');
    const state = await consumeOAuthState(request);
    returnTo = state.returnTo;
    if (request.nextUrl.searchParams.has('error')) throw new OAuthError(request.nextUrl.searchParams.get('error') === 'access_denied' ? 'cancelled' : 'provider_error');
    const code = request.nextUrl.searchParams.get('code');
    if (!code || code.length > 4096) throw new OAuthError('invalid_request');
    const identity = await exchangeGoogleCode(code, state);
    const user = await resolveGoogleUser(identity, state, request);
    const response = oauthResult(request, state.intent === 'link' ? 'linked' : state.intent === 'reauthenticate' ? 'reauthenticated' : 'signed_in', returnTo, true);
    if (state.intent === 'reauthenticate') {
      const session = await deletionSession(request);
      if (!session?.entry.value?.createdAt || session.user.id !== user.id || (session.user.authVersion || 0) !== state.authVersion || session.entry.key[1] !== state.sessionDigest) throw new OAuthError('session_changed');
      const remainingTTL = Math.max(1, sessionTTL - (Date.now() - session.entry.value.createdAt));
      if (!(await (await database()).atomic().check(session.entry).check(session.userEntry).set(session.entry.key, { ...session.entry.value, googleReauthenticatedAt: Date.now() }, { expireIn: remainingTTL }).commit()).ok) throw new OAuthError('session_changed');
      return response;
    }
    if (state.intent === 'link') return response;
    return await createSession(user, response);
  } catch (error) { return oauthResult(request, error instanceof OAuthError ? error.code : 'unavailable', returnTo); }
}
