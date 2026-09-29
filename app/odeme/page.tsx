"use client";

import Image from "next/image";
import Link from "next/link";
import {
  CheckCircle2,
  CreditCard,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import { FormEvent, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { replaceCart, useCartStore } from "@/lib/cart-store";
import { formatPrice, products } from "@/lib/products";

function formatCardNumber(value: string) {
  return value.replace(/\D/g, "").slice(0, 16).replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)} / ${digits.slice(2)}` : digits;
}

export default function CheckoutPage() {
  const { lines: cart, ready } = useCartStore();
  const [complete, setComplete] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  const detailed = useMemo(
    () =>
      cart
        .map((line) => ({ ...line, product: products.find((product) => product.id === line.id)! }))
        .filter((line) => line.product),
    [cart],
  );
  const subtotal = detailed.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
  const delivery = subtotal >= 750 ? 0 : 89;
  const total = subtotal + delivery;

  function change(id: string, delta: number) {
    replaceCart(
      cart
        .map((line) => (line.id === id ? { ...line, quantity: line.quantity + delta } : line))
        .filter((line) => line.quantity > 0),
    );
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.length || processing) return;
    setProcessing(true);
    window.setTimeout(() => {
      setOrderNumber(`FB-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`);
      replaceCart([]);
      setProcessing(false);
      setComplete(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }, 700);
  }

  if (complete) {
    return (
      <>
        <SiteHeader />
        <main className="mx-auto grid min-h-[76vh] max-w-2xl place-items-center px-5 py-16 text-center">
          <div className="rounded-[2rem] border border-[var(--line)] bg-white px-7 py-12 shadow-[0_24px_80px_rgb(34_62_48_/_10%)] md:px-14">
            <span className="mx-auto grid size-20 place-items-center rounded-full bg-[#dcebd7] text-[#285c43]">
              <CheckCircle2 size={38} />
            </span>
            <p className="eyebrow mt-7">Ödeme tamamlandı</p>
            <h1 className="mt-2 font-serif text-5xl tracking-[-0.04em]">Siparişiniz alındı.</h1>
            <p className="mt-4 text-sm font-semibold">Sipariş no: {orderNumber}</p>
            <p className="mt-5 leading-7 text-[var(--muted)]">
              Fidanlarınız hazırlanmaya başladı. Türü kesin olmayan ürünler için sevkiyat öncesinde yakın çekim teyidi paylaşılacak.
            </p>
            <div className="mt-7 rounded-2xl bg-[#f2f4ee] px-5 py-4 text-sm leading-6 text-[var(--muted)]">
              Bu sitedeki ödeme akışı demodur. Kart bilgileri saklanmaz ve gerçek tahsilat yapılmaz.
            </div>
            <Link href="/fidanlar" className="primary-button mx-auto mt-8 w-fit">Alışverişe dön</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-[1280px] px-5 py-10 md:px-10 md:py-14">
        <div className="mb-10">
          <p className="eyebrow">Üyeliksiz ödeme</p>
          <h1 className="page-title">Teslimat bilgileri</h1>
          <p className="mt-3 text-[var(--muted)]">Hesap açmadan siparişinizi tamamlayın.</p>
        </div>

        {ready && detailed.length === 0 ? (
          <div className="rounded-[2rem] border border-[var(--line)] bg-white p-10 text-center md:p-20">
            <h2 className="font-serif text-4xl">Sepetiniz henüz boş.</h2>
            <p className="mt-3 text-[var(--muted)]">Fidanları inceleyip bahçeniz için uygun olanları ekleyin.</p>
            <Link href="/fidanlar" className="primary-button mx-auto mt-7 w-fit">Fidanlara git</Link>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-8 lg:grid-cols-[1fr_420px]">
            <div className="checkout-panel">
              <h2 className="form-title">İletişim</h2>
              <div className="form-grid">
                <label>Ad soyad<input required name="name" autoComplete="name" /></label>
                <label>Telefon<input required name="phone" type="tel" autoComplete="tel" /></label>
                <label className="full">E-posta<input required name="email" type="email" autoComplete="email" /></label>
              </div>

              <h2 className="form-title mt-9">Teslimat adresi</h2>
              <div className="form-grid">
                <label className="full">Adres<textarea required name="address" rows={3} autoComplete="street-address" /></label>
                <label>İl<input required name="city" autoComplete="address-level1" /></label>
                <label>İlçe<input required name="district" autoComplete="address-level2" /></label>
              </div>

              <h2 className="form-title mt-9">Ödeme</h2>
              <div className="rounded-2xl border border-[var(--line)] bg-[#f6f7f2] p-5">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3 text-sm font-semibold">
                  <span className="flex items-center gap-2"><LockKeyhole size={17} /> Kart bilgileri</span>
                  <span className="rounded-full bg-[#e4eadf] px-3 py-1 text-xs">Demo ödeme</span>
                </div>
                <div className="form-grid">
                  <label className="full">Kart üzerindeki ad<input required name="cc-name" autoComplete="cc-name" /></label>
                  <label className="full">
                    Kart numarası
                    <span className="relative">
                      <CreditCard className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={18} />
                      <input required className="pl-10" name="cc-number" autoComplete="cc-number" inputMode="numeric" value={cardNumber} onChange={(event) => setCardNumber(formatCardNumber(event.target.value))} placeholder="0000 0000 0000 0000" pattern="[0-9 ]{19}" aria-describedby="payment-note" />
                    </span>
                  </label>
                  <label>
                    Son kullanma
                    <input required name="cc-exp" autoComplete="cc-exp" inputMode="numeric" value={expiry} onChange={(event) => setExpiry(formatExpiry(event.target.value))} placeholder="AA / YY" pattern="(0[1-9]|1[0-2]) / [0-9]{2}" />
                  </label>
                  <label>
                    CVV
                    <input required name="cc-csc" autoComplete="cc-csc" inputMode="numeric" value={cvv} onChange={(event) => setCvv(event.target.value.replace(/\D/g, "").slice(0, 3))} placeholder="000" pattern="[0-9]{3}" />
                  </label>
                </div>
                <p id="payment-note" className="mt-4 text-xs leading-5 text-[var(--muted)]">
                  Herhangi bir 16 haneli kart numarası, geçerli biçimde bir tarih ve 3 haneli CVV girildiğinde ödeme başarılı olarak gösterilir. Bilgiler gönderilmez veya saklanmaz.
                </p>
              </div>
            </div>

            <aside className="checkout-summary">
              <h2 className="font-serif text-2xl">Sipariş özeti</h2>
              <div className="my-6 grid gap-4">
                {detailed.map(({ product, quantity }) => (
                  <div key={product.id} className="flex gap-3">
                    <div className="relative size-20 shrink-0 overflow-hidden rounded-xl"><Image src={product.image} alt="" fill className="object-cover" sizes="80px" /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex justify-between gap-2"><p className="font-semibold">{product.name}</p><p>{formatPrice(product.price * quantity)}</p></div>
                      <p className="mt-1 text-xs text-[var(--muted)]">{product.size}</p>
                      <div className="mt-3 flex items-center gap-1">
                        <button type="button" className="qty-button" onClick={() => change(product.id, -1)} aria-label="Adedi azalt"><Minus size={14} /></button>
                        <span className="w-8 text-center text-sm">{quantity}</span>
                        <button type="button" className="qty-button" onClick={() => change(product.id, 1)} aria-label="Adedi artır"><Plus size={14} /></button>
                        <button type="button" className="ml-2 text-[var(--muted)]" onClick={() => change(product.id, -quantity)} aria-label="Ürünü sil"><Trash2 size={15} /></button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 border-y border-[var(--line)] py-5 text-sm">
                <div className="flex justify-between"><span>Ara toplam</span><span>{formatPrice(subtotal)}</span></div>
                <div className="flex justify-between"><span>Teslimat</span><span>{delivery ? formatPrice(delivery) : "Ücretsiz"}</span></div>
              </div>
              <div className="mt-5 flex items-baseline justify-between"><strong>Toplam</strong><strong className="text-2xl">{formatPrice(total)}</strong></div>
              <button className="primary-button mt-6 w-full justify-center disabled:cursor-wait disabled:opacity-70" type="submit" disabled={processing}>
                {processing ? <><LoaderCircle className="animate-spin" size={18} /> Ödeme tamamlanıyor</> : "Siparişi tamamla"}
              </button>
              <p className="mt-4 text-center text-xs leading-5 text-[var(--muted)]">Gerçek ödeme alınmaz. Kart bilgileri yalnızca demo akışını tamamlamak için kullanılır.</p>
            </aside>
          </form>
        )}
      </main>
    </>
  );
}
