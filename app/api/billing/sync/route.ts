import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { sameOrigin } from '@/lib/http-security';
import { BillingError, billingPublicConfig, limitBillingUser, readBillingBody, syncBillingUser } from '@/lib/revenuecat';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) throw new BillingError('İstek reddedildi.', 403);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new BillingError('JSON gerekiyor.', 415);
    const user = await currentUser(request);
    if (!user) throw new BillingError('Giriş yapmanız gerekiyor.', 401);
    const raw = await readBillingBody(request, 2048);
    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(raw || '{}');
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
      body = parsed;
    } catch { throw new BillingError('Geçersiz istek.', 400); }
    const expectedProductId = body.expectedProductId;
    const purchasedAfter = body.purchasedAfter;
    if (expectedProductId !== undefined && (typeof expectedProductId !== 'string' || !billingPublicConfig().allowedProductIds.includes(expectedProductId))) throw new BillingError('Geçersiz ödeme ürünü.', 400);
    if (purchasedAfter !== undefined && (typeof purchasedAfter !== 'number' || !Number.isSafeInteger(purchasedAfter) || purchasedAfter <= 0 || purchasedAfter > Date.now() + 300_000)) throw new BillingError('Geçersiz ödeme zamanı.', 400);
    await limitBillingUser(user.id);
    const snapshot = await syncBillingUser(user.id);
    const verified = !expectedProductId || snapshot.entitlements.some(item => item.active && item.productId === expectedProductId && (!purchasedAfter || Date.parse(item.purchasedAt) >= (purchasedAfter as number))) || snapshot.purchases.some(item => item.productId === expectedProductId && (!purchasedAfter || Date.parse(item.purchasedAt) >= (purchasedAfter as number)));
    return NextResponse.json({ snapshot, verification: verified ? 'verified' : 'pending' }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const known = error instanceof BillingError;
    return NextResponse.json({ error: known ? error.message : 'Ödeme durumu doğrulanamadı. Tekrar deneyin.' }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
