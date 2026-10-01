'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Copy, Download, LockKeyhole, LogOut, Package, ShieldCheck, Sprout } from 'lucide-react';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { BillingPanel } from '@/components/billing-panel';
import { formatPrice } from '@/lib/products';
import type { PublicUser } from '@/lib/auth';

type Order = { id: string; total: number; status: string; createdAt: string; payment: string; items: { name: string; quantity: number }[] };
type Mode = 'login' | 'register' | 'recover';
type Notice = { text: string; error?: boolean };
const authErrors: Record<string, string> = {
  unavailable: 'Google ile giriş şu anda kullanılamıyor. E-posta ve şifrenizle devam edebilirsiniz.',
  cancelled: 'Google ile giriş iptal edildi. Hazır olduğunuzda tekrar deneyebilirsiniz.',
  invalid_state: 'Giriş bağlantısının süresi dolmuş olabilir. Google ile girişi yeniden başlatın.',
  link_required: 'Bu e-posta ile bir hesabınız var. Önce şifrenizle giriş yapın, ardından Hesap güvenliği bölümünden Google hesabınızı bağlayın.',
  wrong_account: 'Hesabınıza bağlı Google hesabını seçin ve tekrar deneyin.',
  email_mismatch: 'Google hesabınızın e-posta adresi Fidan Bahçem hesabınızla aynı olmalı.',
  already_linked: 'Bu Google hesabı başka bir hesaba bağlı veya hesabınızda farklı bir Google hesabı var.',
  session_changed: 'Oturumunuz değişti. Yeniden giriş yapıp tekrar deneyin.',
  rate_limited: 'Çok fazla giriş denemesi yapıldı. Bir dakika sonra tekrar deneyin.',
};

function GoogleIcon() {
  return <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M43.6 24.5c0-1.4-.1-2.8-.4-4.1H24v7.8h11c-.5 2.5-1.9 4.6-4.1 6v5h6.6c3.9-3.6 6.1-8.8 6.1-14.7Z"/><path fill="#34A853" d="M24 44c5.5 0 10.2-1.8 13.6-4.9l-6.6-5c-1.8 1.2-4.2 1.9-7 1.9-5.3 0-9.8-3.6-11.4-8.4H5.8v5.2C9.2 39.4 16.1 44 24 44Z"/><path fill="#FBBC05" d="M12.6 27.6a12 12 0 0 1 0-7.2v-5.2H5.8a20 20 0 0 0 0 17.6l6.8-5.2Z"/><path fill="#EA4335" d="M24 12c3 0 5.7 1 7.8 3l5.8-5.8C34.1 6 29.5 4 24 4 16.1 4 9.2 8.6 5.8 15.2l6.8 5.2C14.2 15.6 18.7 12 24 12Z"/></svg>;
}

export default function Account() {
  const router = useRouter();
  const [user, setUser] = useState<PublicUser | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersError, setOrdersError] = useState('');
  const [mode, setMode] = useState<Mode>('login');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [recovery, setRecovery] = useState('');
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [googleAvailable, setGoogleAvailable] = useState<boolean | null>(null);
  const [returnTo, setReturnTo] = useState('/hesabim');
  const [googleVerified, setGoogleVerified] = useState(false);
  const [deletionPending, setDeletionPending] = useState(false);

  async function load() {
    setLoadError(false);
    try {
      const response = await fetch('/api/store/me', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setUser(result.user); setDeletionPending(result.deletionPending === true); setOrders([]); setOrdersError('');
      window.dispatchEvent(new CustomEvent('fb-auth-change'));
      if (result.user && !result.deletionPending) {
        try {
          const response = await fetch('/api/store/orders', { cache: 'no-store' });
          const result = await response.json();
          if (response.status === 401) {
            setUser(null); setRecovery(''); setGoogleVerified(false);
            setNotice({ text: 'Oturumunuz sona erdi. Devam etmek için yeniden giriş yapın.', error: true });
            window.dispatchEvent(new CustomEvent('fb-auth-change'));
            return;
          }
          if (!response.ok) throw new Error(result.error);
          setOrders(result.orders || []);
        } catch { setOrdersError('Siparişleriniz yüklenemedi. Tekrar deneyin.'); }
      }
    } catch { setLoadError(true); } finally { setLoading(false); }
  }

  useEffect(() => {
    const task = setTimeout(() => {
      const parameters = new URLSearchParams(window.location.search);
      const target = parameters.get('returnTo') || parameters.get('next');
      if (target && ['/', '/odeme', '/fidanlar', '/hesabim'].includes(target)) setReturnTo(target);
      const error = parameters.get('auth_error');
      const success = parameters.get('auth_success');
      if (error) setNotice({ text: authErrors[error] || 'Google ile giriş tamamlanamadı. Lütfen tekrar deneyin.', error: true });
      if (success === 'linked') setNotice({ text: 'Google hesabınız bağlandı. Bir sonraki girişinizde Google ile devam edebilirsiniz.' });
      if (success === 'reauthenticated') { setGoogleVerified(true); setNotice({ text: 'Google hesabınız doğrulandı. Silme işlemini beş dakika içinde onaylayabilirsiniz.' }); }
      if (error || success) {
        parameters.delete('auth_error'); parameters.delete('auth_success');
        window.history.replaceState({}, '', `${window.location.pathname}${parameters.size ? `?${parameters}` : ''}`);
      }
      void load();
      void fetch('/api/auth/config', { cache: 'no-store' }).then(async response => {
        if (!response.ok) throw new Error();
        setGoogleAvailable((await response.json()).googleAvailable === true);
      }).catch(() => setGoogleAvailable(false));
    }, 0);
    return () => clearTimeout(task);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>, action: string) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    if (action === 'password' && data.password !== data.confirmPassword) { setNotice({ text: 'Yeni şifreler eşleşmiyor.', error: true }); return; }
    setBusy(true); setNotice(null);
    try {
      const response = await fetch(action === 'google-link' ? '/api/auth/google' : `/api/store/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.code === 'reauthentication_required') setGoogleVerified(false);
        if (response.status === 401 && result.error === 'Giriş yapmanız gerekiyor.') await load();
        throw new Error(result.error || 'İşlem tamamlanamadı. Tekrar deneyin.');
      }
      if (action === 'google-link') {
        const target = new URL(result.url);
        if (target.origin !== 'https://accounts.google.com') throw new Error('Google bağlantısı kurulamadı.');
        window.location.assign(target.href); return;
      }
      if (result.recoveryCode) { setRecovery(result.recoveryCode); setCopied(false); }
      form.reset();
      if (action === 'recover') {
        setUser(null); setOrders([]); setMode('login');
        setNotice({ text: 'Şifreniz yenilendi. Yeni kurtarma kodunuzu kaydedip giriş yapın.' });
        window.dispatchEvent(new CustomEvent('fb-auth-change'));
      } else {
        if (action === 'logout' || action === 'delete') { setRecovery(''); setGoogleVerified(false); }
        await load();
        const messages: Record<string, string> = { profile: 'Bilgileriniz kaydedildi.', password: 'Şifreniz güncellendi. Diğer oturumlarınız kapatıldı.', logout: 'Güvenli bir şekilde çıkış yaptınız.', delete: 'Hesabınız ve bağlı verileriniz silindi.' };
        if (messages[action]) setNotice({ text: messages[action] });
        if ((action === 'login' || action === 'register') && returnTo !== '/hesabim') router.push(returnTo);
      }
    } catch (error) {
      if (action === 'delete') await load();
      setNotice({ text: error instanceof Error ? error.message : 'Tekrar deneyin.', error: true });
    }
    finally { setBusy(false); }
  }

  async function copyRecovery() {
    try { await navigator.clipboard.writeText(recovery); setCopied(true); }
    catch { setNotice({ text: 'Kodu seçip güvenli bir yere kopyalayabilirsiniz.' }); }
  }

  return <><SiteHeader /><main id="main-content" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-10 md:py-14">
    <div className="flex flex-wrap items-end justify-between gap-5"><div><p className="eyebrow">Size ait bir köşe</p><h1 className="page-title">Hesabım</h1><p className="mt-4 max-w-xl text-[var(--muted)]">Siparişlerinizi takip edin, hesabınızı yönetin ve bahçeniz için bir sonraki adımı planlayın.</p></div>{user && <Link href="/fidanlar" className="secondary-button"><Sprout size={18} />Fidanları keşfet</Link>}</div>
    {notice && <div role={notice.error ? 'alert' : 'status'} className={`my-6 rounded-2xl border p-4 text-sm leading-relaxed ${notice.error ? 'border-red-200 bg-red-50 text-red-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{notice.text}</div>}
    {recovery && <section aria-label="Hesap kurtarma kodu" className="my-6 rounded-2xl border border-amber-200 bg-amber-50 p-5"><h2 className="flex items-center gap-2 font-semibold"><ShieldCheck size={19} />Kurtarma kodunuzu kaydedin</h2><p className="my-2 text-sm leading-relaxed">Şifrenizi unutursanız bu kod hesabınıza yeniden erişmenizi sağlar. Kod yalnızca burada gösterilir; e-posta gönderimi kullanılmaz.</p><code className="my-4 block select-all break-all rounded-xl bg-white p-3 text-sm">{recovery}</code><div className="flex flex-wrap gap-2"><button className="secondary-button" type="button" onClick={() => void copyRecovery()}>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? 'Kopyalandı' : 'Kodu kopyala'}</button><button className="secondary-button" type="button" onClick={() => setRecovery('')}>Kodu kaydettim</button></div></section>}
    {loading ? <section className="checkout-panel mt-8" aria-busy="true" aria-label="Hesap yükleniyor"><div className="h-6 w-40 animate-pulse rounded bg-[var(--line)]" /><div className="mt-5 h-12 max-w-md animate-pulse rounded-xl bg-[var(--paper)]" /><p role="status" className="mt-5 text-sm text-[var(--muted)]">Hesabınız yükleniyor…</p></section> : loadError ? <section className="checkout-panel mt-8"><h2 className="form-title">Hesabınıza ulaşamadık</h2><p className="text-[var(--muted)]">Bağlantınızı kontrol edip tekrar deneyin.</p><button className="primary-button mt-5" onClick={() => { setLoading(true); void load(); }}>Tekrar dene</button></section> : !user ? <div className="mt-8 grid items-start gap-8 md:grid-cols-[1.15fr_.85fr]">
      <section className="checkout-panel"><div className="mb-6 flex flex-wrap gap-2" aria-label="Giriş seçenekleri">{([['login', 'Giriş yap'], ['register', 'Hesap oluştur'], ['recover', 'Şifremi unuttum']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={mode === key} className={`filter-pill ${mode === key ? 'active' : ''}`} disabled={busy} onClick={() => { setMode(key); setNotice(null); }}>{label}</button>)}</div>
      {mode !== 'recover' && <><button type="button" className="secondary-button w-full bg-white" disabled={busy || !googleAvailable} onClick={() => { setBusy(true); window.location.assign(new URL(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`, window.location.origin).href); }}><GoogleIcon />{googleAvailable === null ? 'Google girişi yükleniyor…' : 'Google ile devam et'}</button>{googleAvailable === false && <p className="mt-2 text-sm text-[var(--muted)]">Google ile giriş şu anda kullanılamıyor. E-posta ile devam edebilirsiniz.</p>}<div className="my-6 flex items-center gap-4 text-xs text-[var(--muted)]"><span className="h-px flex-1 bg-[var(--line)]" />veya e-posta ile<span className="h-px flex-1 bg-[var(--line)]" /></div></>}
      {mode === 'recover' && <p className="mb-5 text-sm leading-relaxed text-[var(--muted)]">Hesap oluştururken verilen kurtarma kodunu kullanın. Google ile oluşturduğunuz hesabınız için Google ile giriş yapabilirsiniz.</p>}
      <form key={mode} onSubmit={event => void submit(event, mode)} className="form-grid">
        {mode === 'register' && <label className="full">Ad soyad<input name="name" required autoComplete="name" maxLength={100} disabled={busy} /></label>}
        <label className="full">E-posta<input name="email" required type="email" autoComplete="email" maxLength={254} disabled={busy} /></label>
        {mode === 'recover' && <label className="full">Kurtarma kodu<input name="recoveryCode" required autoComplete="off" maxLength={128} disabled={busy} /></label>}
        <label className="full">{mode === 'recover' ? 'Yeni şifre' : 'Şifre'}<input name="password" type="password" required minLength={mode === 'login' ? 1 : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} disabled={busy} /></label>
        {mode === 'register' && <p className="full text-sm leading-relaxed text-[var(--muted)]">En az 12 karakter kullanın. Hesabınız için bir kurtarma kodu oluşturacağız. <Link href="/gizlilik" className="underline">Verilerinizin nasıl kullanıldığını okuyun.</Link></p>}
        <button disabled={busy} className="primary-button full">{busy ? 'İşleniyor…' : mode === 'register' ? 'Hesap oluştur' : mode === 'recover' ? 'Şifreyi yenile' : 'Giriş yap'}</button>
      </form></section>
      <aside className="rounded-[1.7rem] bg-[#e8ede3] p-7 md:p-9"><span className="mb-5 grid size-12 place-items-center rounded-full bg-white"><Sprout size={25} /></span><h2 className="font-serif text-3xl">Bahçenizin yolculuğu burada.</h2><p className="mt-4 leading-relaxed text-[var(--muted)]">Seçtiğiniz fidanlardan teslimata kadar siparişlerinizin tüm adımlarını hesabınızdan takip edebilirsiniz.</p><ul className="mt-7 space-y-4 text-sm"><li className="flex items-center gap-3"><Package size={19} />Sipariş geçmişiniz ve güncel durumlar</li><li className="flex items-center gap-3"><ShieldCheck size={19} />Güvenli giriş ve hesap yönetimi</li><li className="flex items-center gap-3"><Download size={19} />Verilerinize erişim ve indirme</li></ul></aside>
    </div> : deletionPending ? <section className="checkout-panel mt-8 max-w-xl"><h2 className="form-title">Hesap silme işlemini tamamlayın</h2><p className="mb-5 text-sm leading-relaxed text-[var(--muted)]">Silme işlemi başlatıldı ve hesabınıza erişim kapatıldı. Bağlantı sorunu nedeniyle veri temizliği tamamlanamadı. Aynı oturumda doğrulamanızı tekrarlayarak işlemi tamamlayabilirsiniz.</p><form className="form-grid" onSubmit={event => void submit(event, 'delete')}>{user.hasPassword ? <label className="full">Şifreniz<input name="password" type="password" required autoComplete="current-password" maxLength={128} disabled={busy} /></label> : <><button type="button" className="secondary-button full" disabled={busy || !googleAvailable} onClick={() => window.location.assign(new URL('/api/auth/google?intent=reauthenticate', window.location.origin).href)}><GoogleIcon />Google ile yeniden doğrula</button><label className="full">HESABIMI SİL yazın<input name="confirmation" required pattern="HESABIMI SİL" autoComplete="off" disabled={busy} /></label></>}<button disabled={busy || (!user.hasPassword && !googleVerified)} className="secondary-button full border-red-300 text-red-800">Silme işlemini tamamla</button></form></section> : <div className="mt-8 grid items-start gap-8 lg:grid-cols-[.85fr_1.15fr]">
      <div className="min-w-0 space-y-6"><section className="checkout-panel"><h2 className="form-title">Merhaba, {user.name}</h2><p className="mb-5 break-all text-sm text-[var(--muted)]">{user.email}</p><form className="form-grid" onSubmit={event => void submit(event, 'profile')}><label className="full">Ad soyad<input name="name" defaultValue={user.name} required maxLength={100} autoComplete="name" disabled={busy} /></label><button disabled={busy} className="secondary-button full">{busy ? 'İşleniyor…' : 'Bilgileri kaydet'}</button></form></section>
      <section className="checkout-panel"><h2 className="form-title flex items-center gap-2"><LockKeyhole size={21} />Hesap güvenliği</h2><p className="mb-5 text-sm text-[var(--muted)]">{user.googleLinked ? 'Google hesabınız bağlı.' : 'E-posta ve şifre ile giriş yapıyorsunuz.'}</p>
        {!user.googleLinked && user.hasPassword && googleAvailable && <details className="mb-6"><summary className="cursor-pointer font-medium">Google hesabımı bağla</summary><p className="my-3 text-sm text-[var(--muted)]">Mevcut şifrenizi doğrulayın ve aynı e-posta adresine sahip Google hesabını seçin.</p><form className="form-grid" onSubmit={event => void submit(event, 'google-link')}><label className="full">Mevcut şifre<input name="password" type="password" required maxLength={128} autoComplete="current-password" disabled={busy} /></label><button className="secondary-button full" disabled={busy}><GoogleIcon />Google hesabını bağla</button></form></details>}
        {user.hasPassword && <details className="mb-6"><summary className="cursor-pointer font-medium">Şifremi değiştir</summary><p className="my-3 text-sm text-[var(--muted)]">Şifre değişikliği diğer oturumlarınızı kapatır ve yeni bir kurtarma kodu oluşturur.</p><form className="form-grid" onSubmit={event => void submit(event, 'password')}><label className="full">Mevcut şifre<input name="currentPassword" type="password" required autoComplete="current-password" maxLength={128} disabled={busy} /></label><label className="full">Yeni şifre<input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} /></label><label className="full">Yeni şifre tekrar<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" disabled={busy} /></label><button disabled={busy} className="secondary-button full">Şifreyi güncelle</button></form></details>}
        <form onSubmit={event => void submit(event, 'logout')}><button className="secondary-button w-full" disabled={busy}><LogOut size={17} />Çıkış yap</button></form>
      </section>
      <section className="checkout-panel"><h2 className="form-title">Verilerim</h2><p className="mb-4 text-sm leading-relaxed text-[var(--muted)]">Hesap bilgilerinizi ve sipariş geçmişinizi JSON dosyası olarak indirebilirsiniz.</p><a href="/api/store/export" download="fidan-bahcem-verilerim.json" className="secondary-button w-full"><Download size={17} />Verilerimi indir</a><details className="mt-6" open={googleVerified}><summary className="cursor-pointer text-sm font-medium text-red-800">Hesabımı ve verilerimi sil</summary><p className="my-3 text-sm leading-relaxed text-[var(--muted)]">Hesabınız ve bağlı siparişleriniz kalıcı olarak silinir. İşlem geri alınamaz. Varsa aboneliğinizi önce üyelik bölümünden yönetin.</p>
      <form className="form-grid" onSubmit={event => void submit(event, 'delete')}>{user.hasPassword ? <label className="full">Silme işlemi için şifreniz<input name="password" type="password" required autoComplete="current-password" maxLength={128} disabled={busy} /></label> : <><button type="button" className="secondary-button full" disabled={busy || !googleAvailable} onClick={() => window.location.assign(new URL('/api/auth/google?intent=reauthenticate', window.location.origin).href)}><GoogleIcon />Google ile yeniden doğrula</button><label className="full">Onaylamak için HESABIMI SİL yazın<input name="confirmation" required pattern="HESABIMI SİL" autoComplete="off" disabled={busy} /></label></>}<button disabled={busy || (!user.hasPassword && !googleVerified)} className="secondary-button full border-red-300 text-red-800">Hesabımı kalıcı olarak sil</button></form></details></section></div>
      <div className="min-w-0 space-y-8"><BillingPanel user={user} /><section><div className="mb-4 flex items-center justify-between gap-4"><h2 className="form-title mb-0">Siparişlerim</h2><span className="rounded-full bg-[#e8ede3] px-3 py-1 text-sm">{orders.length} sipariş</span></div>{ordersError ? <div className="checkout-panel"><p role="alert" className="text-sm">{ordersError}</p><button className="secondary-button mt-4" onClick={() => void load()}>Tekrar dene</button></div> : orders.length ? orders.map(order => <article key={order.id} className="checkout-panel mb-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="break-all text-sm font-medium">{order.id}</p><p className="mt-2 text-sm text-[var(--muted)]">{new Date(order.createdAt).toLocaleDateString('tr-TR')}</p></div><span className={`rounded-full px-3 py-1 text-xs font-semibold ${order.status === 'İptal edildi' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-900'}`}>{order.status}</span></div><ul className="my-5 space-y-2 border-y border-[var(--line)] py-4 text-sm">{order.items.map((item, index) => <li key={index} className="flex items-center gap-2"><Sprout size={15} className="shrink-0 text-[var(--muted)]" />{item.quantity} × {item.name}</li>)}</ul><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-[var(--muted)]">Toplam</span><strong className="text-lg">{formatPrice(order.total)}</strong></div>{order.payment === 'demo-completed' && <p className="mt-3 text-xs text-[var(--muted)]">Bu sipariş demo ödeme ile oluşturuldu; ücret tahsil edilmedi.</p>}</article>) : <div className="checkout-panel text-center"><span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-[var(--paper)]"><Package size={25} /></span><h3 className="font-serif text-2xl">İlk fidanınızla başlayın.</h3><p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">Henüz siparişiniz yok. Bahçenize uygun bir fidan seçtiğinizde yolculuğunuz burada görünecek.</p><Link href="/fidanlar" className="primary-button mt-5">Fidanları incele</Link></div>}</section></div>
    </div>}
  </main><SiteFooter /></>;
}
