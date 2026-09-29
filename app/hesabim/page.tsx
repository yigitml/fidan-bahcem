'use client';
import { useEffect, useState, FormEvent } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/site-header';
import { formatPrice } from '@/lib/products';
type User = { name: string; email: string };
type Order = { id: string; total: number; status: string; createdAt: string; items: {name:string;quantity:number}[] };
export default function Account() {
  const [user,setUser] = useState<User|null>(null);
  const [orders,setOrders] = useState<Order[]>([]);
  const [mode,setMode] = useState('login');
  const [message,setMessage] = useState('');
  const [recovery,setRecovery] = useState('');
  const [busy,setBusy] = useState(false);
  const [loading,setLoading] = useState(true);
  async function load() {
    try { const r = await fetch('/api/store/me'); const d = await r.json(); if (!r.ok) throw new Error(d.error); setUser(d.user); if (d.user) { const result = await fetch('/api/store/orders'); setOrders((await result.json()).orders || []); } }
    catch { setMessage('Hesabınız yüklenemedi. Sayfayı yenileyin.'); } finally { setLoading(false); }
  }
  useEffect(()=>{ const task = setTimeout(()=>void load(),0); return ()=>clearTimeout(task); },[]);
  async function submit(e: FormEvent<HTMLFormElement>,action: string) {
    e.preventDefault(); setBusy(true); setMessage('');
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try { const r = await fetch(`/api/store/${action}`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}); const d = await r.json(); if (!r.ok) throw new Error(d.error); if(d.recoveryCode) setRecovery(d.recoveryCode); if(action==='recover') {setMode('login');setMessage('Şifreniz yenilendi. Yeni kurtarma kodunuzu kaydedin.');} else { await load(); setMessage(action==='profile'?'Bilgileriniz kaydedildi.':'');} }
    catch(error) {setMessage(error instanceof Error?error.message:'Tekrar deneyin.');} finally {setBusy(false);}
  }
  return <><SiteHeader/><main className="mx-auto max-w-5xl px-5 py-12"><p className="eyebrow">Fidan Bahçem</p><h1 className="page-title">Hesabım</h1>
    {message && <p role="status" className="my-6 rounded-xl bg-white p-4">{message}</p>}
    {recovery && <div className="my-6 rounded-xl border border-[var(--line)] bg-white p-5"><h2 className="font-semibold">Kurtarma kodunuzu güvenli bir yerde saklayın</h2><p className="my-2 text-sm">Şifrenizi unuttuğunuzda bu kodla yenileyebilirsiniz. E-posta gönderimi kullanılmaz.</p><code className="break-all select-all">{recovery}</code><button className="secondary-button mt-4" onClick={()=>setRecovery('')}>Kodu kaydettim</button></div>}
    {loading ? <p className="mt-8">Yükleniyor…</p> : !user ? <section className="checkout-panel mt-8 max-w-xl"><div className="mb-6 flex flex-wrap gap-2">{[['login','Giriş yap'],['register','Hesap oluştur'],['recover','Şifremi unuttum']].map(([key,label])=><button key={key} className={`filter-pill ${mode===key?'active':''}`} onClick={()=>setMode(key)}>{label}</button>)}</div>
    <form onSubmit={e=>submit(e,mode)} className="form-grid">
      {mode==='register' && <label className="full">Ad soyad<input name="name" required autoComplete="name" maxLength={100}/></label>}
      <label className="full">E-posta<input name="email" required type="email" autoComplete="email"/></label>
      {mode==='recover' && <label className="full">Kurtarma kodu<input name="recoveryCode" required autoComplete="off"/></label>}
      <label className="full">{mode==='recover'?'Yeni şifre':'Şifre'}<input name="password" type="password" required minLength={mode==='login'?1:12} maxLength={128} autoComplete={mode==='login'?'current-password':'new-password'}/></label>
      {mode==='register' && <p className="full text-sm">En az 12 karakter kullanın. <Link href="/gizlilik" className="underline">Verilerinizin nasıl kullanıldığını okuyun.</Link></p>}
      <button disabled={busy} className="primary-button full">{busy?'İşleniyor…':mode==='register'?'Hesap oluştur':mode==='recover'?'Şifreyi yenile':'Giriş yap'}</button>
    </form></section> : <div className="mt-8 grid gap-8 md:grid-cols-[1fr_1.7fr]">
      <section className="checkout-panel"><h2 className="form-title">Merhaba, {user.name}</h2><p className="mb-5 break-all">{user.email}</p><form className="form-grid" onSubmit={e=>submit(e,'profile')}><label className="full">Ad soyad<input name="name" defaultValue={user.name} required maxLength={100}/></label><button disabled={busy} className="secondary-button full">Bilgileri kaydet</button></form><form className="mt-4" onSubmit={e=>submit(e,'logout')}><button className="secondary-button w-full">Çıkış yap</button></form><a href="/api/store/export" download="fidan-bahcem-verilerim.json" className="mt-5 block underline">Verilerimi indir</a><details className="mt-6"><summary>Hesabımı ve verilerimi sil</summary><p className="my-3 text-sm">Hesabınız ve bağlı siparişleriniz kalıcı olarak silinir.</p><form className="form-grid" onSubmit={e=>submit(e,'delete')}><label className="full">Şifreniz<input name="password" type="password" required/></label><button disabled={busy} className="secondary-button full">Kalıcı olarak sil</button></form></details></section>
      <section><h2 className="form-title">Siparişlerim</h2>{orders.length?orders.map(order=><article key={order.id} className="checkout-panel mb-4"><p className="break-all text-sm">{order.id}</p><p className="mt-2">{new Date(order.createdAt).toLocaleDateString('tr-TR')} · {order.status}</p><ul className="my-4">{order.items.map((item,index)=><li key={index}>{item.quantity} × {item.name}</li>)}</ul><strong>{formatPrice(order.total)}</strong><p className="mt-3 text-sm">Ödeme demo olarak tamamlandı.</p></article>):<div className="checkout-panel"><p>Henüz siparişiniz yok.</p><Link href="/fidanlar" className="primary-button mt-5">Fidanları incele</Link></div>}</section>
    </div>}
  </main></>;
}
