'use client';

import type { Package, Purchases } from '@revenuecat/purchases-js';
import type { BillingPublicConfig } from './revenuecat';

type BillingUser = { id: string; email: string; name: string };
type SDK = typeof import('@revenuecat/purchases-js');
export type BillingPackage = { id: string; productId: string; title: string; description: string | null; price: string; period: string | null; subscription: boolean; rcPackage: Package };
let loadedSdk: SDK | null = null;
let sdkPromise: Promise<SDK> | null = null;
let identityQueue: Promise<unknown> = Promise.resolve();
let configuredKey: string | null = null;
let revision = 0;
let purchaseLock: symbol | null = null;

export class BillingSessionChanged extends Error {
  constructor() { super('Oturumunuz değişti. Hesabınıza tekrar giriş yapın.'); }
}

export function billingPurchaseTimestamp(): number { return Date.now() - 60_000; }

export function resetRevenueCatIdentity(): void {
  revision++;
  // A stale SDK request must not keep the next account queued indefinitely.
  identityQueue = Promise.resolve();
  configuredKey = null;
  purchaseLock = null;
  if (loadedSdk?.Purchases.isConfigured()) loadedSdk.Purchases.getSharedInstance().close();
}

async function sdk(): Promise<SDK> {
  return sdkPromise ??= import('@revenuecat/purchases-js').then(provider => { loadedSdk = provider; return provider; }).catch(error => { sdkPromise = null; throw error; });
}

export async function assertBillingSession(userId: string): Promise<void> {
  const response = await fetch('/api/store/me', { cache: 'no-store', credentials: 'same-origin' });
  const body = await response.json();
  if (!response.ok || body.user?.id !== userId) { resetRevenueCatIdentity(); throw new BillingSessionChanged(); }
}

async function forUser(user: BillingUser, config: BillingPublicConfig, assertCurrent: () => void): Promise<Purchases> {
  const expectedRevision = revision;
  const result = identityQueue.catch(() => {}).then(async () => {
    assertCurrent();
    if (!config.enabled || !config.webApiKey) throw new Error('Hesap ödemeleri henüz kullanıma açılmadı.');
    const provider = await sdk();
    assertCurrent();
    if (revision !== expectedRevision) throw new BillingSessionChanged();
    if (provider.Purchases.isConfigured() && configuredKey !== config.webApiKey) provider.Purchases.getSharedInstance().close();
    const purchases = provider.Purchases.isConfigured() ? provider.Purchases.getSharedInstance() : provider.Purchases.configure({ apiKey: config.webApiKey, appUserId: user.id });
    configuredKey = config.webApiKey;
    if (purchases.getAppUserId() !== user.id) await purchases.changeUser(user.id);
    assertCurrent();
    if (revision !== expectedRevision || purchases.getAppUserId() !== user.id) throw new BillingSessionChanged();
    if (purchases.isSandbox() !== (config.environment === 'sandbox')) throw new Error('Ödeme ortamı doğrulanamadı.');
    return purchases;
  });
  identityQueue = result;
  return result;
}

export async function billingPackages(user: BillingUser, config: BillingPublicConfig, assertCurrent: () => void): Promise<BillingPackage[]> {
  const expectedRevision = revision;
  await assertBillingSession(user.id);
  assertCurrent();
  const purchases = await forUser(user, config, assertCurrent);
  const offerings = await purchases.getOfferings();
  assertCurrent();
  if (revision !== expectedRevision || purchases.getAppUserId() !== user.id) throw new BillingSessionChanged();
  const offering = config.offeringId ? offerings.all[config.offeringId] : offerings.current;
  return (offering?.availablePackages || []).filter(pkg => config.allowedProductIds.includes(pkg.product.identifier)).map(pkg => ({ id: pkg.identifier, productId: pkg.product.identifier, title: pkg.product.title, description: pkg.product.description, price: pkg.product.price.formattedPrice, period: pkg.product.normalPeriodDuration, subscription: !!pkg.product.defaultSubscriptionOption, rcPackage: pkg }));
}

export async function purchaseBillingPackage(user: BillingUser, config: BillingPublicConfig, item: BillingPackage, htmlTarget: HTMLElement, assertCurrent: () => void): Promise<'completed' | 'cancelled'> {
  if (purchaseLock) throw new Error('Bir ödeme penceresi zaten açık.');
  const lock = Symbol('checkout');
  purchaseLock = lock;
  const expectedRevision = revision;
  try {
    await assertBillingSession(user.id);
    assertCurrent();
    const purchases = await forUser(user, config, assertCurrent);
    const packages = await billingPackages(user, config, assertCurrent);
    const selected = packages.find(pkg => pkg.id === item.id && pkg.productId === item.productId);
    if (!selected) throw new Error('Bu ödeme seçeneği artık kullanılamıyor. Sayfayı yenileyin.');
    await assertBillingSession(user.id);
    assertCurrent();
    if (revision !== expectedRevision || purchases.getAppUserId() !== user.id) throw new BillingSessionChanged();
    await purchases.purchase({ rcPackage: selected.rcPackage, customerEmail: user.email, htmlTarget, skipSuccessPage: true, metadata: { source: 'fidan-bahcem', app_user_id: user.id } });
    assertCurrent();
    if (revision !== expectedRevision) throw new BillingSessionChanged();
    await assertBillingSession(user.id);
    return 'completed';
  } catch (error) {
    if (loadedSdk && error instanceof loadedSdk.PurchasesError && error.errorCode === loadedSdk.ErrorCode.UserCancelledError) return 'cancelled';
    if (error instanceof BillingSessionChanged) throw error;
    throw new Error('Ödeme tamamlanamadı. Hesap durumunu yenileyip tekrar deneyin.');
  } finally {
    if (purchaseLock === lock) purchaseLock = null;
  }
}
