"use client";

import Image from "next/image";
import Link from "next/link";
import { CheckCircle2, FlaskConical, LoaderCircle, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { MAX_CART_QUANTITY } from "@/lib/cart";
import { removePurchasedItems, replaceCart, useCartStore } from "@/lib/cart-store";
import { CHECKOUT_RECOVERY_KEY, isOrderSubmission, parseCheckoutRecovery, type OrderSubmission, type SavedOrderSubmission } from "@/lib/checkout-recovery";
import { formatPrice, products } from "@/lib/products";

type Account = { id: string; name: string; email: string };
type Receipt = { id: string; userId: string | null; total: number; items: { id: string; name: string; quantity: number; price: number }[] };
type RecoveryIssue = { kind: "older"; attempt: SavedOrderSubmission } | { kind: "invalid" | "expired" };
type DeliveryFields = { phone: string; address: string; city: string; district: string };
const emptyDelivery: DeliveryFields = { phone: "", address: "", city: "", district: "" };

async function loadAccount(signal: AbortSignal): Promise<Account | null> {
  const response = await fetch("/api/store/me", { signal, cache: "no-store" });
  if (!response.ok) throw new Error("Oturum durumu doğrulanamadı. Bağlantınızı kontrol edip tekrar deneyin.");
  const data = await response.json().catch(() => null);
  if (!data || typeof data !== "object") throw new Error("Oturum durumu doğrulanamadı. Tekrar deneyin.");
  if (data.deletionPending) throw new Error("Hesap işleminiz tamamlanmadan sipariş oluşturulamaz. Hesabım sayfasını kontrol edin.");
  if (data.user === null) return null;
  if (!data.user || typeof data.user.id !== "string" || typeof data.user.name !== "string" || typeof data.user.email !== "string") throw new Error("Oturum durumu doğrulanamadı. Tekrar deneyin.");
  return data.user;
}

function isReceipt(value: unknown): value is Receipt {
  if (!value || typeof value !== "object") return false;
  const order = value as Record<string, unknown>;
  return typeof order.id === "string" && order.id.length > 0
    && (order.userId === null || typeof order.userId === "string")
    && typeof order.total === "number" && Number.isFinite(order.total) && order.total >= 0
    && Array.isArray(order.items) && order.items.length > 0
    && order.items.every((item) => item && typeof item === "object"
      && typeof item.id === "string" && typeof item.name === "string"
      && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= MAX_CART_QUANTITY
      && typeof item.price === "number" && Number.isFinite(item.price) && item.price >= 0);
}

export default function CheckoutPage() {
  const { lines, ready } = useCartStore();
  const [savedAttempt, setSavedAttempt] = useState<SavedOrderSubmission | null>(null);
  const pending = savedAttempt?.submission || null;
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryIssue, setRecoveryIssue] = useState<RecoveryIssue | null>(null);
  const [restartAcknowledged, setRestartAcknowledged] = useState(false);
  const [storageWarning, setStorageWarning] = useState(false);
  const [memoryAcknowledged, setMemoryAcknowledged] = useState(false);
  const cart = pending?.items || lines;
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [processing, setProcessing] = useState(false);
  const [account, setAccount] = useState<Account | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [deliveryFields, setDeliveryFields] = useState<DeliveryFields>(emptyDelivery);
  const [error, setError] = useState("");
  const nameEdited = useRef(false);
  const emailEdited = useRef(false);
  const submitting = useRef(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  const restoreAttempt = useCallback((attempt: SavedOrderSubmission) => {
    setSavedAttempt(attempt);
    setName(attempt.submission.name);
    setEmail(attempt.submission.email);
    const { phone, address, city, district } = attempt.submission;
    setDeliveryFields({ phone, address, city, district });
    nameEdited.current = true;
    emailEdited.current = true;
    setRecoveryIssue(null);
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (!active) return;
      let recovered;
      try { recovered = parseCheckoutRecovery(window.sessionStorage.getItem(CHECKOUT_RECOVERY_KEY)); }
      catch { recovered = { kind: "none" as const }; }
      if (recovered.kind === "valid") restoreAttempt(recovered.attempt);
      if (recovered.kind === "older") setRecoveryIssue({ kind: "older", attempt: recovered.attempt });
      if (recovered.kind === "invalid" || recovered.kind === "expired") setRecoveryIssue({ kind: recovered.kind });
      setRecoveryReady(true);
    });
    return () => { active = false; };
  }, [restoreAttempt]);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8000);
    void loadAccount(controller.signal)
      .then((user) => {
        if (controller.signal.aborted) return;
        setAccount(user);
        if (!user) return;
        setName((current) => nameEdited.current ? current : current || user.name);
        setEmail((current) => emailEdited.current ? current : current || user.email);
      })
      .catch(() => { /* Submission verifies the current identity again before an order can be sent. */ })
      .finally(() => window.clearTimeout(timeout));
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, []);

  const detailed = useMemo(
    () => cart.flatMap((line) => {
      const product = products.find((item) => item.id === line.id);
      return product ? [{ ...line, product }] : [];
    }),
    [cart],
  );
  const subtotal = detailed.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const delivery = subtotal >= 750 || !subtotal ? 0 : 89;
  const total = subtotal + delivery;

  function change(id: string, delta: number) {
    if (submitting.current || pending) return;
    replaceCart(cart.map((line) => line.id === id ? { ...line, quantity: Math.min(MAX_CART_QUANTITY, line.quantity + delta) } : line).filter((line) => line.quantity > 0));
  }

  function clearSavedAttempt() {
    try { window.sessionStorage.removeItem(CHECKOUT_RECOVERY_KEY); }
    catch { if (!memoryAcknowledged) throw new Error("Tarayıcıda kayıtlı deneme temizlenemedi. Depolama ayarlarınızı kontrol edin."); }
    setSavedAttempt(null);
  }

  function restartAfterAcknowledgment() {
    if (!restartAcknowledged) return;
    try {
      clearSavedAttempt();
      setRecoveryIssue(null);
      setRestartAcknowledged(false);
      setError("");
    } catch { setError("Kaydedilen deneme temizlenemedi. Bu sekme için tarayıcı depolamasını etkinleştirip tekrar deneyin."); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || !recoveryReady || recoveryIssue || !cart.length || submitting.current) return;
    submitting.current = true;
    setProcessing(true);
    setError("");
    const fields = new FormData(event.currentTarget);
    if (!pending && fields.get("demo-consent") !== "on") {
      setError("Demo sipariş ve gizlilik bilgisini onaylayın.");
      submitting.current = false;
      setProcessing(false);
      return;
    }
    const controller = new AbortController();
    let timeout = window.setTimeout(() => controller.abort(), 8000);
    let orderSent = false;
    try {
      const user = await loadAccount(controller.signal);
      setAccount(user);
      if (pending && pending.checkoutUserId !== (user?.id || null)) throw new Error(pending.checkoutUserId ? "Bu deneme bir hesaba bağlı. İlk denemenizdeki hesabınıza giriş yaptıktan sonra aynı siparişi kontrol edin." : "Bu deneme misafir olarak başlatıldı. Hesabınızdan çıkış yaptıktan sonra aynı siparişi kontrol edin.");
      const submission: OrderSubmission = pending || {
        requestId: crypto.randomUUID(), checkoutUserId: user?.id || null,
        items: cart.map((line) => ({ ...line })), name, email, ...deliveryFields, demoConsent: true,
      };
      if (!isOrderSubmission(submission)) throw new Error("İletişim ve adres bilgilerini kontrol edin. Telefon numarası 9–15 rakam içermelidir.");
      const attempt: SavedOrderSubmission = savedAttempt || { version: 1, savedAt: Date.now(), submission };
      try { window.sessionStorage.setItem(CHECKOUT_RECOVERY_KEY, JSON.stringify(attempt)); setStorageWarning(false); }
      catch {
        setStorageWarning(true);
        if (!memoryAcknowledged) throw new Error("Tarayıcı depolaması kullanılamıyor. Depolamayı etkinleştirin veya aşağıdaki uyarıyı onaylayarak bu sayfada devam edin. Sipariş henüz gönderilmedi.");
      }
      setSavedAttempt(attempt);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => controller.abort(), 20000);
      orderSent = true;
      const response = await fetch("/api/store/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(submission),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status >= 400 && response.status < 500 && response.status !== 409) clearSavedAttempt();
        throw new Error(typeof result?.error === "string" ? result.error : "Sipariş kaydedilemedi. Tekrar deneyin.");
      }
      if (!isReceipt(result?.order)) throw new Error("Sipariş sonucu alınamadı. Aynı siparişi tekrar kontrol edin.");
      setReceipt(result.order);
      removePurchasedItems(result.order.items);
      clearSavedAttempt();
      window.requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
        successRef.current?.focus({ preventScroll: true });
      });
    } catch (failure) {
      setError(controller.signal.aborted ? orderSent ? "Yanıt beklenenden uzun sürdü. Aynı siparişi tekrar kontrol edin; yeni bir sipariş oluşturulmayacak." : "Oturum durumu zamanında doğrulanamadı. Sipariş gönderilmedi; tekrar deneyin." : failure instanceof TypeError ? orderSent ? "Bağlantı kurulamadı. İnternet bağlantınızı kontrol edip aynı siparişi tekrar kontrol edin." : "Oturum durumu doğrulanamadı. Sipariş gönderilmedi; bağlantınızı kontrol edip tekrar deneyin." : failure instanceof Error ? failure.message : "Sipariş kaydedilemedi. Tekrar deneyin.");
      window.requestAnimationFrame(() => errorRef.current?.focus());
    } finally {
      window.clearTimeout(timeout);
      submitting.current = false;
      setProcessing(false);
    }
  }

  if (receipt) {
    return (
      <><SiteHeader />
        <main id="main-content" tabIndex={-1} className="mx-auto grid min-h-[70vh] max-w-2xl place-items-center px-5 py-16">
          <div className="w-full rounded-[2rem] border border-[var(--line)] bg-white px-7 py-10 shadow-[0_24px_80px_rgb(34_62_48_/_10%)] md:px-12">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-[#dcebd7] text-[#285c43]"><CheckCircle2 size={38} aria-hidden="true" /></span>
            <p className="eyebrow mt-7 text-center">Demo sipariş kaydedildi</p>
            <h1 ref={successRef} tabIndex={-1} className="mt-2 text-center font-serif text-4xl tracking-[-0.04em] sm:text-5xl">Siparişiniz alındı.</h1>
            <p className="mt-4 break-all text-center text-xs font-semibold">Sipariş no: {receipt.id}</p>
            <ul className="my-6 grid gap-3 border-y border-[var(--line)] py-5 text-sm">{receipt.items.map((item, index) => <li key={index} className="flex justify-between gap-4"><span>{item.quantity} × {item.name}</span><span className="whitespace-nowrap">{formatPrice(item.price * item.quantity)}</span></li>)}</ul>
            <p className="flex items-center justify-between gap-4"><strong>Demo toplamı</strong><strong className="text-xl">{formatPrice(receipt.total)}</strong></p>
            <p className="mt-6 rounded-2xl bg-[#f2f4ee] px-5 py-4 text-sm leading-6 text-[var(--muted)]">Bu işlem gerçek tahsilat veya sevkiyat başlatmaz. {receipt.userId ? "Siparişinizi hesabınızdaki sipariş geçmişinde görebilirsiniz." : "Sipariş numaranızı saklayın. Misafir siparişleri hesap geçmişine eklenmez."}</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3"><Link href="/fidanlar" className="primary-button">Fidanlara dön</Link>{receipt.userId && <Link href="/hesabim" className="secondary-button">Siparişlerim</Link>}</div>
          </div>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <><SiteHeader />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-[1280px] px-5 py-10 md:px-10 md:py-14">
        <div className="mb-8">
          <p className="eyebrow">{account ? "Hesabınıza bağlı sipariş" : "Üyeliksiz sipariş"}</p>
          <h1 className="page-title">Sepet ve teslimat</h1>
          <p className="mt-3 max-w-2xl leading-7 text-[var(--muted)]">{account ? `${account.name}, demo siparişiniz hesabınıza kaydedilecek.` : <>Hesap açmadan demo siparişinizi tamamlayın. Sipariş geçmişi için <Link href="/hesabim?next=%2Fodeme" className="underline underline-offset-4">giriş yapın</Link>.</>}</p>
          {error && <p ref={errorRef} tabIndex={-1} role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-800">{error}</p>}
          {storageWarning && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm leading-6 text-[var(--ink)]"><p><strong>Tarayıcı depolaması kullanılamıyor.</strong> Sipariş denemesi yalnızca bu sayfa açıkken korunabilir. Sonucu alana kadar sayfayı açık tutun. Sayfayı yenilemek veya başka sayfaya gitmek aynı siparişi kontrol etme bilgisini kaybettirir.</p>{!memoryAcknowledged && <label className="mt-3 flex items-start gap-3"><input type="checkbox" checked={memoryAcknowledged} onChange={(event) => setMemoryAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--ink)]" /><span>Bu sınırlamayı anladım; sonuç görünene kadar sayfayı açık tutarak demo siparişe devam etmek istiyorum.</span></label>}</div>}
          {pending && !processing && <div role="status" className="mt-4 rounded-xl border border-[var(--line)] bg-white p-4 text-sm leading-6 text-[var(--muted)]"><p><strong className="text-[var(--ink)]">{storageWarning ? "Bu sayfadaki sipariş denemesi" : "Kaydedilmiş sipariş denemesi"}</strong> · {new Date(savedAttempt!.savedAt).toLocaleString("tr-TR")}</p><p className="mt-1">İlk gönderdiğiniz bilgiler {storageWarning ? "bu sayfa açıkken" : "bu sekmede"} korunur. Aşağıdaki düğmeyle aynı siparişi yeniden kontrol edin. {pending.checkoutUserId ? "İlk denemenizdeki hesabınızla devam edin." : "İlk deneme misafir olarak başlatıldı."}</p><Link href="/hesabim?next=%2Fodeme" className="mt-2 inline-flex min-h-11 items-center underline underline-offset-4">Hesap ve sipariş geçmişini kontrol et</Link></div>}
        </div>

        {!ready || !recoveryReady ? (
          <div role="status" className="checkout-panel flex min-h-64 items-center justify-center gap-3"><LoaderCircle className="animate-spin" size={22} aria-hidden="true" />Sepetiniz yükleniyor…</div>
        ) : recoveryIssue ? (
          <section className="checkout-panel max-w-2xl" aria-labelledby="recovery-title">
            <h2 id="recovery-title" className="font-serif text-3xl">Önceki sipariş denemenizi kontrol edin.</h2>
            {recoveryIssue.kind === "older" ? <><p className="mt-4 text-sm leading-7 text-[var(--muted)]">{new Date(recoveryIssue.attempt.savedAt).toLocaleString("tr-TR")} tarihli deneme 24 saatten eski. Önceki sipariş kaydedilmiş olabilir. Aynı bilgileri ve sipariş kimliğini kullanarak sonucunu kontrol edebilirsiniz.</p><button type="button" className="primary-button mt-6" onClick={() => restoreAttempt(recoveryIssue.attempt)}>Önceki denemeyle devam et</button></> : <><p className="mt-4 text-sm leading-7 text-[var(--muted)]">{recoveryIssue.kind === "expired" ? "Bu sekmede kayıtlı deneme 90 günlük kurtarma süresini aşmış." : "Bu sekmede kayıtlı denemenin bilgileri okunamıyor veya geçerli değil."} Önceki sipariş kaydedilmiş olabilir. Yeni bir demo sipariş oluşturmadan önce hesabınızdaki sipariş geçmişini kontrol edin. Misafir siparişleri hesap geçmişinde görünmez.</p><label className="mt-5 flex items-start gap-3 text-sm leading-6"><input type="checkbox" checked={restartAcknowledged} onChange={(event) => setRestartAcknowledged(event.target.checked)} className="mt-1 size-5 shrink-0 accent-[var(--ink)]" /><span>Önceki demo sipariş kaydedilmiş olabilir. Yerel deneme bilgisini silip yeni bir demo sipariş başlatmak istiyorum.</span></label><button type="button" className="primary-button mt-6" disabled={!restartAcknowledged} onClick={restartAfterAcknowledgment}>Yeni demo sipariş başlat</button></>}
            <Link href="/hesabim?next=%2Fodeme" className="mt-5 flex min-h-11 items-center text-sm underline underline-offset-4">Hesap ve sipariş geçmişini kontrol et</Link>
          </section>
        ) : detailed.length === 0 ? (
          <div className="rounded-[2rem] border border-[var(--line)] bg-white p-8 text-center md:p-20">
            <span className="mx-auto mb-5 grid size-16 place-items-center rounded-full bg-[#edf0e8]"><ShoppingBag size={27} aria-hidden="true" /></span>
            <h2 className="font-serif text-4xl">Sepetiniz henüz boş.</h2>
            <p className="mt-3 leading-7 text-[var(--muted)]">Fidanları inceleyip bahçeniz için uygun olanları ekleyin.</p>
            <Link href="/fidanlar" className="primary-button mx-auto mt-7 w-fit">Fidanları keşfet</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_420px]" aria-busy={processing}>
            <fieldset disabled={processing || !!pending} className="checkout-panel min-w-0">
              <legend className="sr-only">İletişim ve teslimat bilgileri</legend>
              <h2 className="form-title">İletişim</h2>
              <div className="form-grid">
                <label>Ad soyad<input required name="name" value={name} onChange={(event) => { nameEdited.current = true; setName(event.target.value); }} autoComplete="name" minLength={2} maxLength={100} /></label>
                <label>Telefon<input required name="phone" type="tel" value={deliveryFields.phone} onChange={(event) => setDeliveryFields((current) => ({ ...current, phone: event.target.value }))} autoComplete="tel" inputMode="tel" minLength={9} maxLength={30} placeholder="05xx xxx xx xx" /></label>
                <label className="full">E-posta<input required name="email" type="email" value={email} onChange={(event) => { emailEdited.current = true; setEmail(event.target.value); }} autoComplete="email" maxLength={254} /></label>
              </div>
              <h2 className="form-title mt-9">Teslimat adresi</h2>
              <div className="form-grid">
                <label className="full">Adres<textarea required name="address" value={deliveryFields.address} onChange={(event) => setDeliveryFields((current) => ({ ...current, address: event.target.value }))} rows={3} autoComplete="street-address" minLength={10} maxLength={500} placeholder="Mahalle, sokak, bina ve daire numarası" /></label>
                <label>İl<input required name="city" value={deliveryFields.city} onChange={(event) => setDeliveryFields((current) => ({ ...current, city: event.target.value }))} autoComplete="address-level1" minLength={2} maxLength={100} /></label>
                <label>İlçe<input required name="district" value={deliveryFields.district} onChange={(event) => setDeliveryFields((current) => ({ ...current, district: event.target.value }))} autoComplete="address-level2" minLength={2} maxLength={100} /></label>
              </div>
              <h2 className="form-title mt-9">Demo sipariş</h2>
              <div className="rounded-2xl border border-[var(--line)] bg-[#f6f7f2] p-5">
                <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical size={18} className="shrink-0" aria-hidden="true" />Ödeme alınmaz</p>
                <p id="demo-note" className="mt-3 text-sm leading-6 text-[var(--muted)]">Sipariş sürecini deneyebilirsiniz. Gerçek kart bilgisi istenmez; tahsilat ve otomatik sevkiyat yapılmaz. Girdiğiniz iletişim ve adres bilgileri sipariş kaydıyla birlikte saklanır.</p>
                <label className="mt-5 flex cursor-pointer items-start gap-3 text-sm leading-6"><input type="checkbox" required defaultChecked={!!pending} name="demo-consent" className="mt-1 size-5 shrink-0 accent-[var(--ink)]" aria-describedby="demo-note" /><span>Bu işlemin demo olduğunu anladım ve <Link href="/gizlilik" className="underline underline-offset-4" target="_blank" rel="noopener noreferrer">gizlilik bilgisini<span className="sr-only"> (yeni sekmede açılır)</span></Link> okudum.</span></label>
              </div>
            </fieldset>

            <aside className="checkout-summary" aria-labelledby="summary-title">
              <h2 id="summary-title" className="font-serif text-2xl">Sipariş özeti</h2>
              <p className="mt-2 text-xs text-[var(--muted)]">{cart.reduce((sum, line) => sum + line.quantity, 0)} fidan · Demo fiyatlandırma</p>
              <ul className="my-6 grid gap-5">
                {detailed.map(({ product, quantity }) => (
                  <li key={product.id} className="flex gap-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-xl sm:size-20"><Image src={product.image} alt="" fill className="object-cover" sizes="80px" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-x-2 gap-y-1"><p className="font-semibold">{product.name}</p><p className="whitespace-nowrap">{formatPrice(product.price * quantity)}</p></div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{product.size} · {formatPrice(product.price)} / adet</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button type="button" className="qty-button" disabled={processing || !!pending} onClick={() => change(product.id, -1)} aria-label={`${product.name} adedini azalt`}><Minus size={14} aria-hidden="true" /></button>
                        <span className="w-8 text-center text-sm" aria-live="polite" aria-label={`${product.name}: ${quantity} adet`}>{quantity}</span>
                        <button type="button" className="qty-button" disabled={processing || !!pending || quantity >= MAX_CART_QUANTITY} onClick={() => change(product.id, 1)} aria-label={`${product.name} adedini artır`}><Plus size={14} aria-hidden="true" /></button>
                        <button type="button" className="qty-button ml-2 text-[var(--muted)]" disabled={processing || !!pending} onClick={() => change(product.id, -quantity)} aria-label={`${product.name} sepetten çıkar`}><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="grid gap-3 border-y border-[var(--line)] py-5 text-sm">
                <div className="flex justify-between"><span>Ara toplam</span><span>{formatPrice(subtotal)}</span></div>
                <div className="flex justify-between"><span>Teslimat</span><span>{delivery ? formatPrice(delivery) : "Ücretsiz"}</span></div>
              </div>
              {subtotal < 750 ? <p className="mt-4 rounded-xl bg-[#f2f4ee] px-4 py-3 text-xs leading-5 text-[var(--muted)]">Demo toplamı {formatPrice(750)} ve üzerindeyken teslimat ücretsiz. {formatPrice(750 - subtotal)} daha ekleyebilirsiniz.</p> : <p className="mt-4 flex items-center gap-2 text-xs text-[#285c43]"><CheckCircle2 size={16} aria-hidden="true" />Demo teslimat tutarı ücretsiz.</p>}
              <div className="mt-5 flex items-baseline justify-between"><strong>Toplam</strong><strong className="text-2xl" aria-live="polite">{formatPrice(total)}</strong></div>
              <button className="primary-button mt-6 w-full" type="submit" disabled={processing}>
                {processing ? <><LoaderCircle className="animate-spin" size={18} aria-hidden="true" />Sipariş kaydediliyor…</> : pending ? "Aynı siparişi kontrol et" : "Demo siparişi kaydet"}
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-[var(--muted)]">Gerçek ödeme alınmaz. Bu kayıt sevkiyat başlatmaz.</p>
            </aside>
          </form>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
