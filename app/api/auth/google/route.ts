import { NextRequest, NextResponse } from 'next/server';
import { currentUser, deletionSession } from '@/lib/auth';
import { OAuthError, googleConfiguration, googleRequestMatchesOrigin, oauthResult, startOAuth } from '@/lib/google-oauth';
import { password, verifyPassword } from '@/lib/security';
import { readJsonObject, RequestError, sameOrigin, takeRateLimit } from '@/lib/http-security';

export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const intent = request.nextUrl.searchParams.get('intent');
    if (intent && intent !== 'login' && intent !== 'reauthenticate') throw new OAuthError('invalid_request');
    const user = intent === 'reauthenticate' ? (await deletionSession(request))?.user : undefined;
    if (intent === 'reauthenticate' && !user?.google) throw new OAuthError('session_changed');
    return await startOAuth(request, intent === 'reauthenticate' ? 'reauthenticate' : 'login', user || undefined);
  } catch (error) { return oauthResult(request, error instanceof OAuthError ? error.code : 'unavailable'); }
}

export async function POST(request: NextRequest) {
  const failure = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } });
  try {
    const configuration = googleConfiguration();
    if (!configuration) return failure('Google ile giriş şu anda kullanılamıyor.', 503);
    if (!sameOrigin(request) || !googleRequestMatchesOrigin(request, configuration.origin)) return failure('İstek reddedildi.', 403);
    await takeRateLimit(request, 'google-link');
    const data = await readJsonObject(request, 1000);
    const user = await currentUser(request);
    if (!user?.password) return failure('Şifreli hesabınızla giriş yapmanız gerekiyor.', 401);
    if (user.google) return failure('Google hesabınız zaten bağlı.', 409);
    if (!verifyPassword(password(data.password), user.password)) return failure('Şifre hatalı.', 401);
    const response = await startOAuth(request, 'link', user);
    // Fetch cannot follow a redirect to Google's sign-in page; the browser navigates itself.
    const result = NextResponse.json({ url: response.headers.get('location') }, { headers: { 'Cache-Control': 'no-store' } });
    for (const cookie of response.cookies.getAll()) result.cookies.set(cookie);
    return result;
  } catch (error) {
    if (error instanceof RequestError) return failure(error.message, error.status);
    if (error instanceof OAuthError && error.code === 'rate_limited') return failure('Bir dakika sonra tekrar deneyin.', 429);
    if (error instanceof Error && error.message === 'Lütfen şifrenizi kontrol edin.') return failure(error.message, 400);
    return failure('Google bağlantısı kurulamadı. Tekrar deneyin.', 503);
  }
}
