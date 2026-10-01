import { database } from './database';
import { digest } from './security';

export class RequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); }
}

export function sameOrigin(request: Pick<Request, 'headers' | 'url'>): boolean {
  try {
    const supplied = request.headers.get('origin');
    if (!supplied) return false;
    const origin = new URL(supplied);
    const target = new URL(process.env.APP_URL || request.url);
    return origin.origin === supplied && origin.origin === target.origin && !origin.username && !origin.password;
  } catch { return false; }
}

export async function readJsonObject(request: Pick<Request, 'headers' | 'body'>, maximum = 16_000): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new RequestError('Geçersiz istek türü.', 415);
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new RequestError('İstek çok büyük.', 413);
  let raw = '';
  if (request.body) {
    const reader = request.body.getReader();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > maximum) { await reader.cancel(); throw new RequestError('İstek çok büyük.', 413); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
      raw += decoder.decode();
    } catch (error) {
      if (error instanceof RequestError) throw error;
      throw new RequestError('Geçersiz istek.', 400);
    } finally { reader.releaseLock(); }
  }
  try {
    const data: unknown = JSON.parse(raw || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data as Record<string, unknown>;
  } catch { throw new RequestError('Geçersiz istek.', 400); }
}

export async function takeRateLimit(request: Pick<Request, 'headers'>, scope: string, maximum = 15): Promise<void> {
  // Configure only when ingress overwrites this header; untrusted client headers cannot buy attempts.
  const trusted = process.env.TRUSTED_CLIENT_IP_HEADER;
  const supported = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'];
  const identity = trusted && supported.includes(trusted) ? request.headers.get(trusted)?.split(',')[0]?.trim().slice(0, 100) || 'shared' : 'shared';
  const db = await database();
  const key = ['rate', digest(identity), scope, Math.floor(Date.now() / 60_000)];
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await db.get<number>(key);
    if ((entry.value || 0) >= maximum) throw new RequestError('Bir dakika sonra tekrar deneyin.', 429);
    if ((await db.atomic().check(entry).set(key, (entry.value || 0) + 1, { expireIn: 120_000 }).commit()).ok) return;
  }
  throw new RequestError('Lütfen tekrar deneyin.', 429);
}
