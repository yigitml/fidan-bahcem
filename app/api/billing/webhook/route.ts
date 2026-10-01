import { NextRequest, NextResponse } from 'next/server';
import { authenticateBillingWebhook, BillingError, processBillingWebhook, readBillingBody, verifyBillingWebhookSignature } from '@/lib/revenuecat';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    authenticateBillingWebhook(request);
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new BillingError('JSON gerekiyor.', 415);
    const raw = await readBillingBody(request);
    verifyBillingWebhookSignature(raw, request.headers.get('x-revenuecat-webhook-signature'));
    let payload: unknown;
    try { payload = JSON.parse(raw); } catch { throw new BillingError('Geçersiz webhook.', 400); }
    const result = await processBillingWebhook(payload);
    return NextResponse.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const known = error instanceof BillingError;
    return NextResponse.json({ error: known ? error.message : 'Ödeme bildirimi işlenemedi.' }, { status: known ? error.status : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
