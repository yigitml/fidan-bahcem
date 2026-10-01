import { createHmac, timingSafeEqual } from 'node:crypto';
import { database, type Entry, type KV } from './database';

export type BillingEnvironment = 'sandbox' | 'production';
export type BillingEntitlement = { id: string; productId: string; active: boolean; expiresAt: string | null; accessUntil: string | null; purchasedAt: string; renews: boolean; billingIssue: boolean };
export type BillingPurchase = { productId: string; purchasedAt: string; transactionId: string };
export type BillingSnapshot = { environment: BillingEnvironment; verifiedAt: string; providerTimestamp: number; latestEventTimestamp: number; entitlements: BillingEntitlement[]; purchases: BillingPurchase[]; managementUrl: string | null };
export type BillingPublicConfig = { enabled: boolean; environment: BillingEnvironment | null; webApiKey: string | null; offeringId: string | null; allowedProductIds: string[] };
type BillingConfig = BillingPublicConfig & { enabled: true; environment: BillingEnvironment; webApiKey: string; secretApiKey: string; webhookSecret: string };
type ProviderPurchase = { id?: unknown; store_transaction_id?: unknown; transaction_id?: unknown; purchase_date?: unknown; is_sandbox?: unknown; refunded_at?: unknown };
type ProviderSubscription = ProviderPurchase & { expires_date?: unknown; grace_period_expires_date?: unknown; unsubscribe_detected_at?: unknown; billing_issues_detected_at?: unknown };
type ProviderEntitlement = { product_identifier?: unknown; purchase_date?: unknown; expires_date?: unknown; grace_period_expires_date?: unknown };
type ProviderSubscriber = { original_app_user_id?: unknown; entitlements?: unknown; subscriptions?: unknown; non_subscriptions?: unknown; management_url?: unknown };
type WebhookEvent = { id: string; type: string; environment?: 'SANDBOX' | 'PRODUCTION'; event_timestamp_ms: number; app_user_id?: string; original_app_user_id?: string; aliases?: string[]; transferred_from?: string[]; transferred_to?: string[]; redeemed_from?: string[]; redeemed_by?: string[] };
type EventRecord = { type: string; timestamp: number; disposition: string };

export class BillingError extends Error {
  constructor(message: string, public status = 503) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const identifiers = (value: string | undefined) => [...new Set((value || '').split(',').map(item => item.trim()).filter(Boolean))];
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const date = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

function configuration(): BillingConfig | null {
  // The public SDK key is served through the status API at request time. Next's
  // compiler can inline public property reads even through an env alias.
  const env = process.env;
  const environment = env.REVENUECAT_ENVIRONMENT;
  const runtimeWebApiKey: unknown = Reflect.get(env, 'NEXT_PUBLIC_REVENUECAT_WEB_API_KEY');
  const webApiKey = typeof runtimeWebApiKey === 'string' ? runtimeWebApiKey.trim() : undefined;
  const secretApiKey = env.REVENUECAT_SECRET_API_KEY?.trim();
  const webhookSecret = env.REVENUECAT_WEBHOOK_SECRET?.trim();
  const allowedProductIds = identifiers(env.REVENUECAT_ALLOWED_PRODUCT_IDS);
  if ((environment !== 'production' && environment !== 'sandbox') || !webApiKey || !secretApiKey || !webhookSecret || !allowedProductIds.length || allowedProductIds.length > 50) return null;
  if (allowedProductIds.some(id => id.length > 200 || /[\r\n]/.test(id))) return null;
  // Sandbox keys must never accidentally enable a production checkout, or vice versa.
  if ((webApiKey.startsWith('rcb_sb_') || webApiKey.startsWith('strp_sb_') || webApiKey.startsWith('test_')) !== (environment === 'sandbox')) return null;
  if (!/^(rcb_|strp_|pdl_|test_)[a-zA-Z0-9_.-]+$/.test(webApiKey)) return null;
  const offeringId = env.REVENUECAT_OFFERING_ID?.trim() || null;
  if (offeringId && (offeringId.length > 200 || /[\r\n]/.test(offeringId))) return null;
  return { enabled: true, environment, webApiKey, secretApiKey, webhookSecret, allowedProductIds, offeringId };
}

export function billingPublicConfig(): BillingPublicConfig {
  const config = configuration();
  return config ? { enabled: true, environment: config.environment, webApiKey: config.webApiKey, offeringId: config.offeringId, allowedProductIds: config.allowedProductIds } : { enabled: false, environment: null, webApiKey: null, offeringId: null, allowedProductIds: [] };
}

export function safeManagementUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4000) return null;
  try {
    const url = new URL(value);
    const allowed = ['billing.revenuecat.com', 'billing.stripe.com', 'apps.apple.com', 'play.google.com'];
    allowed.push(...identifiers(process.env.REVENUECAT_MANAGEMENT_HOSTS));
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !allowed.includes(url.hostname)) return null;
    return url.toString();
  } catch { return null; }
}

function normalizeSubscriber(value: unknown, config: BillingConfig): BillingSnapshot {
  const payload = record(value);
  const subscriber = record(payload.subscriber) as ProviderSubscriber;
  // The API-key-authenticated URL identifies the requested account. Original IDs
  // legitimately differ after a provider-side alias or transfer.
  if (typeof subscriber.original_app_user_id !== 'string' || !subscriber.original_app_user_id.length || subscriber.original_app_user_id.length > 200 || !isRecord(subscriber.entitlements) || !isRecord(subscriber.subscriptions) || !isRecord(subscriber.non_subscriptions)) throw new BillingError('Ödeme sağlayıcısı geçersiz hesap bilgisi verdi.');
  const providerTimestamp = payload.request_date_ms;
  if (typeof providerTimestamp !== 'number' || !Number.isSafeInteger(providerTimestamp) || providerTimestamp <= 0 || providerTimestamp > Date.now() + 300_000) throw new BillingError('Ödeme sağlayıcısı doğrulanabilir bir yanıt vermedi.');
  const subscriptions = record(subscriber.subscriptions) as Record<string, ProviderSubscription>;
  const nonSubscriptions = record(subscriber.non_subscriptions);
  const expectedSandbox = config.environment === 'sandbox';
  const entitlements: BillingEntitlement[] = [];
  for (const [id, raw] of Object.entries(record(subscriber.entitlements)).slice(0, 100)) {
    const entitlement = record(raw) as ProviderEntitlement;
    const productId = entitlement.product_identifier;
    if (typeof productId !== 'string' || !config.allowedProductIds.includes(productId)) continue;
    const subscription = isRecord(subscriptions[productId]) ? subscriptions[productId] : undefined;
    const nonSubscriptionPurchases = Array.isArray(nonSubscriptions[productId]) ? (nonSubscriptions[productId] as unknown[]).filter(isRecord) as ProviderPurchase[] : [];
    const entitlementPurchase = date(entitlement.purchase_date);
    if (!entitlementPurchase) continue;
    // RevenueCat customers can contain both sandbox and production purchases.
    // Match the exact period behind this entitlement, rather than any historical receipt.
    const purchase = subscription && date(subscription.purchase_date) === entitlementPurchase ? subscription : nonSubscriptionPurchases.find(item => date(item.purchase_date) === entitlementPurchase);
    if (!purchase || purchase.is_sandbox !== expectedSandbox || purchase.refunded_at) continue;
    const expiresAt = date(entitlement.expires_date);
    if (entitlement.expires_date !== null && !expiresAt) continue;
    const grace = date(entitlement.grace_period_expires_date) || date(subscription?.grace_period_expires_date);
    const validUntil = Math.max(expiresAt ? Date.parse(expiresAt) : Infinity, grace ? Date.parse(grace) : 0);
    const active = validUntil > Date.now();
    entitlements.push({ id, productId, active, expiresAt, accessUntil: Number.isFinite(validUntil) ? new Date(validUntil).toISOString() : null, purchasedAt: entitlementPurchase, renews: active && !!subscription && !subscription.unsubscribe_detected_at, billingIssue: !!subscription?.billing_issues_detected_at });
  }
  const purchases: BillingPurchase[] = [];
  for (const productId of config.allowedProductIds) {
    const values = Array.isArray(nonSubscriptions[productId]) ? (nonSubscriptions[productId] as unknown[]).filter(isRecord) as ProviderPurchase[] : [];
    for (const purchase of values) {
      const purchasedAt = date(purchase.purchase_date);
      const rawTransaction = [purchase.store_transaction_id, purchase.transaction_id, purchase.id].find(value => typeof value === 'string' && !!value.length && value.length <= 200 || typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
      const transactionId = rawTransaction === undefined ? null : String(rawTransaction);
      if (purchase.is_sandbox === expectedSandbox && !purchase.refunded_at && purchasedAt && transactionId) purchases.push({ productId, purchasedAt, transactionId });
    }
  }
  return { environment: config.environment, verifiedAt: new Date().toISOString(), providerTimestamp, latestEventTimestamp: 0, entitlements, purchases: purchases.sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt)).slice(0, 100), managementUrl: safeManagementUrl(subscriber.management_url) };
}

async function fetchSubscriber(userId: string, config: BillingConfig): Promise<BillingSnapshot> {
  let response: Response;
  try {
    response = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${config.secretApiKey}`, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
  } catch { throw new BillingError('Ödeme durumu şu anda doğrulanamıyor. Tekrar deneyin.'); }
  if (!response.ok) throw new BillingError('Ödeme durumu şu anda doğrulanamıyor. Tekrar deneyin.');
  try {
    const raw = await readBillingBody(response, 1_048_576);
    return normalizeSubscriber(JSON.parse(raw), config);
  } catch { throw new BillingError('Ödeme sağlayıcısı geçersiz yanıt verdi. Tekrar deneyin.'); }
}

function snapshotKey(environment: BillingEnvironment, userId: string) { return ['revenuecat', environment, userId]; }
function currentSnapshot(state: BillingSnapshot): BillingSnapshot {
  return { ...state, managementUrl: safeManagementUrl(state.managementUrl), entitlements: state.entitlements.map(item => {
    const active = item.active && (!item.accessUntil || Date.parse(item.accessUntil) > Date.now());
    return { ...item, active, renews: active && item.renews };
  }) };
}

export async function syncBillingUser(userId: string): Promise<BillingSnapshot> {
  const config = configuration();
  if (!config) throw new BillingError('Hesap ödemeleri henüz kullanıma açılmadı.', 503);
  if (!uuid.test(userId)) throw new BillingError('Ödeme hesabı doğrulanamadı.', 409);
  const db = await database();
  const user = await db.get<{ deletingAt?: string }>(['user', userId]);
  if (!user.value || user.value.deletingAt) throw new BillingError('Giriş yapmanız gerekiyor.', 401);
  const snapshot = await fetchSubscriber(userId, config);
  for (let attempt = 0; attempt < 5; attempt++) {
    const account = await db.get<{ deletingAt?: string }>(user.key);
    if (!account.value || account.value.deletingAt) throw new BillingError('Giriş yapmanız gerekiyor.', 401);
    const existing = await db.get<BillingSnapshot>(snapshotKey(config.environment, userId));
    if (existing.value && existing.value.providerTimestamp > snapshot.providerTimestamp) return currentSnapshot(existing.value);
    const next = { ...snapshot, latestEventTimestamp: existing.value?.latestEventTimestamp || 0 };
    if ((await db.atomic().check(account).check(existing).set(existing.key, next).commit()).ok) return next;
  }
  throw new BillingError('Ödeme durumu güncelleniyor. Tekrar deneyin.', 409);
}

export async function storedBillingUser(userId: string): Promise<BillingSnapshot | null> {
  const config = configuration();
  if (!config) return null;
  const state = (await (await database()).get<BillingSnapshot>(snapshotKey(config.environment, userId))).value;
  if (!state) return null;
  // Never let an old cache keep an expired entitlement active or expose a revoked URL.
  return currentSnapshot({ ...state, entitlements: state.entitlements.filter(item => config.allowedProductIds.includes(item.productId)), purchases: state.purchases.filter(item => config.allowedProductIds.includes(item.productId)) });
}

export async function exportBillingUser(userId: string): Promise<{ sandbox: BillingSnapshot | null; production: BillingSnapshot | null }> {
  const db = await database();
  const [sandbox, production] = await Promise.all(['sandbox', 'production'].map(environment => db.get<BillingSnapshot>(snapshotKey(environment as BillingEnvironment, userId))));
  return { sandbox: sandbox.value ? currentSnapshot(sandbox.value) : null, production: production.value ? currentSnapshot(production.value) : null };
}

export async function cleanupBillingUser(userId: string): Promise<void> {
  const db = await database();
  await db.atomic().delete(snapshotKey('sandbox', userId)).delete(snapshotKey('production', userId)).commit();
  for await (const entry of db.list({ prefix: ['revenuecat-rate', userId] })) await db.delete(entry.key);
}

export async function limitBillingUser(userId: string): Promise<void> {
  const db = await database();
  const key = ['revenuecat-rate', userId, Math.floor(Date.now() / 60_000)];
  for (let attempt = 0; attempt < 5; attempt++) {
    const entry = await db.get<number>(key);
    if ((entry.value || 0) >= 10) throw new BillingError('Bir dakika sonra tekrar deneyin.', 429);
    if ((await db.atomic().check(entry).set(key, (entry.value || 0) + 1, { expireIn: 120_000 }).commit()).ok) return;
  }
  throw new BillingError('Bir dakika sonra tekrar deneyin.', 429);
}

export async function readBillingBody(request: Pick<Request, 'headers' | 'body'>, maximum = 65_536): Promise<string> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > maximum)) throw new BillingError('İstek çok büyük.', 413);
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new BillingError('İstek çok büyük.', 413); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new BillingError('Geçersiz istek.', 400); }
}

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function authenticateBillingWebhook(request: Request): void {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET?.trim();
  if (!secret) throw new BillingError('Webhook yapılandırılmadı.', 503);
  if (!equalSecret(request.headers.get('authorization') || '', `Bearer ${secret}`)) throw new BillingError('İstek reddedildi.', 401);
}

export function verifyBillingWebhookSignature(raw: string, signature: string | null): void {
  const secret = process.env.REVENUECAT_WEBHOOK_SIGNING_SECRET?.trim();
  if (!secret) return;
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signature || '');
  if (!match || Math.abs(Date.now() / 1000 - Number(match[1])) > 300) throw new BillingError('İstek imzası doğrulanamadı.', 401);
  const expected = createHmac('sha256', secret).update(`${match[1]}.${raw}`).digest('hex');
  if (!equalSecret(match[2], expected)) throw new BillingError('İstek imzası doğrulanamadı.', 401);
}

function parseWebhook(value: unknown): WebhookEvent {
  const event = record(record(value).event);
  if (typeof event.id !== 'string' || !event.id.length || event.id.length > 200 || typeof event.type !== 'string' || !/^[A-Z_]{1,64}$/.test(event.type) || typeof event.event_timestamp_ms !== 'number' || !Number.isSafeInteger(event.event_timestamp_ms) || event.event_timestamp_ms <= 0 || event.event_timestamp_ms > Date.now() + 300_000) throw new BillingError('Geçersiz webhook.', 400);
  // Transfer, redemption and non-purchase events may omit the environment.
  // Their subscriber reads are still filtered to the configured environment.
  if (event.environment !== undefined && event.environment !== null && event.environment !== 'SANDBOX' && event.environment !== 'PRODUCTION') throw new BillingError('Geçersiz webhook ortamı.', 400);
  for (const field of ['app_user_id', 'original_app_user_id']) if (event[field] !== undefined && event[field] !== null && (typeof event[field] !== 'string' || !(event[field] as string).length || (event[field] as string).length > 200)) throw new BillingError('Geçersiz webhook hesabı.', 400);
  for (const field of ['aliases', 'transferred_from', 'transferred_to', 'redeemed_from', 'redeemed_by']) if (event[field] !== undefined && event[field] !== null && (!Array.isArray(event[field]) || (event[field] as unknown[]).length > 20 || (event[field] as unknown[]).some(id => typeof id !== 'string' || !id.length || id.length > 200))) throw new BillingError('Geçersiz webhook hesabı.', 400);
  return event as WebhookEvent;
}

async function markEvent(db: KV, marker: Entry<EventRecord>, event: WebhookEvent, disposition: string) {
  const saved = await db.atomic().check(marker).set(marker.key, { type: event.type, timestamp: event.event_timestamp_ms, disposition }).commit();
  return { replay: !saved.ok, disposition };
}

export async function processBillingWebhook(payload: unknown): Promise<{ replay: boolean; disposition: string }> {
  const config = configuration();
  if (!config) throw new BillingError('Webhook yapılandırılmadı.', 503);
  const event = parseWebhook(payload);
  const db = await database();
  const environment = event.environment?.toLowerCase() || config.environment;
  const marker = await db.get<EventRecord>(['revenuecat-event', environment, event.id]);
  if (marker.value) return { replay: true, disposition: marker.value.disposition };
  if (event.type === 'TEST') return markEvent(db, marker, event, 'test');
  if (environment !== config.environment) return markEvent(db, marker, event, 'different_environment');
  const ids = [...new Set(event.type === 'TRANSFER' ? [...(event.transferred_from || []), ...(event.transferred_to || [])] : [event.app_user_id, event.original_app_user_id, ...(event.aliases || []), ...(event.redeemed_from || []), ...(event.redeemed_by || [])].filter((id): id is string => !!id))];
  if (!ids.length) throw new BillingError('Webhook hesabı gerekiyor.', 400);
  const users = (await Promise.all(ids.filter(id => uuid.test(id)).map(id => db.get<{ deletingAt?: string }>(['user', id])))).filter(entry => !!entry.value && !entry.value.deletingAt);
  if (!users.length) return markEvent(db, marker, event, 'unknown_account');
  const initialSnapshots = await Promise.all(users.map(entry => db.get<BillingSnapshot>(snapshotKey(config.environment, entry.key[1] as string))));
  if (initialSnapshots.every(entry => !!entry.value && entry.value.latestEventTimestamp > event.event_timestamp_ms)) return markEvent(db, marker, event, 'stale');
  const snapshots = await Promise.all(users.map(entry => fetchSubscriber(entry.key[1] as string, config)));
  for (let attempt = 0; attempt < 5; attempt++) {
    const currentMarker = await db.get<EventRecord>(marker.key);
    if (currentMarker.value) return { replay: true, disposition: currentMarker.value.disposition };
    const accounts = await Promise.all(users.map(entry => db.get<{ deletingAt?: string }>(entry.key)));
    if (accounts.some(entry => !entry.value || entry.value.deletingAt)) throw new BillingError('Ödeme hesabı değişti. Tekrar deneyin.', 409);
    const existing = await Promise.all(users.map(entry => db.get<BillingSnapshot>(snapshotKey(config.environment, entry.key[1] as string))));
    const transaction = db.atomic().check(currentMarker);
    let updated = false;
    for (let index = 0; index < users.length; index++) {
      transaction.check(accounts[index]).check(existing[index]);
      const old = existing[index].value;
      const snapshot = snapshots[index];
      if (old && (old.latestEventTimestamp > event.event_timestamp_ms || old.providerTimestamp > snapshot.providerTimestamp)) continue;
      transaction.set(existing[index].key, { ...snapshot, latestEventTimestamp: Math.max(old?.latestEventTimestamp || 0, event.event_timestamp_ms) });
      updated = true;
    }
    const disposition = updated ? 'synchronized' : 'stale';
    transaction.set(marker.key, { type: event.type, timestamp: event.event_timestamp_ms, disposition });
    if ((await transaction.commit()).ok) return { replay: false, disposition };
  }
  throw new BillingError('Ödeme durumu güncelleniyor. Tekrar deneyin.', 409);
}
