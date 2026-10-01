import { NextRequest, NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { billingPublicConfig, storedBillingUser } from '@/lib/revenuecat';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const user = await currentUser(request);
    if (!user) return NextResponse.json({ error: 'Giriş yapmanız gerekiyor.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    return NextResponse.json({ config: billingPublicConfig(), snapshot: await storedBillingUser(user.id) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return NextResponse.json({ error: 'Ödeme bilgileri yüklenemedi. Tekrar deneyin.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
