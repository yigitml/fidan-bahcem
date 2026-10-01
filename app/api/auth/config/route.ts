import { NextResponse } from 'next/server';
import { googleConfiguration } from '@/lib/google-oauth';

export const dynamic = 'force-dynamic';
export function GET() {
  return NextResponse.json({ googleAvailable: !!googleConfiguration() }, { headers: { 'Cache-Control': 'no-store' } });
}
