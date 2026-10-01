'use client';

import { useEffect, useRef, useState } from 'react';
import { CreditCard, RefreshCw, ShieldCheck } from 'lucide-react';
import type { BillingPublicConfig, BillingSnapshot } from '@/lib/revenuecat';
import { assertBillingSession, billingPackages, billingPurchaseTimestamp, BillingSessionChanged, purchaseBillingPackage, resetRevenueCatIdentity, type BillingPackage } from '@/lib/revenuecat-web';

type User = { id: string; email: string; name: string };
type Pending = { productId: string; purchasedAfter: number };
type View = { config: BillingPublicConfig; snapshot: BillingSnapshot | null; packages: BillingPackage[]; error: string };
const formattedDate = (value: string) => new Date(value).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
const periodLabel = (period: string | null) => ({ P1W: 'haftalık', P1M: 'aylık', P2M: '2 aylık', P3M: '3 aylık', P6M: '6 aylık', P1Y: 'yıllık' }[period || ''] || 'dönemlik');
function readPending(userId: string): Pending | null {
  try { const saved = sessionStorage.getItem(`fb-billing-pending:${userId}`); if (!saved) return null; const candidate = JSON.parse(saved); return candidate && typeof candidate.productId === 'string' && candidate.productId.length <= 200 && Number.isSafeInteger(candidate.purchasedAfter) && candidate.purchasedAfter > 0 && candidate.purchasedAfter <= Date.now() + 300_000 ? candidate : null; } catch { return null; }
}
function savePending(userId: string, pending: Pending | null): void {
  try { if (pending) sessionStorage.setItem(`fb-billing-pending:${userId}`, JSON.stringify(pending)); else sessionStorage.removeItem(`fb-billing-pending:${userId}`); } catch { /* The current page still retains pending verification if browser storage is blocked. */ }
}

export function BillingPanel({ user }: { user: User }) {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const checkout = useRef<HTMLDivElement>(null);
  const activeUser = useRef<string | null>(null);
  const currentOperation = useRef(0);

  useEffect(() => {
    activeUser.current = user.id;
    const controller = new AbortController();
    const operationCounter = currentOperation;
    const checkoutNode = checkout.current;
    const assertCurrent = () => { if (controller.signal.aborted || activeUser.current !== user.id) throw new BillingSessionChanged(); };
    const load = async () => {
      try {
        const expected = readPending(user.id);
        setView(null); setBusy(true); setMessage(''); setPending(expected);
        const response = await fetch('/api/billing/status', { cache: 'no-store', signal: controller.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        assertCurrent();
        const next: View = { config: body.config, snapshot: body.snapshot, packages: [], error: '' };
        setView(next);
        if (body.config.enabled) {
          const [packages, synchronization] = await Promise.allSettled([
            billingPackages({ id: user.id, email: user.email, name: user.name }, body.config, assertCurrent),
            fetch('/api/billing/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expected ? { expectedProductId: expected.productId, purchasedAfter: expected.purchasedAfter } : {}), signal: controller.signal }).then(async result => { const data = await result.json(); if (!result.ok) throw new Error(data.error); return data as { snapshot: BillingSnapshot; verification: string }; }),
          ]);
          assertCurrent();
          setView({ ...next, packages: packages.status === 'fulfilled' ? packages.value : [], snapshot: synchronization.status === 'fulfilled' ? synchronization.value.snapshot : next.snapshot, error: packages.status === 'rejected' || synchronization.status === 'rejected' ? 'Ödeme bilgilerinin bir kısmı yüklenemedi. Durumu yenileyebilirsiniz.' : '' });
          if (expected && synchronization.status === 'fulfilled' && synchronization.value.verification === 'verified') { setPending(null); savePending(user.id, null); setMessage('Ödemeniz doğrulandı. Hesabınız güncellendi.'); }
        }
      } catch (error) {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Ödeme bilgileri yüklenemedi.');
      } finally { if (!controller.signal.aborted) setBusy(false); }
    };
    const timer = setTimeout(() => void load(), 0);
    return () => { controller.abort(); clearTimeout(timer); activeUser.current = null; operationCounter.current++; checkoutNode?.replaceChildren(); resetRevenueCatIdentity(); };
  }, [user.id, user.email, user.name]);

  function clearPending() {
    setPending(null);
    savePending(user.id, null);
  }

  async function synchronize(expected: Pending | null = pending) {
    const operation = ++currentOperation.current;
    const assertCurrent = () => { if (activeUser.current !== user.id || operation !== currentOperation.current) throw new BillingSessionChanged(); };
    setBusy(true); setMessage('');
    try {
      await assertBillingSession(user.id);
      assertCurrent();
      const response = await fetch('/api/billing/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(expected ? { expectedProductId: expected.productId, purchasedAfter: expected.purchasedAfter } : {}) });
      const body = await response.json();
      assertCurrent();
      if (!response.ok) throw new Error(body.error);
      setView(current => current ? { ...current, snapshot: body.snapshot, error: '' } : current);
      if (body.verification === 'pending') setMessage('Ödemeniz sağlayıcı tarafından doğrulanıyor. Biraz sonra durumu yenileyin.');
      else { clearPending(); setMessage(expected ? 'Ödemeniz doğrulandı. Hesabınız güncellendi.' : 'Ödeme durumu güncellendi.'); }
      if (view?.config.enabled) {
        const packages = await billingPackages(user, view.config, assertCurrent);
        assertCurrent();
        setView(current => current ? { ...current, packages } : current);
      }
    } catch (error) { if (activeUser.current === user.id && operation === currentOperation.current) setMessage(error instanceof Error ? error.message : 'Ödeme durumu doğrulanamadı.'); }
    finally { if (activeUser.current === user.id && operation === currentOperation.current) setBusy(false); }
  }

  async function buy(item: BillingPackage) {
    if (!view || !checkout.current || busy || pending) return;
    const operation = ++currentOperation.current;
    const assertCurrent = () => { if (activeUser.current !== user.id || operation !== currentOperation.current) throw new BillingSessionChanged(); };
    const expected = { productId: item.productId, purchasedAfter: billingPurchaseTimestamp() };
    setBusy(true); setMessage('');
    // Retain the attempted purchase across navigation or an ambiguous network
    // failure so a successful charge cannot immediately trigger a second one.
    setPending(expected);
    savePending(user.id, expected);
    try {
      const result = await purchaseBillingPackage(user, view.config, item, checkout.current, assertCurrent);
      assertCurrent();
      if (result === 'cancelled') { clearPending(); setMessage('Ödeme penceresi kapatıldı.'); return; }
      // SDK completion never grants access; only the server's subscriber check does.
      setPending(expected);
      savePending(user.id, expected);
      await synchronize(expected);
    } catch (error) { if (activeUser.current === user.id && operation === currentOperation.current) setMessage(error instanceof Error ? error.message : 'Ödeme tamamlanamadı.'); }
    finally { if (activeUser.current === user.id && operation === currentOperation.current) setBusy(false); }
  }

  const active = view?.snapshot?.entitlements.filter(item => item.active) || [];
  return <section className="checkout-panel mt-8" aria-labelledby="billing-heading" aria-busy={busy}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="billing-heading" className="form-title mb-0 flex items-center gap-2"><CreditCard size={20} aria-hidden="true"/>Hesap ödemeleri</h2>
      {view?.config.enabled && <button type="button" disabled={busy} className="secondary-button gap-2" onClick={() => void synchronize()}><RefreshCw size={16} aria-hidden="true"/>{busy ? 'Güncelleniyor…' : 'Durumu yenile'}</button>}
    </div>
    {message && <p role="status" className="mt-4 rounded-xl bg-[var(--cream)] p-3 text-sm">{message}</p>}
    {!view ? <p className="mt-4 text-sm">{message ? 'Hesap ödemeleri şu anda yüklenemiyor.' : 'Ödeme bilgileri yükleniyor…'}</p> : !view.config.enabled ? <p className="mt-4 text-sm text-[var(--muted)]">Şu anda hesabınıza sunulan ek ödeme seçeneği bulunmuyor.</p> : <>
      {view.config.environment === 'sandbox' && <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm">Test ortamı: Buradaki ödemeler deneme amaçlıdır.</p>}
      {view.error && <p role="alert" className="mt-4 text-sm">{view.error}</p>}
      {pending && <div className="mt-4 text-sm"><p>Bir ödemenizin doğrulaması bekleniyor. Yeniden ödeme yapmadan önce durumu yenileyin.</p><button type="button" disabled={busy} className="mt-2 underline underline-offset-4" onClick={() => { clearPending(); setMessage('Bekleyen doğrulama kaldırıldı. Bu işlem varsa ödemenizi iptal etmez.'); }}>Ödeme yapmadım; bekleyen doğrulamayı kaldır</button></div>}
      {view.snapshot && <p className="mt-4 text-xs text-[var(--muted)]">Son doğrulama: {new Date(view.snapshot.verifiedAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p>}
      {active.length > 0 && <div className="mt-5 space-y-3">{active.map(entitlement => <div key={entitlement.id} className="rounded-xl border border-[var(--line)] p-4"><p className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} aria-hidden="true"/>{view.packages.find(item => item.productId === entitlement.productId)?.title || 'Etkin hesap paketi'}</p><p className="mt-1 text-sm">{entitlement.accessUntil ? `${formattedDate(entitlement.accessUntil)} tarihine kadar etkin.` : 'Süresiz erişim.'}{entitlement.renews ? ' Dönem sonunda otomatik yenilenir.' : entitlement.expiresAt ? ' Otomatik yenileme kapalı.' : ''}</p>{entitlement.billingIssue && <p className="mt-2 text-sm">Ödeme yönteminiz için işlem gerekiyor. Aboneliğinizi yönetin.</p>}</div>)}</div>}
      {view.packages.length > 0 ? <div className="mt-5 grid gap-4">{view.packages.map(item => { const owned = active.some(entitlement => entitlement.productId === item.productId); return <article key={item.id} className="rounded-xl border border-[var(--line)] p-4"><h3 className="font-semibold">{item.title}</h3>{item.description && <p className="mt-2 text-sm text-[var(--muted)]">{item.description}</p>}<p className="my-3 font-semibold">{item.price}{item.subscription ? ` / ${periodLabel(item.period)}` : ' · tek seferlik'}</p><button type="button" className="primary-button w-full" disabled={busy || !!pending || owned || !!view.error} onClick={() => void buy(item)}>{owned ? 'Hesabınızda etkin' : busy ? 'İşleniyor…' : 'Ödeme seçeneklerini gör'}</button>{item.subscription && <p className="mt-2 text-xs text-[var(--muted)]">Abonelik iptal edilene kadar yenilenir. Ödeme ekranında dönem, vergi ve toplam tutarı inceleyebilirsiniz.</p>}</article>; })}</div> : !view.error && <p className="mt-5 text-sm text-[var(--muted)]">Şu anda hesabınıza sunulan bir paket bulunmuyor.</p>}
      {view.snapshot?.managementUrl && <a className="secondary-button mt-5" href={view.snapshot.managementUrl} target="_blank" rel="noopener noreferrer">Aboneliğimi yönet</a>}
    </>}
    <div ref={checkout} aria-label="Güvenli ödeme ekranı"/>
  </section>;
}
