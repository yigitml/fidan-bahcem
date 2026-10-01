'use client';

import { type FormEvent, useEffect, useState } from 'react';
import { RefreshCw, LogOut, Package } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { formatPrice } from '@/lib/products';

type Order = { id: string; status: string; total: number; createdAt: string; shipping: Record<string, string>; items: { name: string; quantity: number }[] };
const statuses = ['Alındı', 'Hazırlanıyor', 'Kargoya verildi', 'Teslim edildi', 'İptal edildi'];

export default function Admin() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const response = await fetch('/api/store/admin-orders', { cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (response.status === 401) { setOrders(null); return; }
      if (!response.ok) throw new Error(body.error);
      setOrders(body.orders);
    } catch (error) { setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Siparişler yüklenemedi. Tekrar deneyin.'); }
    finally { setLoading(false); }
  }

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, []);

  async function action(name: string, data: unknown) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch(`/api/store/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(15_000) });
      const body = await response.json();
      if (response.status === 401 && name !== 'admin-login') setOrders(null);
      if (!response.ok) throw new Error(body.error);
      if (name === 'admin-logout') { setOrders(null); setMessage('Yönetici oturumu kapatıldı.'); }
      else { await load(); if (name === 'admin-status') setMessage('Sipariş durumu kaydedildi.'); }
    } catch (error) { setMessage(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'İşlem tamamlanamadı. Tekrar deneyin.'); }
    finally { setBusy(false); }
  }

  function login(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void action('admin-login', Object.fromEntries(new FormData(event.currentTarget))); }

  return <><SiteHeader /><main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl px-5 py-12">
    <p className="eyebrow">Mağaza yönetimi</p><h1 className="page-title">Sipariş yönetimi</h1>
    <p className="mt-4 text-sm text-[var(--muted)]">Demo sipariş kayıtları ve müşteri hesabında görünen durumlar.</p>
    {message && <p role="status" className="mt-5 rounded-xl border border-[var(--line)] bg-white p-4 text-sm">{message}</p>}
    {loading ? <p role="status" className="mt-8">Yönetici oturumu kontrol ediliyor…</p> : orders === null ? <form onSubmit={login} className="checkout-panel form-grid mt-8 max-w-xl">
      <label className="full">Yönetici anahtarı<input type="password" name="key" required autoComplete="off" disabled={busy} maxLength={128} /></label><button disabled={busy} className="primary-button full">{busy ? 'İşleniyor…' : 'Giriş yap'}</button>
    </form> : <>
      <div className="my-6 flex flex-wrap gap-3"><button disabled={busy} onClick={() => { setMessage(''); void load(); }} className="secondary-button"><RefreshCw size={17} />Yenile</button><button disabled={busy} onClick={() => void action('admin-logout', {})} className="secondary-button"><LogOut size={17} />Çıkış yap</button></div>
      {!orders.length && <div className="checkout-panel"><Package className="mb-4" aria-hidden="true" /><h2 className="form-title">Henüz sipariş yok</h2><p className="text-sm text-[var(--muted)]">Kaydedilen demo siparişler burada görünecek.</p></div>}
      {orders.map(order => <article key={order.id} className="checkout-panel mb-6"><p className="break-all font-semibold">{order.id}</p><p className="my-3 break-words">{order.shipping.name} · {order.shipping.email} · {order.shipping.phone}</p><p className="break-words">{order.shipping.address}, {order.shipping.district} / {order.shipping.city}</p><p className="my-3">{order.items.map(item => `${item.quantity} × ${item.name}`).join(', ')} · {formatPrice(order.total)}</p><label className="grid gap-2 text-sm">Sipariş durumu<select value={order.status} disabled={busy} onChange={event => void action('admin-status', { id: order.id, status: event.target.value })} className="min-h-11 rounded-lg border border-[var(--line)] bg-white p-2">{statuses.map(status => <option key={status}>{status}</option>)}</select></label><p className="mt-3 text-xs text-[var(--muted)]">Demo sipariş · {new Date(order.createdAt).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' })}</p></article>)}
    </>}
  </main><SiteFooter /></>;
}
